import React, { useCallback, useEffect } from 'react';
import ReactFlow, {
    useNodesState,
    useEdgesState,
    addEdge,
    MiniMap,
    Controls,
    Background,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useTheme } from '../hooks/useTheme';

// Layout configuration
const nodeWidth = 180;
const nodeHeight = 80;

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    nodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = 'top';
        node.sourcePosition = 'bottom';

        // Shift position to center anchor
        node.position = {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
        };

        return node;
    });

    return { nodes, edges };
};

export function GraphView({ focusKey, data, onSelect }) {
    const { isDark } = useTheme();
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        if (!data) return;

        const { issue, parent, subtasks, siblings, linked } = data;
        const initialNodes = [];
        const initialEdges = [];
        const processed = new Set();

        const addNode = (item, type, labelOverride = null) => {
            if (!item || !item.key || processed.has(item.key)) return;
            processed.add(item.key);

            let bg = isDark ? '#1f2937' : '#ffffff';
            let border = isDark ? '#374151' : '#e5e7eb';
            let color = isDark ? '#f3f4f6' : '#1f2937';

            if (type === 'focus') {
                bg = '#3b82f6'; border = '#2563eb'; color = '#ffffff';
            } else if (type === 'parent') {
                bg = '#10b981'; border = '#059669'; color = '#ffffff';
            } else if (type === 'subtask') {
                // keep default
            }

            initialNodes.push({
                id: item.key,
                data: { label: labelOverride || `${item.key}\n${(item.summary || '').slice(0, 25)}...` },
                position: { x: 0, y: 0 }, // layout will fix this
                style: {
                    background: bg,
                    border: `2px solid ${border}`,
                    color: color,
                    width: nodeWidth,
                    fontSize: '12px',
                    borderRadius: '8px',
                    padding: '8px',
                    textAlign: 'center'
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
                markerEnd: { type: MarkerType.ArrowClosed }
            });

            // Siblings attached to parent
            if (siblings) {
                siblings.forEach(sib => {
                    addNode(sib, 'sibling');
                    initialEdges.push({
                        id: `e-${parent.key}-${sib.key}`,
                        source: parent.key,
                        target: sib.key,
                        type: 'smoothstep'
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
                    label: 'subtask'
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
                    style: { stroke: '#f59e0b' }
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
        <div style={{ height: '100%', width: '100%', background: isDark ? '#111827' : '#f9fafb' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                fitView
            >
                <Background color={isDark ? '#374151' : '#e5e7eb'} gap={16} />
                <Controls />
                <MiniMap style={{ background: isDark ? '#1f2937' : '#fff' }} />
            </ReactFlow>
        </div>
    );
}
