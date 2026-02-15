import React from 'react';
import { issues as issuesApi } from '../api';
import {
    CheckCircle2, Circle,
    ArrowUpCircle, ArrowDownCircle, MinusCircle
} from 'lucide-react';

function MultiSelect({
    id,
    label,
    options,
    selected,
    onChange,
    placeholder,
    exclusiveValue,
    isOpen,
    onOpenChange,
}) {
    const [localOpen, setLocalOpen] = React.useState(false);
    const rootRef = React.useRef(null);
    const open = typeof isOpen === 'boolean' ? isOpen : localOpen;

    const setOpen = (next) => {
        if (typeof isOpen === 'boolean') {
            onOpenChange?.(next, id);
        } else {
            setLocalOpen(next);
        }
    };

    const labelMap = React.useMemo(() => {
        const map = {};
        options.forEach(opt => { map[opt.value] = opt.label; });
        return map;
    }, [options]);

    const displayValue = React.useMemo(() => {
        if (!selected.length) return placeholder || 'Any';
        const labels = selected.map(v => labelMap[v] || v);
        if (labels.length === 1) return labels[0];
        const first = labels[0];
        return `${first} +${labels.length - 1}`;
    }, [selected, labelMap, placeholder]);

    React.useEffect(() => {
        if (!open) return;
        const handleClick = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    React.useEffect(() => {
        if (typeof isOpen === 'boolean') {
            setLocalOpen(isOpen);
        }
    }, [isOpen]);

    const toggleValue = (value) => {
        const isSelected = selected.includes(value);
        let next = [];
        if (isSelected) {
            next = selected.filter(v => v !== value);
        } else {
            if (exclusiveValue && value === exclusiveValue) {
                next = [exclusiveValue];
            } else {
                next = selected.filter(v => v !== exclusiveValue);
                next = [...next, value];
            }
        }
        onChange(next);
    };

    return (
        <div className="multi-select" ref={rootRef}>
            <button className="multi-btn" onClick={() => setOpen(!open)} type="button">
                <span className="label">{label}</span>
                <span className="value">{displayValue}</span>
            </button>
            {open && (
                <div className="multi-menu">
                    <button className="multi-clear" type="button" onClick={() => onChange([])}>
                        Clear {label}
                    </button>
                    {options.map(opt => (
                        <div
                            key={opt.value}
                            className="multi-option"
                            onClick={() => toggleValue(opt.value)}
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(opt.value)}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleValue(opt.value)}
                            />
                            <span>{opt.label}</span>
                        </div>
                    ))}
                    {!options.length && (
                        <div className="multi-option" style={{ opacity: 0.7 }}>
                            No options
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function IssueList({ issues, selectedId, onSelect, onFiltersChange }) {
    const [filters, setFilters] = React.useState({
        projects: [],
        statuses: [],
        priorities: [],
        assignees: [],
        search: ''
    });
    const [assigneeOptions, setAssigneeOptions] = React.useState([]);
    const [assigneeLoading, setAssigneeLoading] = React.useState(false);
    const [assigneeError, setAssigneeError] = React.useState(null);
    const initialized = React.useRef(false);
    const [openMenu, setOpenMenu] = React.useState(null);

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
        const assigneeId =
            issue?.assigneeId ||
            fields.assignee?.accountId ||
            fields.assignee?.name ||
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
            assigneeId,
        };
    };

    const normalizedIssues = React.useMemo(() => {
        if (!issues) return [];
        return issues.map(normalizeIssue);
    }, [issues]);

    React.useEffect(() => {
        let mounted = true;
        const loadAssignees = async () => {
            setAssigneeLoading(true);
            setAssigneeError(null);
            try {
                const projectParam = (filters.projects || []).length
                    ? filters.projects.join(',')
                    : undefined;
                const res = await issuesApi.assignees(projectParam);
                const list = (res.data.assignees || []).map(a => ({
                    value: a.id ? `id:${a.id}` : `name:${a.displayName}`,
                    label: a.displayName
                })).filter(a => a.label);
                if (mounted) setAssigneeOptions(list);
                if (res.data.warning && mounted) {
                    setAssigneeError(res.data.warning);
                }
            } catch (err) {
                if (mounted) setAssigneeError(err.response?.data?.detail || err.message);
            } finally {
                if (mounted) setAssigneeLoading(false);
            }
        };
        loadAssignees();
        return () => { mounted = false; };
    }, [filters.projects]);

    const assigneeValueToLabel = React.useMemo(() => {
        const map = {};
        assigneeOptions.forEach(a => { map[a.value] = a.label; });
        map.UNASSIGNED = 'Unassigned';
        map.__ANY__ = 'Any assignee';
        return map;
    }, [assigneeOptions]);

    // Extract unique options
    const options = React.useMemo(() => {
        if (!normalizedIssues.length) return { projects: [], statuses: [], priorities: [], assignees: [] };
        const projects = [...new Set(normalizedIssues.map(i => i.projectKey).filter(Boolean))].sort();
        const statuses = [...new Set(normalizedIssues.map(i => i.status).filter(Boolean))].sort();
        const priorities = [...new Set(normalizedIssues.map(i => i.priority).filter(Boolean))].sort();
        return { projects, statuses, priorities };
    }, [normalizedIssues]);

    React.useEffect(() => {
        if (!onFiltersChange) return;
        if (!initialized.current) {
            initialized.current = true;
            return;
        }
        const assigneeAny = filters.assignees.includes('__ANY__');
        const payload = {
            projects: filters.projects,
            statuses: filters.statuses,
            priorities: filters.priorities,
            assignees: assigneeAny ? [] : filters.assignees.filter(v => v !== '__ANY__'),
            assigneeAny,
        };
        onFiltersChange(payload);
    }, [filters.projects, filters.statuses, filters.priorities, filters.assignees, onFiltersChange]);

    // Apply filters
    const filteredIssues = React.useMemo(() => {
        if (!normalizedIssues.length) return [];
        return normalizedIssues.filter(i => {
            if (filters.projects.length && !filters.projects.includes(i.projectKey)) return false;
            if (filters.statuses.length && !filters.statuses.includes(i.status)) return false;
            if (filters.priorities.length && !filters.priorities.includes(i.priority)) return false;
            if (filters.assignees.length && !filters.assignees.includes('__ANY__')) {
                const selected = filters.assignees;
                const hasUnassigned = selected.includes('UNASSIGNED');
                const hasAssignee = Boolean(i.assignee || i.assigneeId);
                if (!hasAssignee && hasUnassigned) return true;
                if (!hasAssignee && !hasUnassigned) return false;
                const assigneeName = i.assignee || '';
                const assigneeId = i.assigneeId || '';
                const match = selected.some((value) => {
                    if (value === 'UNASSIGNED') return false;
                    if (value.startsWith('id:')) return assigneeId === value.slice(3);
                    if (value.startsWith('name:')) return assigneeName === value.slice(5);
                    const label = assigneeValueToLabel[value];
                    return assigneeName === (label || value);
                });
                if (!match) return false;
            }
            if (filters.search) {
                const term = filters.search.toLowerCase();
                const match = (i.key || '').toLowerCase().includes(term) ||
                    (i.summary || '').toLowerCase().includes(term);
                if (!match) return false;
            }
            return true;
        });
    }, [normalizedIssues, filters]);

    const emptyLabel = normalizedIssues.length ? 'No matches via filter' : 'No issues found';

    return (
        <div className="issue-list-container">
            <div className="filter-bar">
                <div className="filter-row">
                    <div className="search-wrap">
                        <span className="filter-label">Search</span>
                        <input
                            type="text"
                            placeholder="Key, summary, or text..."
                            className="filter-input search"
                            value={filters.search}
                            onChange={e => setFilters({ ...filters, search: e.target.value })}
                        />
                    </div>
                    <div className="filter-actions">
                        {assigneeLoading && <span className="mini-spinner" title="Loading assignees" />}
                        {assigneeError && <span className="assignee-warn">Assignees unavailable</span>}
                        {(filters.projects.length || filters.statuses.length || filters.priorities.length || filters.assignees.length || filters.search) && (
                            <button
                                className="clear-btn"
                                onClick={() => {
                                    setFilters({ projects: [], statuses: [], priorities: [], assignees: [], search: '' });
                                    setOpenMenu(null);
                                }}
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                </div>
                <div className="filter-row">
                    <MultiSelect
                        id="project"
                        label="Project"
                        options={options.projects.map(p => ({ value: p, label: p }))}
                        selected={filters.projects}
                        onChange={(values) => setFilters({ ...filters, projects: values })}
                        placeholder="Any project"
                        isOpen={openMenu === 'project'}
                        onOpenChange={(next) => setOpenMenu(next ? 'project' : null)}
                    />
                    <MultiSelect
                        id="status"
                        label="Status"
                        options={options.statuses.map(s => ({ value: s, label: s }))}
                        selected={filters.statuses}
                        onChange={(values) => setFilters({ ...filters, statuses: values })}
                        placeholder="Any status"
                        isOpen={openMenu === 'status'}
                        onOpenChange={(next) => setOpenMenu(next ? 'status' : null)}
                    />
                    <MultiSelect
                        id="priority"
                        label="Priority"
                        options={options.priorities.map(p => ({ value: p, label: p }))}
                        selected={filters.priorities}
                        onChange={(values) => setFilters({ ...filters, priorities: values })}
                        placeholder="Any priority"
                        isOpen={openMenu === 'priority'}
                        onOpenChange={(next) => setOpenMenu(next ? 'priority' : null)}
                    />
                    <MultiSelect
                        id="assignee"
                        label="Assignee"
                        options={[
                            { value: '__ANY__', label: 'Any assignee' },
                            { value: 'UNASSIGNED', label: 'Unassigned' },
                            ...assigneeOptions
                        ]}
                        selected={filters.assignees}
                        onChange={(values) => setFilters({ ...filters, assignees: values })}
                        placeholder="Me (default)"
                        exclusiveValue="__ANY__"
                        isOpen={openMenu === 'assignee'}
                        onOpenChange={(next) => setOpenMenu(next ? 'assignee' : null)}
                    />
                </div>
            </div>

            <div className="issue-list-scroll scroll-area">
                <div className="issue-table">
                    <div className="issue-row header">
                        <div className="cell icon"></div>
                        <div className="cell key">Key</div>
                        <div className="cell summary">Summary</div>
                    </div>
                    {filteredIssues.map(issue => (
                        <div
                            key={issue.key}
                            className={`issue-row ${issue.key === selectedId ? 'selected' : ''}`}
                            onClick={() => onSelect(issue.key)}
                            role="button"
                            tabIndex={0}
                        >
                            <div className="cell icon">
                                <StatusIcon category={issue.statusCategory} />
                            </div>
                            <div className="cell key">{issue.key}</div>
                            <div className="cell summary">
                                <div className="summary-main">{issue.summary}</div>
                                <div className="summary-meta">
                                    <div className="summary-meta-left">
                                        <span>{issue.projectKey || 'No project'}</span>
                                        <span className="dot" aria-hidden="true">&bull;</span>
                                        <span>{issue.assignee || 'Unassigned'}</span>
                                    </div>
                                    <div className="summary-badges">
                                        <StatusBadge status={issue.status} category={issue.statusCategory} />
                                        <PriorityBadge priority={issue.priority} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {filteredIssues.length === 0 && (
                        <div className="empty-state">{emptyLabel}</div>
                    )}
                </div>
            </div>

            <style>{`
        .issue-list-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .filter-bar {
            padding: 10px 12px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            display: flex;
            gap: 10px;
            flex-direction: column;
            overflow: visible;
            align-items: stretch;
            position: sticky;
            top: 0;
            z-index: 30;
        }
        .filter-row {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
        }
        .filter-label {
            font-size: 0.7rem;
            text-transform: uppercase;
            color: var(--text-secondary);
            letter-spacing: 0.08em;
            font-weight: 700;
            margin-right: 8px;
        }
        .search-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            min-width: 220px;
        }
        .filter-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .filter-input, .filter-select {
            padding: 6px 10px;
            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--bg-elevated);
            color: var(--text-primary);
            font-size: 0.82rem;
        }
        .mini-spinner {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            animation: spin 0.8s linear infinite;
        }
        .assignee-warn {
            font-size: 0.75rem;
            color: #ef4444;
        }
        .filter-input.search {
            flex: 1;
            min-width: 180px;
        }
        .multi-select {
            position: relative;
        }
        .multi-btn {
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            color: var(--text-primary);
            padding: 6px 10px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 0.8rem;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .multi-btn .label {
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.65rem;
            letter-spacing: 0.08em;
            color: var(--text-secondary);
        }
        .multi-btn .value {
            white-space: nowrap;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .multi-menu {
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            min-width: 220px;
            max-height: 260px;
            overflow-y: auto;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: var(--shadow-md);
            padding: 8px;
            z-index: 50;
        }
        .multi-option {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.85rem;
        }
        .multi-option:hover {
            background: var(--bg-secondary);
        }
        .multi-clear {
            width: 100%;
            text-align: left;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 6px 8px;
            margin-bottom: 6px;
            font-size: 0.8rem;
            cursor: pointer;
            color: var(--text-secondary);
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
          min-height: 0;
          position: relative;
          z-index: 1;
          overflow-x: hidden;
        }
        .issue-table {
          display: flex;
          flex-direction: column;
        }
        .issue-row {
          display: grid;
          grid-template-columns: 28px 100px minmax(0, 1fr);
          gap: 10px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
          align-items: center;
          cursor: pointer;
        }
        .issue-row:hover {
          background: var(--bg-secondary);
        }
        .issue-row.selected {
          background: var(--accent-soft);
          border-left: 2px solid var(--accent);
        }
        .issue-row.header {
          position: sticky;
          top: 0;
          z-index: 10;
          background: var(--bg-secondary);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-secondary);
          font-weight: 700;
          cursor: default;
        }
        .issue-row.header .cell.key,
        .issue-row.header .cell.summary {
          color: var(--text-secondary);
          font-family: inherit;
          font-weight: 700;
        }
        .issue-row.header:hover {
          background: var(--bg-secondary);
        }
        .cell {
          min-width: 0;
        }
        .cell.icon {
          text-align: center;
        }
        .cell.key {
          font-family: monospace;
          color: var(--accent);
          font-weight: 600;
        }
        .summary-main {
          font-size: 0.92rem;
          color: var(--text-primary);
          line-height: 1.2;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .summary-meta {
          margin-top: 4px;
          font-size: 0.75rem;
          color: var(--text-secondary);
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .summary-meta-left {
          display: inline-flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }
        .summary-meta-left .dot {
          opacity: 0.6;
        }
        .summary-badges {
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .empty-state {
          padding: 40px;
          text-align: center;
          color: var(--text-secondary);
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
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
