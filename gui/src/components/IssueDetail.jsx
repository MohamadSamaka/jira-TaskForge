import React, { useState } from 'react';
import { Calendar, User, Clock, Copy, FileText, Code } from 'lucide-react';

export function IssueDetail({ issue, onClose, onSelectIssue }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!issue) {
    return (
      <div className="empty-selection">
        <p>Select an issue to view details</p>
      </div>
    );
  }

  const fields = issue.fields || {};
  const assigneeRaw = issue.assignee || fields.assignee;
  const assigneeName = (assigneeRaw && typeof assigneeRaw === 'object')
    ? (assigneeRaw.displayName || assigneeRaw.name || assigneeRaw.emailAddress)
    : assigneeRaw;

  const statusName = issue.status || fields.status?.name || 'Unknown';
  const statusCategory = issue.statusCategory || fields.status?.statusCategory?.name || '';
  const priorityName = issue.priority || fields.priority?.name || 'None';
  const projectKey = issue.projectKey || fields.project?.key || 'Unknown';
  const summary = issue.summary || fields.summary || '';
  const dueDate = issue.dueDate || fields.duedate || null;
  const parent = issue.parent || fields.parent || null;

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const descriptionPlain = issue.description_plain || fields.description_plain;
  const descriptionRaw = issue.description_raw || fields.description;

  const desc = showRaw
    ? (descriptionRaw ? JSON.stringify(descriptionRaw, null, 2) : 'No raw description available.')
    : (descriptionPlain && descriptionPlain !== 'None')
      ? descriptionPlain
      : <span className="text-muted">No description available for this issue.</span>;

  const assigneeDisplay = (assigneeName && assigneeName !== 'None') ? assigneeName : null;
  const dueDateDisplay = (dueDate && dueDate !== 'None') ? dueDate : null;

  return (
    <div className="issue-detail">
      <div className="detail-header">
        <div className="breadcrumbs">
          {projectKey} / <span className="current-key">{issue.key}</span>
        </div>
        <div className="detail-actions">
          <button className="btn-icon" onClick={() => copyToClipboard(issue.key)} title="Copy Key">
            <Copy size={16} />
          </button>
        </div>
      </div>

      <div className="detail-content">
        <h1 className="issue-summary">{summary}</h1>

        <div className="meta-grid">
          <MetaItem
            icon={<User size={16} />}
            label="Assignee"
            value={assigneeDisplay || <span className="text-muted">Unassigned</span>}
          />
          <MetaItem icon={<Clock size={16} />} label="Status" value={statusName} />
          <MetaItem
            icon={<Calendar size={16} />}
            label="Due Date"
            value={dueDateDisplay || <span className="text-muted">None</span>}
          />
          <MetaItem icon={<AlertIcon priority={priorityName} />} label="Priority" value={priorityName} />
        </div>

        {parent && (
          <div className="parent-section">
            <span className="label">Parent:</span>
            <button
              className="issue-link"
              onClick={() => onSelectIssue && onSelectIssue(parent.key)}
              type="button"
            >
              {parent.key} {parent.summary}
            </button>
          </div>
        )}

        <div className="description-section">
          <div className="section-header">
            <h3>Description</h3>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${!showRaw ? 'active' : ''}`}
                onClick={() => setShowRaw(false)}
              >
                <FileText size={14} /> Plain
              </button>
              <button
                className={`toggle-btn ${showRaw ? 'active' : ''}`}
                onClick={() => setShowRaw(true)}
              >
                <Code size={14} /> Raw
              </button>
            </div>
          </div>
          <div className="description-content">
            {showRaw ? <pre>{desc}</pre> : <div className="markdown-body">{desc}</div>}
          </div>
        </div>

        {/* Placeholder for subtasks/links - typically passed as props or focus mode */}
      </div>

      <style>{`
        .issue-detail {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-primary);
        }
        .detail-header {
          padding: 15px 20px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--bg-secondary);
        }
        .breadcrumbs {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
        .current-key {
          font-weight: 600;
          color: var(--text-primary);
        }
        .detail-content {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
        }
        .issue-summary {
          margin: 0 0 20px 0;
          font-size: 1.6rem;
          font-weight: 700;
          line-height: 1.3;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 25px;
          padding: 16px;
          background: var(--bg-elevated);
          border-radius: 12px;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
        }
        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .meta-label {
          font-size: 0.8rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .meta-value {
          font-weight: 600;
        }
        .description-section {
          margin-top: 20px;
        }
        .parent-section {
          margin: 10px 0 20px 0;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
        }
        .parent-section .label {
          color: var(--text-secondary);
          font-weight: 600;
        }
        .issue-link {
          color: var(--accent);
          text-decoration: none;
          font-weight: 600;
          background: var(--accent-soft);
          padding: 4px 10px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
        }
        .issue-link:hover {
          text-decoration: underline;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 8px;
        }
        .section-header h3 {
          margin: 0;
          font-size: 1.1rem;
        }
        .toggle-group {
          display: flex;
          background: var(--bg-secondary);
          border-radius: 999px;
          padding: 3px;
        }
        .toggle-btn {
          border: none;
          background: none;
          padding: 4px 12px;
          font-size: 0.8rem;
          border-radius: 999px;
          cursor: pointer;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .toggle-btn.active {
          background: var(--bg-primary);
          color: var(--accent);
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .description-content {
          font-family: 'Space Grotesk', sans-serif;
          line-height: 1.6;
          white-space: pre-wrap;
          font-size: 0.95rem;
        }
        .description-content pre {
          background: var(--bg-secondary);
          padding: 10px;
          border-radius: 10px;
          overflow-x: auto;
          font-family: monospace;
          font-size: 0.85rem;
        }
        .empty-selection {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
        }
        .text-muted {
          color: var(--text-secondary);
          font-style: italic;
          font-weight: 400;
        }
      `}</style>
    </div>
  );
}

function MetaItem({ icon, label, value }) {
  return (
    <div className="meta-item">
      <div className="meta-label">{icon} {label}</div>
      <div className="meta-value">{value}</div>
    </div>
  );
}

function AlertIcon({ priority }) {
  const p = (priority || '').toLowerCase();
  let color = '#6b7280';
  if (p === 'highest' || p === 'high') color = '#ef4444';
  else if (p === 'medium') color = '#f59e0b';
  else if (p === 'low' || p === 'lowest') color = '#10b981';
  return <div style={{ width: 12, height: 12, background: color, borderRadius: '50%' }} />;
}
