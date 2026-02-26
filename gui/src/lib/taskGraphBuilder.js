const DEFAULT_FETCH_BATCH_SIZE = 50;
const DEFAULT_LINK_DEPTH = 1;

function toKey(value) {
    return (value || '').toString().trim().toUpperCase();
}

function nodeFromIssue(issue, existing = null) {
    const key = toKey(issue?.key);
    if (!key) return existing;
    const summary = issue?.summary || existing?.label || 'No summary';

    return {
        id: key,
        key,
        label: summary,
        metadata: {
            key,
            title: summary,
            status: issue?.status ?? existing?.metadata?.status ?? null,
            assignee: issue?.assignee ?? existing?.metadata?.assignee ?? null,
            priority: issue?.priority ?? existing?.metadata?.priority ?? null,
            type: issue?.type ?? existing?.metadata?.type ?? null,
            description_plain: issue?.description_plain ?? existing?.metadata?.description_plain ?? null,
            parentKey: toKey(issue?.parent?.key) || existing?.metadata?.parentKey || null,
        },
    };
}

function addEdge(edgeMap, from, to, type, extra = {}) {
    const source = toKey(from);
    const target = toKey(to);
    if (!source || !target) return;
    const id = `${source}|${target}|${type}`;
    if (!edgeMap.has(id)) {
        edgeMap.set(id, {
            id,
            from: source,
            to: target,
            type,
            ...extra,
        });
    }
}

async function fetchMissingIssues(keys, issueCache, fetchIssuesByKeys, includeDescriptions, batchSize) {
    const missing = keys.filter((key) => key && !issueCache.has(key));
    if (!missing.length) return;

    for (let i = 0; i < missing.length; i += batchSize) {
        const batch = missing.slice(i, i + batchSize);
        const fetched = await fetchIssuesByKeys(batch, includeDescriptions);
        (fetched || []).forEach((issue) => {
            const issueKey = toKey(issue?.key);
            if (issueKey) issueCache.set(issueKey, issue);
        });
    }
}

export async function buildTaskGraph({
    seedIssues,
    fetchIssuesByKeys,
    includeDescriptions = false,
    includeLinks = true,
    linkDepth = DEFAULT_LINK_DEPTH,
    fetchBatchSize = DEFAULT_FETCH_BATCH_SIZE,
    onProgress,
    signal,
}) {
    const issueCache = new Map();
    const nodeMap = new Map();
    const edgeMap = new Map();
    const queue = [];
    const bestLinkDepth = new Map();

    const safeLinkDepth = includeLinks ? Math.max(0, Number(linkDepth) || 0) : 0;
    const seeds = (seedIssues || []).filter(Boolean);
    seeds.forEach((issue) => {
        const key = toKey(issue?.key);
        if (!key) return;
        issueCache.set(key, issue);
        nodeMap.set(key, nodeFromIssue(issue));
    });

    const enqueue = (key, depth = 0) => {
        const normalized = toKey(key);
        if (!normalized) return;
        const prev = bestLinkDepth.get(normalized);
        // Loop safety: only revisit if we found a shorter link-path depth.
        if (prev !== undefined && depth >= prev) return;
        bestLinkDepth.set(normalized, depth);
        queue.push({ key: normalized, linkDepth: depth });
    };

    seeds.forEach((issue) => enqueue(issue?.key, 0));

    let processed = 0;
    let lastEmit = 0;
    const emitProgress = (phase = 'building', force = false) => {
        if (!onProgress) return;
        const now = Date.now();
        if (!force && now - lastEmit < 120) return;
        lastEmit = now;
        onProgress({
            phase,
            processed,
            queued: queue.length,
            graph: {
                nodes: Array.from(nodeMap.values()),
                edges: Array.from(edgeMap.values()),
            },
        });
    };

    while (queue.length) {
        if (signal?.aborted) {
            throw new Error('Task graph build cancelled');
        }

        const chunk = queue.splice(0, fetchBatchSize);
        const keys = Array.from(new Set(chunk.map((item) => item.key)));
        await fetchMissingIssues(keys, issueCache, fetchIssuesByKeys, includeDescriptions, fetchBatchSize);

        // Recursive relationship expansion by repeatedly consuming the queue.
        for (const item of chunk) {
            const expectedDepth = bestLinkDepth.get(item.key);
            if (expectedDepth !== item.linkDepth) continue;
            const issue = issueCache.get(item.key);
            if (!issue) continue;

            nodeMap.set(item.key, nodeFromIssue(issue, nodeMap.get(item.key)));

            const parentKey = toKey(issue?.parent?.key);
            if (parentKey) {
                addEdge(edgeMap, parentKey, item.key, 'parent-child');
                nodeMap.set(parentKey, nodeFromIssue(issue.parent, nodeMap.get(parentKey)));
                enqueue(parentKey, item.linkDepth);
            }

            const subtasks = Array.isArray(issue?.subtasks) ? issue.subtasks : [];
            subtasks.forEach((subtask) => {
                const childKey = toKey(subtask?.key);
                if (!childKey) return;
                addEdge(edgeMap, item.key, childKey, 'parent-child');
                nodeMap.set(childKey, nodeFromIssue(subtask, nodeMap.get(childKey)));
                enqueue(childKey, item.linkDepth);
            });

            if (includeLinks && item.linkDepth < safeLinkDepth) {
                const links = Array.isArray(issue?.links) ? issue.links : [];
                links.forEach((link) => {
                    const linkedKey = toKey(link?.linked_key);
                    if (!linkedKey) return;
                    const isOutward = link?.direction === 'outward';
                    const source = isOutward ? item.key : linkedKey;
                    const target = isOutward ? linkedKey : item.key;
                    addEdge(edgeMap, source, target, 'issue-link', {
                        relation: link?.relation || link?.type || 'link',
                        linkType: link?.type || 'link',
                    });
                    nodeMap.set(
                        linkedKey,
                        nodeFromIssue(
                            { key: linkedKey, summary: link?.linked_summary || 'Linked issue' },
                            nodeMap.get(linkedKey),
                        ),
                    );
                    enqueue(linkedKey, item.linkDepth + 1);
                });
            }

            processed += 1;
        }

        emitProgress('building');
    }

    emitProgress('completed', true);
    return {
        nodes: Array.from(nodeMap.values()),
        edges: Array.from(edgeMap.values()),
    };
}

