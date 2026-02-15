import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
    useNodesState,
    useEdgesState,
    MiniMap,
    Controls,
    Background,
    MarkerType,
    Handle,
    Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useTheme } from '../hooks/useTheme';

// Layout configuration
const nodeWidth = 240;
const nodeHeight = 120;

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
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

    nodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const width = node.data?.layout?.width || nodeWidth;
        const height = node.data?.layout?.height || nodeHeight;
        node.targetPosition = 'top';
        node.sourcePosition = 'bottom';

        // Shift position to center anchor
        node.position = {
            x: nodeWithPosition.x - width / 2,
            y: nodeWithPosition.y - height / 2,
        };

        return node;
    });

    return { nodes, edges };
};

export function GraphView({ focusKey, data, onSelect }) {
    const { isDark } = useTheme();
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const nodeTypes = useMemo(() => ({ issue: IssueNode }), []);

    useEffect(() => {
        if (!data) return;

        const { issue, parent, subtasks, siblings, linked } = data;
        const initialNodes = [];
        const initialEdges = [];
        const processed = new Set();

        const addNode = (item, type, labelOverride = null) => {
            if (!item || !item.key || processed.has(item.key)) return;
            processed.add(item.key);

            const summary = labelOverride || item.summary || '';
            const status = item.status || '';
            const statusCategory = item.statusCategory || '';
            const priority = item.priority || '';
            const assignee = item.assignee || '';

            const layout = type === 'focus'
                ? { width: 280, height: 130 }
                : { width: 240, height: 120 };

            initialNodes.push({
                id: item.key,
                type: 'issue',
                data: {
                    key: item.key,
                    summary,
                    status,
                    statusCategory,
                    priority,
                    assignee,
                    kind: type,
                    layout
                },
                position: { x: 0, y: 0 }, // layout will fix this
                style: {
                    width: layout.width,
                    height: layout.height
                }
            });
        };

        // 1. Focus Node
        addNode(issue, 'focus');

        // 2. Parent
        if (parent) {
            addNode(parent, 'parent');
            initialEdges.push({
                id: `e-${parent.key}-${issue.key}`,
                source: parent.key,
                target: issue.key,
                type: 'smoothstep',
                markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
                style: { stroke: '#10b981', strokeWidth: 2 },
                label: 'parent',
                labelBgPadding: [6, 4],
                labelBgBorderRadius: 6
            });

            // Siblings attached to parent
            if (siblings) {
                siblings.forEach(sib => {
                    addNode(sib, 'sibling');
                    initialEdges.push({
                        id: `e-${parent.key}-${sib.key}`,
                        source: parent.key,
                        target: sib.key,
                        type: 'smoothstep',
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
                        style: { stroke: '#94a3b8' },
                        label: 'sibling',
                        labelBgPadding: [6, 4],
                        labelBgBorderRadius: 6
                    });
                });
            }
        }

        // 3. Subtasks
        if (subtasks) {
            subtasks.forEach(sub => {
                addNode(sub, 'subtask');
                initialEdges.push({
                    id: `e-${issue.key}-${sub.key}`,
                    source: issue.key,
                    target: sub.key,
                    type: 'smoothstep',
                    label: 'subtask',
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
                    style: { stroke: '#3b82f6' },
                    labelBgPadding: [6, 4],
                    labelBgBorderRadius: 6
                });
            });
        }

        // 4. Linked
        if (linked) {
            linked.forEach(link => {
                const targetKey = link.linked_key;
                if (!processed.has(targetKey)) {
                    addNode(link.full_issue || { key: targetKey, summary: 'External' }, 'linked');
                }

                // Link logic
                const isOutward = link.direction === 'outward';
                const source = isOutward ? issue.key : targetKey;
                const target = isOutward ? targetKey : issue.key;

                initialEdges.push({
                    id: `e-${source}-${target}-${link.type}`,
                    source: source,
                    target: target,
                    animated: true,
                    label: link.type,
                    style: { stroke: '#f59e0b', strokeWidth: 2 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
                    labelBgPadding: [6, 4],
                    labelBgBorderRadius: 6
                });
            });
        }

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            initialNodes,
            initialEdges
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);

    }, [data, isDark, setNodes, setEdges]); // re-run on data change

    const onNodeClick = useCallback((event, node) => {
        if (onSelect) onSelect(node.id);
    }, [onSelect]);

    return (
        <div className="tf-graph">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    style: { strokeWidth: 2, stroke: isDark ? '#475569' : '#94a3b8' },
                    markerEnd: { type: MarkerType.ArrowClosed, color: isDark ? '#475569' : '#94a3b8' }
                }}
            >
                <Background color={isDark ? '#273244' : '#e5e7eb'} gap={20} />
                <Controls position="bottom-right" />
                <MiniMap style={{ background: isDark ? '#0f172a' : '#ffffff' }} maskColor="rgba(0,0,0,0.2)" />
            </ReactFlow>
            <div className="graph-legend">
                <div className="legend-item focus">Focus</div>
                <div className="legend-item parent">Parent</div>
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
    const { isDark } = useTheme();
    const kindLabel = {
        focus: 'Focus',
        parent: 'Parent',
        subtask: 'Subtask',
        sibling: 'Sibling',
        linked: 'Linked'
    }[data.kind] || 'Issue';

    const statusKey = (data.statusCategory || '').toLowerCase();
    const statusClass = statusKey === 'done' ? 'done' : statusKey === 'in progress' ? 'progress' : 'todo';

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
                <span className={`tf-badge status ${statusClass}`}>{data.status || 'Unknown'}</span>
                {data.priority && <span className="tf-badge">{data.priority}</span>}
                {data.assignee && <span className="tf-badge">{data.assignee}</span>}
            </div>
        </div>
    );
}
