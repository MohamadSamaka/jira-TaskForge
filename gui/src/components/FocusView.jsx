import React, { useEffect, useState } from 'react';
import { issues as issuesApi } from '../api';
import { StatusBadge, PriorityBadge } from './IssueList';
import { ArrowUp, ArrowDown, GitCommit, Link as LinkIcon, ChevronRight, ChevronDown } from 'lucide-react';

export function FocusView({ issueKey, onSelect }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (issueKey) {
            loadFocusData();
        }
    }, [issueKey]);

    const loadFocusData = async () => {
        setLoading(true);
        try {
            const res = await issuesApi.focus(issueKey);
            setData(res.data);
        } catch (err) {
            console.error("Failed to load focus data", err);
        } finally {
            setLoading(false);
        }
    };

    if (!issueKey) return <div className="empty-state">Select an issue to focus</div>;
    if (loading || !data) return <div className="loading">Loading focus view...</div>;

    const { issue, parent, subtasks, siblings, linked } = data;

    return (
        <div className="focus-view">
            <div className="focus-header">
                <h2>Focus Mode: <span className="key">{issue.key}</span></h2>
            </div>

            <div className="focus-content">
                {/* PARENT SECTION */}
                {parent && (
                    <div className="section parent-section">
                        <h3 className="section-title"><ArrowUp size={16} /> Parent</h3>
                        <IssueCard issue={parent} onClick={() => onSelect(parent.key)} isParent />
                    </div>
                )}

                {/* CURRENT ISSUE SECTION */}
                <div className="section current-section">
                    <h3 className="section-title"><GitCommit size={16} /> Selected Issue</h3>
                    <div className="current-issue-card">
                        <div className="card-header">
                            <span className="summary">{issue.summary}</span>
                            <StatusBadge status={issue.status} category={issue.statusCategory} />
                        </div>
                        <div className="card-meta">
                            <PriorityBadge priority={issue.priority} />
                            <span>{issue.assignee || 'Unassigned'}</span>
                        </div>
                        <div className="description-preview">
                            {issue.description_plain ? issue.description_plain.slice(0, 200) + '...' : 'No description'}
                        </div>
                    </div>
                </div>

                {/* SIBLINGS SECTION */}
                {siblings.length > 0 && (
                    <div className="section siblings-section">
                        <h3 className="section-title">Siblings ({siblings.length})</h3>
                        <div className="card-list">
                            {siblings.map(sib => (
                                <IssueCard key={sib.key} issue={sib} onClick={() => onSelect(sib.key)} compact />
                            ))}
                        </div>
                    </div>
                )}

                {/* SUBTASKS SECTION */}
                {subtasks.length > 0 && (
                    <div className="section subtasks-section">
                        <h3 className="section-title"><ArrowDown size={16} /> Subtasks ({subtasks.length})</h3>
                        <div className="card-list">
                            {subtasks.map(sub => (
                                <IssueCard key={sub.key} issue={sub} onClick={() => onSelect(sub.key)} />
                            ))}
                        </div>
                    </div>
                )}

                {/* LINKED ISSUES SECTION */}
                {linked.length > 0 && (
                    <div className="section linked-section">
                        <h3 className="section-title"><LinkIcon size={16} /> Linked Issues ({linked.length})</h3>
                        <div className="card-list">
                            {linked.map(link => (
                                <div key={link.linked_key} className="linked-card" onClick={() => onSelect(link.linked_key)}>
                                    <span className="link-type">{link.type} {link.direction}</span>
                                    <IssueCard issue={link.full_issue || { key: link.linked_key, summary: 'Unknown issue' }} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
        .focus-view {
          padding: 20px;
          height: 100%;
          overflow-y: auto;
          background: var(--bg-secondary);
        }
        .focus-header {
          margin-bottom: 20px;
        }
        .key {
          color: var(--accent);
          font-family: monospace;
        }
        .section {
          margin-bottom: 30px;
        }
        .section-title {
          font-size: 1rem;
          color: var(--text-secondary);
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .card-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 10px;
        }
        .issue-card {
          background: var(--bg-primary);
          padding: 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          cursor: pointer;
          transition: transform 0.1s, box-shadow 0.1s;
        }
        .issue-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          border-color: var(--accent);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 8px;
        }
        .card-key {
          font-family: monospace;
          font-weight: 600;
          color: var(--text-secondary);
          font-size: 0.85rem;
        }
        .card-summary {
          font-weight: 500;
          font-size: 0.95rem;
        }
        .card-meta {
          display: flex;
          gap: 15px;
          font-size: 0.8rem;
          color: var(--text-secondary);
          align-items: center;
        }
        .current-issue-card {
          background: var(--bg-primary);
          border: 2px solid var(--accent);
          padding: 20px;
          border-radius: 8px;
        }
        .current-issue-card .summary {
          font-size: 1.2rem;
          font-weight: 600;
        }
        .description-preview {
          margin-top: 15px;
          font-size: 0.9rem;
          color: var(--text-secondary);
          border-top: 1px solid var(--border);
          padding-top: 10px;
        }
        .linked-card {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .link-type {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--text-secondary);
          font-weight: 600;
        }
      `}</style>
        </div>
    );
}

function IssueCard({ issue, onClick, isParent, compact }) {
    if (!issue) return null;
    return (
        <div className={`issue-card ${isParent ? 'parent' : ''}`} onClick={onClick}>
            <div className="card-header">
                <div>
                    <div className="card-key">{issue.key}</div>
                    <div className="card-summary">{issue.summary}</div>
                </div>
                <StatusBadge status={issue.status} category={issue.statusCategory} />
            </div>
            {!compact && (
                <div className="card-meta">
                    <PriorityBadge priority={issue.priority} />
                    <span>{issue.items ? issue.items.length + ' subtasks' : ''}</span>
                </div>
            )}
        </div>
    );
}
