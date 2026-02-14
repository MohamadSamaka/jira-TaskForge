import React, { useState, useEffect } from 'react';
import { issues as issuesApi } from '../api';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { StatusIcon, StatusBadge } from './IssueList';

export function IssueTree({ onSelect, selectedId }) {
    const [treeData, setTreeData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState({});

    useEffect(() => {
        loadTree();
    }, []);

    const loadTree = async () => {
        setLoading(true);
        try {
            const res = await issuesApi.tree();
            setTreeData(res.data.tree || []);
            // Auto-expand top level
            const initialExpanded = {};
            (res.data.tree || []).forEach(node => initialExpanded[node.key] = true);
            setExpanded(initialExpanded);
        } catch (err) {
            console.error("Failed to load tree", err);
        } finally {
            setLoading(false);
        }
    };

    const toggleExpand = (e, key) => {
        e.stopPropagation();
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const buildExpandedMap = (nodes) => {
        const map = {};
        const walk = (node) => {
            if (!node || !node.key) return;
            map[node.key] = true;
            (node.children || []).forEach(walk);
        };
        nodes.forEach(walk);
        return map;
    };

    const expandAll = () => {
        setExpanded(buildExpandedMap(treeData));
    };

    const collapseAll = () => {
        setExpanded({});
    };

    const TreeNode = ({ node, level = 0 }) => {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = expanded[node.key];
        const isSelected = node.key === selectedId;

        return (
            <div className="tree-node-container">
                <div
                    className={`tree-row ${isSelected ? 'selected' : ''}`}
                    style={{ paddingLeft: `${level * 20 + 8}px` }}
                    onClick={() => onSelect(node.key)}
                >
                    <div className="expand-icon" onClick={(e) => hasChildren && toggleExpand(e, node.key)}>
                        {hasChildren ? (
                            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                        ) : <span style={{ width: 14 }} />}
                    </div>

                    <div className="node-content">
                        <span className="key">{node.key}</span>
                        <span className="summary">{node.summary}</span>
                    </div>

                    {node.status && <StatusBadge status={node.status} category={node.statusCategory} />}
                </div>

                {hasChildren && isExpanded && (
                    <div className="children">
                        {node.children.map(child => (
                            <TreeNode key={child.key} node={child} level={level + 1} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="tree-loading">
                <div className="spinner-ring" />
                <span>Building tree...</span>
            </div>
        );
    }
    if (!treeData.length) {
        return (
            <div className="empty-state">
                <div className="empty-title">No tree data</div>
                <div className="empty-sub">Run sync first, then refresh.</div>
            </div>
        );
    }

    return (
        <div className="issue-tree">
            <div className="tree-toolbar">
                <span className="tree-title">Tree View</span>
                <div className="tree-actions">
                    <button className="tree-btn" onClick={expandAll} disabled={!treeData.length}>
                        Expand all
                    </button>
                    <button className="tree-btn" onClick={collapseAll} disabled={!treeData.length}>
                        Collapse all
                    </button>
                </div>
            </div>
            {treeData.map(node => (
                <TreeNode key={node.key} node={node} />
            ))}
            <style>{`
        .tree-loading {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-secondary);
          font-size: 0.85rem;
          letter-spacing: 0.02em;
        }
        .spinner-ring {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid var(--border);
          border-top-color: var(--accent);
          animation: spin 0.9s linear infinite;
        }
        .empty-state {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          color: var(--text-secondary);
          text-align: center;
        }
        .empty-title {
          font-weight: 600;
          color: var(--text-primary);
        }
        .empty-sub {
          font-size: 0.8rem;
          opacity: 0.8;
        }
        .issue-tree {
          height: 100%;
          overflow-y: auto;
          font-size: 0.9rem;
          animation: fadeUp 0.3s ease;
        }
        .tree-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          position: sticky;
          top: 0;
          z-index: 2;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border);
        }
        .tree-title {
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .tree-actions {
          display: flex;
          gap: 6px;
        }
        .tree-btn {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--bg-secondary);
          color: var(--text-secondary);
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .tree-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .tree-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tree-row {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          cursor: pointer;
          border-bottom: 1px solid var(--border);
          gap: 8px;
        }
        .tree-row:hover {
          background: var(--bg-secondary);
        }
        .tree-row.selected {
          background: var(--accent-soft);
          border-left: 2px solid var(--accent);
        }
        .expand-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          cursor: pointer;
          color: var(--text-secondary);
        }
        .expand-icon:hover {
          color: var(--text-primary);
        }
        .node-content {
          flex: 1;
          display: flex;
          gap: 10px;
          overflow: hidden;
          align-items: baseline;
        }
        .key {
          font-family: monospace;
          color: var(--accent);
          font-weight: 500;
          font-size: 0.85rem;
        }
        .summary {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}
