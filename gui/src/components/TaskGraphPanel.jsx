import React, { useCallback, useMemo, useRef, useState } from 'react';
import { GitMerge, Copy, Loader2, ListTree, RefreshCcw } from 'lucide-react';
import { issues as issuesApi } from '../api';
import { GraphView } from './GraphView';
import {
    buildTaskGraph,
    formatIssuesForExport,
    mapByKey,
    orderIssuesForExport,
} from '../lib/taskGraphBuilder';

const DEFAULT_OPTIONS = {
    scope: 'all',
    specificUser: '',
    descriptionMode: 'none',
    fields: {
        status: true,
        assignee: true,
        priority: true,
    },
    includeLinks: true,
};

const MAX_PAGES = 50;

function normalizeKey(key) {
    return (key || '').toString().trim().toUpperCase();
}

function dedupeIssues(issues) {
    const byKey = new Map();
    (issues || []).forEach((issue) => {
        const key = normalizeKey(issue?.key);
        if (!key) return;
        byKey.set(key, issue);
    });
    return Array.from(byKey.values());
}

export function TaskGraphPanel({ focusData, focusKey, onSelectIssue, onRefocus }) {
    const [showBuilder, setShowBuilder] = useState(false);
    const [options, setOptions] = useState(DEFAULT_OPTIONS);
    const [graph, setGraph] = useState(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState([]);
    const [buildState, setBuildState] = useState({
        loading: false,
        message: '',
        processed: 0,
        queued: 0,
        nodes: 0,
        edges: 0,
    });
    const [copying, setCopying] = useState(false);
    const [copyStatus, setCopyStatus] = useState('');
    const issueCacheRef = useRef(new Map());
    const buildTokenRef = useRef(0);

    const fetchIssuesByKeys = useCallback(async (keys, includeDescriptions) => {
        const normalized = Array.from(
            new Set((keys || []).map(normalizeKey).filter(Boolean)),
        );
        if (!normalized.length) return [];

        const cache = issueCacheRef.current;
        const missing = normalized.filter((key) => {
            const cached = cache.get(key);
            if (!cached) return true;
            if (!includeDescriptions) return false;
            return !cached.description_plain;
        });

        if (missing.length) {
            const res = await issuesApi.byKeys(missing, includeDescriptions);
            (res.data.issues || []).forEach((issue) => {
                const key = normalizeKey(issue?.key);
                if (!key) return;
                cache.set(key, issue);
            });
        }

        return normalized.map((key) => cache.get(key)).filter(Boolean);
    }, []);

    const fetchIssuePages = useCallback(async (params, token) => {
        let cursor = null;
        let page = 0;
        const result = [];
        do {
            if (token !== buildTokenRef.current) {
                throw new Error('Task graph build cancelled');
            }
            const res = await issuesApi.list({
                ...params,
                cursor: cursor || undefined,
                limit: 500,
            });
            const pageIssues = res.data.issues || [];
            result.push(...pageIssues);
            cursor = res.data.next_cursor || null;
            page += 1;
            setBuildState((prev) => ({
                ...prev,
                message: `Loading issue pages (${page})...`,
            }));
        } while (cursor && page < MAX_PAGES);
        return dedupeIssues(result);
    }, []);

    const loadSeedIssues = useCallback(
        async (token, includeDescriptions) => {
            const baseParams = { include_descriptions: includeDescriptions };
            if (options.scope === 'assigned_me') {
                return fetchIssuePages(baseParams, token);
            }
            if (options.scope === 'all') {
                return fetchIssuePages({ ...baseParams, assignee_any: true }, token);
            }
            if (options.scope === 'assigned_user') {
                const name = options.specificUser.trim();
                if (!name) throw new Error('Please enter a user to filter by assignee');
                return fetchIssuePages({ ...baseParams, assignees: `name:${name}` }, token);
            }
            if (options.scope === 'not_assigned_me') {
                const [allIssues, myIssues] = await Promise.all([
                    fetchIssuePages({ ...baseParams, assignee_any: true }, token),
                    fetchIssuePages(baseParams, token),
                ]);
                const mine = new Set(myIssues.map((issue) => normalizeKey(issue.key)));
                return allIssues.filter((issue) => !mine.has(normalizeKey(issue.key)));
            }
            return [];
        },
        [fetchIssuePages, options.scope, options.specificUser],
    );

    const handleBuildGraph = useCallback(async () => {
        const token = buildTokenRef.current + 1;
        buildTokenRef.current = token;
        setShowBuilder(false);
        setSelectedNodeIds([]);
        setCopyStatus('');
        setBuildState({
            loading: true,
            message: 'Preparing issue set...',
            processed: 0,
            queued: 0,
            nodes: 0,
            edges: 0,
        });

        const includeDescriptions = options.descriptionMode === 'all';

        try {
            const seedIssues = await loadSeedIssues(token, includeDescriptions);
            if (!seedIssues.length) {
                setGraph({ nodes: [], edges: [] });
                setBuildState({
                    loading: false,
                    message: 'No issues matched the selected scope.',
                    processed: 0,
                    queued: 0,
                    nodes: 0,
                    edges: 0,
                });
                return;
            }

            seedIssues.forEach((issue) => {
                const key = normalizeKey(issue?.key);
                if (key) issueCacheRef.current.set(key, issue);
            });

            const built = await buildTaskGraph({
                seedIssues,
                fetchIssuesByKeys,
                includeDescriptions,
                includeLinks: options.includeLinks,
                onProgress: (progress) => {
                    if (token !== buildTokenRef.current) return;
                    setGraph(progress.graph);
                    setBuildState({
                        loading: progress.phase !== 'completed',
                        message: progress.phase === 'completed' ? 'Task graph ready' : 'Building relationships...',
                        processed: progress.processed,
                        queued: progress.queued,
                        nodes: progress.graph.nodes.length,
                        edges: progress.graph.edges.length,
                    });
                },
            });

            if (token !== buildTokenRef.current) return;
            setGraph(built);
            setBuildState((prev) => ({
                ...prev,
                loading: false,
                message: `Task graph ready (${built.nodes.length} nodes)`,
            }));
        } catch (err) {
            if (token !== buildTokenRef.current) return;
            setBuildState({
                loading: false,
                message: err.message || 'Task graph build failed',
                processed: 0,
                queued: 0,
                nodes: 0,
                edges: 0,
            });
        }
    }, [fetchIssuesByKeys, loadSeedIssues, options.descriptionMode, options.includeLinks]);

    const selectBranch = useCallback(() => {
        if (!graph || !selectedNodeIds.length) return;
        const root = normalizeKey(selectedNodeIds[0]);
        if (!root) return;
        const children = new Map();
        graph.edges.forEach((edge) => {
            if (edge.type !== 'parent-child') return;
            const source = normalizeKey(edge.from);
            const target = normalizeKey(edge.to);
            if (!source || !target) return;
            if (!children.has(source)) children.set(source, []);
            children.get(source).push(target);
        });
        const picked = new Set();
        const queue = [root];
        while (queue.length) {
            const key = queue.shift();
            if (!key || picked.has(key)) continue;
            picked.add(key);
            (children.get(key) || []).forEach((child) => {
                if (!picked.has(child)) queue.push(child);
            });
        }
        setSelectedNodeIds(Array.from(picked));
    }, [graph, selectedNodeIds]);

    const ensureDescriptionsLoaded = useCallback(async (keys) => {
        if (options.descriptionMode !== 'selected') return;
        const cache = issueCacheRef.current;
        const missing = keys.filter((key) => {
            const issue = cache.get(key);
            return !issue?.description_plain;
        });
        if (!missing.length) return;

        // Lazy-load descriptions only when the user exports selected issues.
        const res = await issuesApi.byKeys(missing, true);
        const fetched = res.data.issues || [];
        fetched.forEach((issue) => {
            const key = normalizeKey(issue?.key);
            if (key) cache.set(key, issue);
        });

        setGraph((prev) => {
            if (!prev) return prev;
            const updates = new Map(
                fetched.map((issue) => [normalizeKey(issue?.key), issue.description_plain || null]),
            );
            return {
                ...prev,
                nodes: prev.nodes.map((node) => {
                    const nextDescription = updates.get(normalizeKey(node.id));
                    if (nextDescription === undefined) return node;
                    return {
                        ...node,
                        metadata: {
                            ...(node.metadata || {}),
                            description_plain: nextDescription,
                        },
                    };
                }),
            };
        });
    }, [options.descriptionMode]);

    const selectedIssues = useMemo(() => {
        if (!graph || !selectedNodeIds.length) return [];
        const ordered = orderIssuesForExport(selectedNodeIds, graph);
        const nodeMap = mapByKey(graph.nodes);
        return ordered.map((key) => nodeMap.get(key)).filter(Boolean);
    }, [graph, selectedNodeIds]);

    const handleCopy = useCallback(async () => {
        if (!graph || !selectedNodeIds.length) return;
        setCopying(true);
        setCopyStatus('');
        try {
            const orderedKeys = orderIssuesForExport(selectedNodeIds, graph);
            await ensureDescriptionsLoaded(orderedKeys);

            const cache = issueCacheRef.current;
            const nodeMap = mapByKey(graph.nodes);
            const exportIssues = orderedKeys
                .map((key) => {
                    const nodeIssue = nodeMap.get(key);
                    const cached = cache.get(key);
                    return {
                        ...nodeIssue,
                        description_plain: cached?.description_plain || nodeIssue?.description_plain || null,
                    };
                })
                .filter(Boolean);

            const includeDescription = options.descriptionMode !== 'none';
            const text = formatIssuesForExport(exportIssues, {
                ...options.fields,
                description: includeDescription,
            });
            await navigator.clipboard.writeText(text);
            setCopyStatus(`Copied ${exportIssues.length} issues`);
        } catch (err) {
            setCopyStatus(err.message || 'Failed to copy');
        } finally {
            setCopying(false);
        }
    }, [ensureDescriptionsLoaded, graph, options.descriptionMode, options.fields, selectedNodeIds]);

    const activeGraph = graph || null;
    const includeDescriptionField = options.descriptionMode !== 'none';

    const handleFocusGraph = useCallback(async () => {
        // Cancel in-flight incremental graph updates before switching back.
        buildTokenRef.current += 1;
        setGraph(null);
        setSelectedNodeIds([]);
        setCopyStatus('');
        setBuildState((prev) => ({
            ...prev,
            loading: false,
            message: 'Showing focus graph',
            processed: 0,
            queued: 0,
        }));
        if (focusKey && onRefocus) {
            try {
                await onRefocus(focusKey);
            } catch (err) {
                setBuildState((prev) => ({
                    ...prev,
                    message: err?.message || 'Focus refresh failed',
                }));
            }
        }
    }, [focusKey, onRefocus]);

    return (
        <div className="task-graph-panel">
            <div className="task-graph-toolbar">
                <div className="left-actions">
                    <button
                        className="action-btn primary"
                        type="button"
                        onClick={() => setShowBuilder(true)}
                        disabled={buildState.loading}
                    >
                        <GitMerge size={16} /> Build Task Graph
                    </button>
                    {graph && (
                        <button
                            className="action-btn"
                            type="button"
                            onClick={handleFocusGraph}
                        >
                            <RefreshCcw size={16} /> Focus Graph
                        </button>
                    )}
                </div>
                <div className="build-status">
                    {buildState.loading && <Loader2 size={14} className="spin" />}
                    <span>{buildState.message}</span>
                    {(buildState.nodes > 0 || buildState.edges > 0) && (
                        <span className="stats">
                            {buildState.nodes} nodes / {buildState.edges} edges
                        </span>
                    )}
                </div>
            </div>

            <div className="task-graph-content">
                <div className="graph-wrap">
                    <GraphView
                        data={focusData}
                        graph={activeGraph}
                        onSelect={(nodeId) => {
                            if (!graph) onSelectIssue?.(nodeId);
                        }}
                        selectedNodeIds={selectedNodeIds}
                        onSelectionChange={setSelectedNodeIds}
                        displayFields={options.fields}
                    />
                </div>

                <div className="export-panel">
                    <div className="export-header">
                        <h3>Export / Copy</h3>
                        <span>{selectedNodeIds.length} selected</span>
                    </div>
                    <div className="field-toggles">
                        <label>
                            <input
                                type="checkbox"
                                checked={options.fields.status}
                                onChange={(event) =>
                                    setOptions((prev) => ({
                                        ...prev,
                                        fields: { ...prev.fields, status: event.target.checked },
                                    }))
                                }
                            />
                            Status
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={options.fields.assignee}
                                onChange={(event) =>
                                    setOptions((prev) => ({
                                        ...prev,
                                        fields: { ...prev.fields, assignee: event.target.checked },
                                    }))
                                }
                            />
                            Assignee
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={options.fields.priority}
                                onChange={(event) =>
                                    setOptions((prev) => ({
                                        ...prev,
                                        fields: { ...prev.fields, priority: event.target.checked },
                                    }))
                                }
                            />
                            Priority
                        </label>
                        <label className={includeDescriptionField ? '' : 'disabled'}>
                            <input type="checkbox" checked={includeDescriptionField} disabled readOnly />
                            Description ({options.descriptionMode})
                        </label>
                    </div>
                    <div className="selection-actions">
                        <button
                            className="action-btn"
                            type="button"
                            onClick={() => setSelectedNodeIds(graph?.nodes?.map((node) => node.id) || [])}
                            disabled={!graph?.nodes?.length}
                        >
                            <ListTree size={15} /> Select all
                        </button>
                        <button
                            className="action-btn"
                            type="button"
                            onClick={selectBranch}
                            disabled={selectedNodeIds.length === 0}
                        >
                            Branch from first
                        </button>
                        <button
                            className="action-btn primary"
                            type="button"
                            onClick={handleCopy}
                            disabled={selectedNodeIds.length === 0 || copying}
                        >
                            {copying ? <Loader2 size={15} className="spin" /> : <Copy size={15} />} Copy
                        </button>
                    </div>
                    {copyStatus && <div className="copy-status">{copyStatus}</div>}
                    <div className="selected-preview">
                        {selectedIssues.slice(0, 10).map((issue) => (
                            <div key={issue.key} className="selected-item">
                                <span className="key">{issue.key}</span>
                                <span className="title">{issue.title}</span>
                            </div>
                        ))}
                        {selectedIssues.length > 10 && (
                            <div className="selected-item muted">+{selectedIssues.length - 10} more</div>
                        )}
                        {!selectedIssues.length && (
                            <div className="selected-item muted">Select graph nodes to export</div>
                        )}
                    </div>
                </div>
            </div>

            {showBuilder && (
                <div className="builder-overlay">
                    <div className="builder-modal">
                        <div className="builder-header">
                            <h3>Build Task Graph</h3>
                            <button type="button" className="action-btn" onClick={() => setShowBuilder(false)}>
                                Close
                            </button>
                        </div>

                        <div className="builder-section">
                            <label>Task set</label>
                            <select
                                value={options.scope}
                                onChange={(event) => setOptions((prev) => ({ ...prev, scope: event.target.value }))}
                            >
                                <option value="all">All tasks</option>
                                <option value="assigned_me">Only tasks assigned to me</option>
                                <option value="not_assigned_me">Only tasks not assigned to me</option>
                                <option value="assigned_user">Assigned to specific user</option>
                            </select>
                            {options.scope === 'assigned_user' && (
                                <input
                                    type="text"
                                    value={options.specificUser}
                                    onChange={(event) =>
                                        setOptions((prev) => ({ ...prev, specificUser: event.target.value }))
                                    }
                                    placeholder="Display name (e.g. John Doe)"
                                />
                            )}
                        </div>

                        <div className="builder-section">
                            <label>Description mode</label>
                            <select
                                value={options.descriptionMode}
                                onChange={(event) =>
                                    setOptions((prev) => ({ ...prev, descriptionMode: event.target.value }))
                                }
                            >
                                <option value="none">No descriptions</option>
                                <option value="selected">Descriptions only for selected tasks (lazy)</option>
                                <option value="all">Descriptions for all tasks</option>
                            </select>
                            {options.descriptionMode === 'all' && (
                                <p className="warning">
                                    Loading descriptions for all tasks can be slower on large issue sets.
                                </p>
                            )}
                        </div>

                        <div className="builder-section">
                            <label>Fields for display/export</label>
                            <div className="inline-options">
                                <label>
                                    <input type="checkbox" checked readOnly />
                                    key
                                </label>
                                <label>
                                    <input type="checkbox" checked readOnly />
                                    title
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={options.fields.status}
                                        onChange={(event) =>
                                            setOptions((prev) => ({
                                                ...prev,
                                                fields: { ...prev.fields, status: event.target.checked },
                                            }))
                                        }
                                    />
                                    status
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={options.fields.assignee}
                                        onChange={(event) =>
                                            setOptions((prev) => ({
                                                ...prev,
                                                fields: { ...prev.fields, assignee: event.target.checked },
                                            }))
                                        }
                                    />
                                    assignee
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={options.fields.priority}
                                        onChange={(event) =>
                                            setOptions((prev) => ({
                                                ...prev,
                                                fields: { ...prev.fields, priority: event.target.checked },
                                            }))
                                        }
                                    />
                                    priority
                                </label>
                                <label className={includeDescriptionField ? '' : 'disabled'}>
                                    <input type="checkbox" checked={includeDescriptionField} readOnly disabled />
                                    description
                                </label>
                            </div>
                        </div>

                        <div className="builder-section">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={options.includeLinks}
                                    onChange={(event) =>
                                        setOptions((prev) => ({ ...prev, includeLinks: event.target.checked }))
                                    }
                                />
                                Include linked issues
                            </label>
                        </div>

                        <div className="builder-actions">
                            <button className="action-btn primary" type="button" onClick={handleBuildGraph}>
                                Build graph
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .task-graph-panel {
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  min-height: 0;
                  position: relative;
                }
                .task-graph-toolbar {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  gap: 10px;
                  padding: 10px;
                  border-bottom: 1px solid var(--border);
                  background: var(--bg-secondary);
                }
                .left-actions {
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .build-status {
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  font-size: 0.82rem;
                  color: var(--text-secondary);
                }
                .stats {
                  padding: 2px 8px;
                  border: 1px solid var(--border);
                  border-radius: 999px;
                  background: var(--bg-primary);
                }
                .task-graph-content {
                  flex: 1;
                  min-height: 0;
                  display: grid;
                  grid-template-columns: 1fr 320px;
                  overflow: hidden;
                }
                .graph-wrap {
                  min-height: 0;
                  height: 100%;
                  position: relative;
                  overflow: hidden;
                }
                .graph-wrap .tf-graph {
                  height: 100%;
                }
                .export-panel {
                  border-left: 1px solid var(--border);
                  background: var(--bg-primary);
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                  padding: 12px;
                  min-height: 0;
                }
                .export-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                }
                .export-header h3 {
                  margin: 0;
                  font-size: 0.95rem;
                }
                .field-toggles {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 6px;
                  font-size: 0.8rem;
                }
                .field-toggles label {
                  display: flex;
                  align-items: center;
                  gap: 6px;
                }
                .selection-actions {
                  display: grid;
                  gap: 8px;
                }
                .selected-preview {
                  border: 1px solid var(--border);
                  border-radius: 10px;
                  background: var(--bg-secondary);
                  padding: 8px;
                  overflow-y: auto;
                  min-height: 120px;
                  font-size: 0.8rem;
                }
                .selected-item {
                  display: flex;
                  gap: 6px;
                  margin-bottom: 6px;
                }
                .selected-item .key {
                  font-family: monospace;
                  font-weight: 700;
                  color: var(--accent);
                  min-width: 70px;
                }
                .selected-item .title {
                  color: var(--text-secondary);
                }
                .selected-item.muted {
                  color: var(--text-secondary);
                  opacity: 0.8;
                }
                .copy-status {
                  font-size: 0.78rem;
                  color: var(--text-secondary);
                }
                .action-btn {
                  border: 1px solid var(--border);
                  background: var(--bg-elevated);
                  color: var(--text-secondary);
                  border-radius: 10px;
                  padding: 7px 10px;
                  cursor: pointer;
                  font-size: 0.8rem;
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                }
                .action-btn:hover {
                  border-color: var(--accent);
                  color: var(--accent);
                  background: var(--accent-soft);
                }
                .action-btn:disabled {
                  opacity: 0.6;
                  cursor: not-allowed;
                }
                .action-btn.primary {
                  background: var(--accent-soft);
                  color: var(--accent);
                  border-color: var(--accent);
                }
                .builder-overlay {
                  position: absolute;
                  inset: 0;
                  background: rgba(10, 14, 20, 0.46);
                  backdrop-filter: blur(4px);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  z-index: 12;
                }
                .builder-modal {
                  width: min(640px, 90vw);
                  max-height: 86vh;
                  overflow-y: auto;
                  background: var(--bg-elevated);
                  border: 1px solid var(--border);
                  border-radius: 14px;
                  box-shadow: var(--shadow-lg);
                  padding: 14px;
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                }
                .builder-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                }
                .builder-header h3 {
                  margin: 0;
                }
                .builder-section {
                  display: flex;
                  flex-direction: column;
                  gap: 8px;
                  border: 1px solid var(--border);
                  border-radius: 10px;
                  padding: 10px;
                  background: var(--bg-primary);
                }
                .builder-section label {
                  font-weight: 600;
                  font-size: 0.84rem;
                }
                .builder-section select,
                .builder-section input[type='text'] {
                  border: 1px solid var(--border);
                  border-radius: 8px;
                  background: var(--bg-elevated);
                  color: var(--text-primary);
                  padding: 8px;
                }
                .inline-options {
                  display: grid;
                  grid-template-columns: repeat(3, minmax(0, 1fr));
                  gap: 8px;
                  font-size: 0.8rem;
                }
                .inline-options label,
                .field-toggles label {
                  font-weight: 500;
                }
                .warning {
                  margin: 0;
                  color: #f59e0b;
                  font-size: 0.8rem;
                }
                .disabled {
                  opacity: 0.65;
                }
                .builder-actions {
                  display: flex;
                  justify-content: flex-end;
                }
                .spin {
                  animation: spin 1s linear infinite;
                }
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
                @media (max-width: 1100px) {
                  .task-graph-content {
                    grid-template-columns: 1fr;
                  }
                  .export-panel {
                    border-left: none;
                    border-top: 1px solid var(--border);
                    max-height: 240px;
                  }
                }
            `}</style>
        </div>
    );
}
