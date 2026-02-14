import React from 'react';
import {
    CheckCircle2, Circle,
    ArrowUpCircle, ArrowDownCircle, MinusCircle
} from 'lucide-react';

export function IssueList({ issues, selectedId, onSelect }) {
    const [filters, setFilters] = React.useState({
        project: '',
        status: '',
        priority: '',
        assignee: '',
        search: ''
    });

    const normalizeIssue = (issue) => {
        const fields = issue?.fields || {};
        const status = issue?.status || fields.status?.name || '';
        const statusCategory = issue?.statusCategory || fields.status?.statusCategory?.name || '';
        const priority = issue?.priority || fields.priority?.name || '';
        const assignee =
            issue?.assignee ||
            fields.assignee?.displayName ||
            fields.assignee?.name ||
            fields.assignee?.emailAddress ||
            null;
        const projectKey = issue?.projectKey || fields.project?.key || '';
        const summary = issue?.summary || fields.summary || '';
        return {
            key: issue?.key,
            summary,
            projectKey,
            status,
            statusCategory,
            priority,
            assignee,
        };
    };

    const normalizedIssues = React.useMemo(() => {
        if (!issues) return [];
        return issues.map(normalizeIssue);
    }, [issues]);

    // Extract unique options
    const options = React.useMemo(() => {
        if (!normalizedIssues.length) return { projects: [], statuses: [], priorities: [], assignees: [] };
        const projects = [...new Set(normalizedIssues.map(i => i.projectKey).filter(Boolean))].sort();
        const statuses = [...new Set(normalizedIssues.map(i => i.status).filter(Boolean))].sort();
        const priorities = [...new Set(normalizedIssues.map(i => i.priority).filter(Boolean))].sort();
        const assignees = [...new Set(normalizedIssues.map(i => i.assignee || 'Unassigned'))].sort();
        return { projects, statuses, priorities, assignees };
    }, [normalizedIssues]);

    // Apply filters
    const filteredIssues = React.useMemo(() => {
        if (!normalizedIssues.length) return [];
        return normalizedIssues.filter(i => {
            if (filters.project && i.projectKey !== filters.project) return false;
            if (filters.status && i.status !== filters.status) return false;
            if (filters.priority && i.priority !== filters.priority) return false;
            if (filters.assignee && (i.assignee || 'Unassigned') !== filters.assignee) return false;
            if (filters.search) {
                const term = filters.search.toLowerCase();
                const match = (i.key || '').toLowerCase().includes(term) ||
                    (i.summary || '').toLowerCase().includes(term);
                if (!match) return false;
            }
            return true;
        });
    }, [normalizedIssues, filters]);

    if (!issues || issues.length === 0) {
        return <div className="empty-state">No issues found</div>;
    }

    return (
        <div className="issue-list-container">
            <div className="filter-bar">
                <input
                    type="text"
                    placeholder="Search visible..."
                    className="filter-input search"
                    value={filters.search}
                    onChange={e => setFilters({ ...filters, search: e.target.value })}
                />
                <select
                    className="filter-select"
                    value={filters.project}
                    onChange={e => setFilters({ ...filters, project: e.target.value })}
                >
                    <option value="">All Projects</option>
                    {options.projects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                    className="filter-select"
                    value={filters.status}
                    onChange={e => setFilters({ ...filters, status: e.target.value })}
                >
                    <option value="">All Statuses</option>
                    {options.statuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                    className="filter-select"
                    value={filters.priority}
                    onChange={e => setFilters({ ...filters, priority: e.target.value })}
                >
                    <option value="">All Priorities</option>
                    {options.priorities.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                    className="filter-select"
                    value={filters.assignee}
                    onChange={e => setFilters({ ...filters, assignee: e.target.value })}
                >
                    <option value="">All Assignees</option>
                    {options.assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                {(filters.project || filters.status || filters.priority || filters.assignee || filters.search) && (
                    <button className="clear-btn" onClick={() => setFilters({ project: '', status: '', priority: '', assignee: '', search: '' })}>
                        Clear
                    </button>
                )}
            </div>

            <div className="issue-list-scroll">
                <table className="table">
                    <thead>
                        <tr>
                            <th width="40"></th>
                            <th width="120">Key</th>
                            <th>Summary</th>
                            <th width="100">Status</th>
                            <th width="100">Priority</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredIssues.map(issue => (
                            <tr
                                key={issue.key}
                                className={issue.key === selectedId ? 'selected' : ''}
                                onClick={() => onSelect(issue.key)}
                            >
                                <td className="icon-cell">
                                    <StatusIcon category={issue.statusCategory} />
                                </td>
                                <td className="key-cell">{issue.key}</td>
                                <td className="summary-cell">
                                    <div className="summary-text">{issue.summary}</div>
                                </td>
                                <td><StatusBadge status={issue.status} category={issue.statusCategory} /></td>
                                <td><PriorityBadge priority={issue.priority} /></td>
                            </tr>
                        ))}
                        {filteredIssues.length === 0 && (
                            <tr><td colSpan="5" className="empty-state">No matches via filter</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <style>{`
        .issue-list-container {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .filter-bar {
            padding: 10px 12px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            overflow-x: hidden;
            align-items: center;
        }
        .filter-input, .filter-select {
            padding: 6px 10px;
            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--bg-elevated);
            color: var(--text-primary);
            font-size: 0.82rem;
        }
        .filter-input.search {
            width: 140px;
        }
        .clear-btn {
            background: none;
            border: none;
            color: var(--accent);
            cursor: pointer;
            font-size: 0.8rem;
            text-decoration: underline;
        }
        .issue-list-scroll {
          flex: 1;
          overflow-y: auto;
          animation: fadeUp 0.3s ease;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .table th {
          text-align: left;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          color: var(--text-secondary);
          background: var(--bg-secondary);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
        }
        .table tr:hover {
          background: var(--bg-secondary);
        }
        .table tr.selected {
          background: var(--accent-soft);
          border-left: 2px solid var(--accent);
        }
        .key-cell {
          font-family: monospace;
          color: var(--accent);
          font-weight: 500;
        }
        .summary-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 400px;
        }
        .icon-cell {
          text-align: center;
        }
        .empty-state {
          padding: 40px;
          text-align: center;
          color: var(--text-secondary);
        }
      `}</style>
        </div>
    );
}

export function StatusIcon({ category }) {
    const c = (category || '').toLowerCase();
    if (c === 'done') return <CheckCircle2 size={16} color="#10b981" />;
    if (c === 'in progress') return <Circle size={16} color="#3b82f6" fill="#3b82f640" />;
    return <Circle size={16} color="#6b7280" />;
}

export function StatusBadge({ status, category }) {
    const c = (category || '').toLowerCase();
    let color = 'var(--text-secondary)';
    let bg = '#e5e7eb';

    if (c === 'done') { color = '#065f46'; bg = '#d1fae5'; }
    else if (c === 'in progress') { color = '#1e40af'; bg = '#dbeafe'; }

    // Simple dark mode invert for bg (hacky but works for now without complex CSS vars)
    // Ideally use CSS vars for specific badges

    return (
        <span style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '10px',
            background: 'var(--bg-secondary)', // fallback
            border: '1px solid var(--border)',
            whiteSpace: 'nowrap'
        }}>
            {status}
        </span>
    );
}

export function PriorityBadge({ priority }) {
    const p = (priority || '').toLowerCase();
    let icon = <MinusCircle size={14} />;
    let color = 'var(--text-secondary)';

    if (p === 'highest' || p === 'high') {
        icon = <ArrowUpCircle size={14} />;
        color = '#ef4444';
    } else if (p === 'lowest' || p === 'low') {
        icon = <ArrowDownCircle size={14} />;
        color = '#10b981';
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
            {icon} <span>{priority}</span>
        </div>
    );
}
