import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    useNodesState,
    useEdgesState,
    MiniMap,
    Controls,
    Background,
    MarkerType,
    Handle,
    Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useTheme } from '../hooks/useTheme';

const nodeWidth = 240;
const nodeHeight = 120;

function getLayoutedElements(nodes, edges, direction = 'TB') {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: direction, ranksep: 90, nodesep: 60 });

    nodes.forEach((node) => {
        const width = node.data?.layout?.width || nodeWidth;
        const height = node.data?.layout?.height || nodeHeight;
        dagreGraph.setNode(node.id, { width, height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const positioned = nodes.map((node) => {
        const pos = dagreGraph.node(node.id);
        const width = node.data?.layout?.width || nodeWidth;
        const height = node.data?.layout?.height || nodeHeight;
        return {
            ...node,
            targetPosition: 'top',
            sourcePosition: 'bottom',
            position: {
                x: (pos?.x || 0) - width / 2,
                y: (pos?.y || 0) - height / 2,
            },
        };
    });

    return { nodes: positioned, edges };
}

function normalizeNode(node) {
    return {
        id: node.id,
        key: node.id,
        summary: node.label || node.metadata?.title || '',
        status: node.metadata?.status || '',
        statusCategory: node.metadata?.statusCategory || '',
        priority: node.metadata?.priority || '',
        assignee: node.metadata?.assignee || '',
        kind: node.kind || node.metadata?.type || 'issue',
    };
}

function edgeDecoration(edge, isDark) {
    if (edge.type === 'issue-link') {
        return {
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
            label: edge.relation || edge.linkType || 'link',
        };
    }
    if (edge.type === 'parent-child') {
        return {
            style: { stroke: '#3b82f6', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
            label: 'parent/child',
        };
    }
    return {
        style: { stroke: isDark ? '#475569' : '#94a3b8', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: isDark ? '#475569' : '#94a3b8' },
        label: edge.type || '',
    };
}

function focusToGraph(data) {
    if (!data) return { nodes: [], edges: [] };
    const { issue, parent, subtasks = [], siblings = [], linked = [] } = data;
    if (!issue?.key) return { nodes: [], edges: [] };

    const nodes = new Map();
    const edges = [];
    const put = (item, kind, labelOverride = null) => {
        if (!item?.key || nodes.has(item.key)) return;
        nodes.set(item.key, {
            id: item.key,
            key: item.key,
            label: labelOverride || item.summary || '',
            metadata: {
                status: item.status || '',
                statusCategory: item.statusCategory || '',
                priority: item.priority || '',
                assignee: item.assignee || '',
                type: kind,
            },
            kind,
        });
    };

    put(issue, 'focus');
    if (parent) {
        put(parent, 'parent');
        edges.push({ from: parent.key, to: issue.key, type: 'parent-child' });
        siblings.forEach((sib) => {
            put(sib, 'sibling');
            edges.push({ from: parent.key, to: sib.key, type: 'parent-child' });
        });
    }
    subtasks.forEach((sub) => {
        put(sub, 'subtask');
        edges.push({ from: issue.key, to: sub.key, type: 'parent-child' });
    });
    linked.forEach((link) => {
        const targetKey = link?.linked_key;
        if (!targetKey) return;
        put(link.full_issue || { key: targetKey, summary: link.linked_summary || 'Linked issue' }, 'linked');
        const isOutward = link.direction === 'outward';
        edges.push({
            from: isOutward ? issue.key : targetKey,
            to: isOutward ? targetKey : issue.key,
            type: 'issue-link',
            relation: link.relation || link.type,
            linkType: link.type,
        });
    });

    return { nodes: Array.from(nodes.values()), edges };
}

function toFlowGraph(graph, isDark, displayFields) {
    const rfNodes = (graph?.nodes || []).map((node) => {
        const normalized = normalizeNode(node);
        const isFocus = normalized.kind === 'focus';
        const layout = isFocus ? { width: 280, height: 130 } : { width: 240, height: 120 };
        return {
            id: normalized.id,
            type: 'issue',
            data: {
                ...normalized,
                layout,
                displayFields,
            },
            position: { x: 0, y: 0 },
            style: {
                width: layout.width,
                height: layout.height,
            },
        };
    });

    const rfEdges = (graph?.edges || []).map((edge, idx) => {
        const visual = edgeDecoration(edge, isDark);
        return {
            id: edge.id || `e-${edge.from}-${edge.to}-${edge.type || idx}`,
            source: edge.from,
            target: edge.to,
            type: 'smoothstep',
            ...visual,
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 6,
        };
    });
    return getLayoutedElements(rfNodes, rfEdges);
}

export function GraphView({
    data,
    graph = null,
    onSelect,
    onSelectionChange,
    selectedNodeIds = [],
    displayFields = { status: true, assignee: true, priority: true },
}) {
    const { isDark } = useTheme();
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [stableFocusGraph, setStableFocusGraph] = useState({ nodes: [], edges: [] });

    const nodeTypes = useMemo(() => ({ issue: IssueNode }), []);
    const liveFocusGraph = useMemo(() => focusToGraph(data), [data]);
    const sourceGraph = graph || stableFocusGraph;

    useEffect(() => {
        if (graph) return;
        if ((liveFocusGraph.nodes || []).length === 0) return;
        setStableFocusGraph(liveFocusGraph);
    }, [graph, liveFocusGraph]);

    useEffect(() => {
        const { nodes: layoutedNodes, edges: layoutedEdges } = toFlowGraph(
            sourceGraph,
            isDark,
            displayFields,
        );
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [sourceGraph, isDark, setNodes, setEdges, displayFields]);

    useEffect(() => {
        const selected = new Set((selectedNodeIds || []).map((id) => id.toUpperCase()));
        setNodes((prevNodes) =>
            prevNodes.map((node) => {
                const shouldSelect = selected.has((node.id || '').toUpperCase());
                if (Boolean(node.selected) === shouldSelect) return node;
                return { ...node, selected: shouldSelect };
            }),
        );
    }, [selectedNodeIds, setNodes]);

    const onNodeClick = useCallback(
        (event, node) => {
            if (onSelect) onSelect(node.id);
        },
        [onSelect],
    );

    const onInternalSelectionChange = useCallback(
        (params = {}) => {
            const selectedNodes = params.nodes || [];
            if (!onSelectionChange) return;
            onSelectionChange(selectedNodes.map((node) => node.id));
        },
        [onSelectionChange],
    );

    return (
        <div className="tf-graph">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onSelectionChange={onInternalSelectionChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                selectionOnDrag
                multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                panOnDrag
                zoomOnScroll
                zoomOnPinch
                zoomOnDoubleClick
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    style: { strokeWidth: 2, stroke: isDark ? '#475569' : '#94a3b8' },
                    markerEnd: { type: MarkerType.ArrowClosed, color: isDark ? '#475569' : '#94a3b8' },
                }}
            >
                <Background color={isDark ? '#273244' : '#e5e7eb'} gap={20} />
                <Controls position="bottom-left" showInteractive style={{ zIndex: 20 }} />
                <MiniMap style={{ background: isDark ? '#0f172a' : '#ffffff' }} maskColor="rgba(0,0,0,0.2)" />
            </ReactFlow>
            <div className="graph-legend">
                <div className="legend-item focus">Focus</div>
                <div className="legend-item parent">Hierarchy</div>
                <div className="legend-item link">Linked</div>
            </div>
            <style>{`
                .tf-graph {
                  height: 100%;
                  width: 100%;
                  background: ${isDark ? 'radial-gradient(circle at top, rgba(59,130,246,0.08), transparent 45%), #0b1220' : 'radial-gradient(circle at top, rgba(59,130,246,0.08), transparent 45%), #f8fafc'};
                  position: relative;
                }
                .tf-node {
                  background: ${isDark ? '#0f172a' : '#ffffff'};
                  border: 1px solid ${isDark ? '#1e293b' : '#e5e7eb'};
                  border-radius: 12px;
                  padding: 10px 12px;
                  box-shadow: ${isDark ? '0 8px 20px rgba(0,0,0,0.35)' : '0 8px 20px rgba(15,23,42,0.08)'};
                  color: ${isDark ? '#e2e8f0' : '#0f172a'};
                }
                .tf-node.focus {
                  border-color: #3b82f6;
                  box-shadow: 0 0 0 1px rgba(59,130,246,0.6), 0 10px 24px rgba(59,130,246,0.25);
                }
                .tf-node.parent {
                  border-color: #10b981;
                }
                .tf-node.subtask {
                  border-color: ${isDark ? '#334155' : '#e2e8f0'};
                }
                .tf-node-header {
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 8px;
                  margin-bottom: 6px;
                }
                .tf-key {
                  font-family: monospace;
                  font-weight: 700;
                  font-size: 0.75rem;
                  color: ${isDark ? '#93c5fd' : '#1d4ed8'};
                }
                .tf-kind {
                  font-size: 0.65rem;
                  text-transform: uppercase;
                  letter-spacing: 0.08em;
                  color: ${isDark ? '#94a3b8' : '#64748b'};
                }
                .tf-summary {
                  font-size: 0.85rem;
                  line-height: 1.2;
                  display: -webkit-box;
                  -webkit-line-clamp: 2;
                  -webkit-box-orient: vertical;
                  overflow: hidden;
                }
                .tf-meta {
                  margin-top: 8px;
                  display: flex;
                  gap: 6px;
                  flex-wrap: wrap;
                }
                .tf-badge {
                  font-size: 0.65rem;
                  padding: 2px 6px;
                  border-radius: 999px;
                  border: 1px solid ${isDark ? '#334155' : '#e2e8f0'};
                  background: ${isDark ? '#0b1220' : '#f8fafc'};
                  color: ${isDark ? '#cbd5f5' : '#475569'};
                }
                .tf-badge.status.done { color: #10b981; border-color: rgba(16,185,129,0.4); }
                .tf-badge.status.progress { color: #3b82f6; border-color: rgba(59,130,246,0.4); }
                .tf-badge.status.todo { color: #94a3b8; border-color: rgba(148,163,184,0.4); }
                .tf-graph .react-flow__edge-text {
                  fill: ${isDark ? '#cbd5f5' : '#475569'};
                  font-size: 10px;
                  font-weight: 600;
                }
                .tf-graph .react-flow__edge-textbg {
                  fill: ${isDark ? '#0f172a' : '#ffffff'};
                  stroke: ${isDark ? '#1e293b' : '#e2e8f0'};
                }
                .graph-legend {
                  position: absolute;
                  top: 12px;
                  right: 12px;
                  display: flex;
                  gap: 6px;
                  background: ${isDark ? '#0f172a' : '#ffffff'};
                  border: 1px solid ${isDark ? '#1e293b' : '#e2e8f0'};
                  padding: 6px 8px;
                  border-radius: 999px;
                  font-size: 0.7rem;
                  color: ${isDark ? '#cbd5f5' : '#475569'};
                  box-shadow: ${isDark ? '0 6px 14px rgba(0,0,0,0.35)' : '0 6px 14px rgba(15,23,42,0.08)'};
                }
                .legend-item {
                  padding: 2px 6px;
                  border-radius: 999px;
                  border: 1px solid transparent;
                }
                .legend-item.focus { border-color: #3b82f6; color: #3b82f6; }
                .legend-item.parent { border-color: #10b981; color: #10b981; }
                .legend-item.link { border-color: #f59e0b; color: #f59e0b; }
            `}</style>
        </div>
    );
}

function IssueNode({ data }) {
    const kindLabel = {
        focus: 'Focus',
        parent: 'Parent',
        subtask: 'Subtask',
        sibling: 'Sibling',
        linked: 'Linked',
    }[data.kind] || data.kind || 'Issue';

    const statusKey = (data.statusCategory || '').toLowerCase();
    const statusClass = statusKey === 'done' ? 'done' : statusKey === 'in progress' ? 'progress' : 'todo';

    const showStatus = data.displayFields?.status !== false;
    const showPriority = data.displayFields?.priority !== false;
    const showAssignee = data.displayFields?.assignee !== false;

    return (
        <div className={`tf-node ${data.kind}`}>
            <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
            <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
            <div className="tf-node-header">
                <span className="tf-key">{data.key}</span>
                <span className="tf-kind">{kindLabel}</span>
            </div>
            <div className="tf-summary">{data.summary || 'No summary'}</div>
            <div className="tf-meta">
                {showStatus && <span className={`tf-badge status ${statusClass}`}>{data.status || 'Unknown'}</span>}
                {showPriority && data.priority && <span className="tf-badge">{data.priority}</span>}
                {showAssignee && data.assignee && <span className="tf-badge">{data.assignee}</span>}
            </div>
        </div>
    );
}