export function orderIssuesForExport(selectedKeys, graph) {
    const selected = new Set((selectedKeys || []).map(toKey).filter(Boolean));
    if (!selected.size) return [];

    const parentEdges = (graph?.edges || []).filter(
        (edge) => edge.type === 'parent-child' && selected.has(edge.from) && selected.has(edge.to),
    );
    const inDegree = new Map();
    const outgoing = new Map();

    selected.forEach((key) => {
        inDegree.set(key, 0);
        outgoing.set(key, []);
    });

    parentEdges.forEach((edge) => {
        outgoing.get(edge.from)?.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    });

    const roots = Array.from(selected).filter((key) => (inDegree.get(key) || 0) === 0).sort();
    const ordered = [];

    while (roots.length) {
        const next = roots.shift();
        if (!next) break;
        ordered.push(next);
        const children = (outgoing.get(next) || []).slice().sort();
        children.forEach((child) => {
            const nextDegree = (inDegree.get(child) || 0) - 1;
            inDegree.set(child, nextDegree);
            if (nextDegree === 0) {
                roots.push(child);
                roots.sort();
            }
        });
    }

    // Fallback for cycles and link-only components.
    const leftovers = Array.from(selected).filter((key) => !ordered.includes(key)).sort();
    return [...ordered, ...leftovers];
}

export function formatIssuesForExport(issues, fields) {
    const options = {
        status: Boolean(fields?.status),
        assignee: Boolean(fields?.assignee),
        priority: Boolean(fields?.priority),
        description: Boolean(fields?.description),
    };

    return (issues || [])
        .map((issue) => {
            const lines = [`${issue.key} — ${issue.title || issue.summary || 'No summary'}`];
            if (options.status) lines.push(`Status: ${issue.status || 'Unknown'}`);
            if (options.assignee) lines.push(`Assignee: ${issue.assignee || 'Unassigned'}`);
            if (options.priority) lines.push(`Priority: ${issue.priority || 'None'}`);
            if (options.description && issue.description_plain) {
                lines.push(`Description: ${issue.description_plain}`);
            }
            return lines.join('\n');
        })
        .join('\n\n');
}

export function mapByKey(nodes) {
    const out = new Map();
    (nodes || []).forEach((node) => {
        if (!node?.id) return;
        out.set(node.id, {
            key: node.id,
            title: node.label || node.metadata?.title || '',
            status: node.metadata?.status || null,
            assignee: node.metadata?.assignee || null,
            priority: node.metadata?.priority || null,
            description_plain: node.metadata?.description_plain || null,
        });
    });
    return out;
}
