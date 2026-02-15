import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout } from './components/Layout';
import { IssueList } from './components/IssueList';
import { IssueTree } from './components/IssueTree';
import { IssueDetail } from './components/IssueDetail';
import { FocusView } from './components/FocusView';
import { TaskGraphPanel } from './components/TaskGraphPanel';
import { AIPanel } from './components/AIPanel';
import { AdvisorPanel } from './components/AdvisorPanel';
import { SearchBar } from './components/SearchBar';
import { ConfigPanel } from './components/ConfigPanel';
import { SavedQueries } from './components/SavedQueries';
import { system, issues as issuesApi, queries } from './api';
import { List, GitMerge, LayoutDashboard, Share2, Bot, BrainCircuit, ChevronLeft, ChevronRight } from 'lucide-react';

function App() {
    const [issues, setIssues] = useState([]);
    const [filteredIssues, setFilteredIssues] = useState(null); // null means showing all
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [activeFilter, setActiveFilter] = useState(null);
    // View Modes
    const [leftView, setLeftView] = useState('list'); // 'list', 'tree'
    const [rightView, setRightView] = useState('detail'); // 'detail', 'focus', 'graph', 'ai', 'advisor'
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [leftPanelLoading, setLeftPanelLoading] = useState(false);
    const [rightPanelLoading, setRightPanelLoading] = useState(false);
    const leftPanelTimer = useRef(null);
    const rightPanelTimer = useRef(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const issue = params.get('issue');
        const right = params.get('right');
        const left = params.get('left');
        if (left === 'list' || left === 'tree') setLeftView(left);
        if (['detail', 'focus', 'graph', 'ai', 'advisor'].includes(right || '')) {
            setRightView(right);
        }
        if (issue) setSelectedId(issue.toUpperCase());
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (selectedId) params.set('issue', selectedId);
        else params.delete('issue');
        params.set('left', leftView);
        params.set('right', rightView);
        const qs = params.toString();
        const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState(null, '', nextUrl);
    }, [selectedId, leftView, rightView]);

    useEffect(() => {
        const onPopState = () => {
            const params = new URLSearchParams(window.location.search);
            const issue = params.get('issue');
            const right = params.get('right');
            const left = params.get('left');
            if (left === 'list' || left === 'tree') setLeftView(left);
            if (['detail', 'focus', 'graph', 'ai', 'advisor'].includes(right || '')) {
                setRightView(right);
            }
            setSelectedId(issue ? issue.toUpperCase() : null);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const displayIssues = filteredIssues || issues;
    const selectedIssue = issues.find(i => i.key === selectedId);

    // Needed for graph view to get focus data even if issue not in main list
    const [focusData, setFocusData] = useState(null);

    const loadFocusData = async (key) => {
        try {
            const res = await issuesApi.focus(key);
            setFocusData(res.data);
        } catch (err) {
            console.error("Failed to load focus data", err);
        }
    };

    const handleSearchResults = (results, label) => {
        setFilteredIssues(results);
        if (Array.isArray(results) && label) {
            setActiveFilter({ label, count: results.length });
            return;
        }
        setActiveFilter(null);
    };

    const handleQuerySelect = async (queryType, label) => {
        setLoading(true);
        setFilteredIssues(null);
        setActiveFilter(null);
        try {
            let res;
            if (queryType === 'blocked') res = await queries.blocked();
            else if (queryType === 'next') res = await queries.next();
            else if (queryType === 'today') res = await queries.today();
            else if (queryType === 'project') res = await queries.byProject();

            if (res && res.data) {
                let results = [];
                if (res.data.blocked) results = res.data.blocked.map(b => b.issue);
                else if (res.data.ranked) results = res.data.ranked.map(r => r.issue);
                else if (res.data.issues) results = res.data.issues;
                else if (res.data.groups) results = Object.values(res.data.groups).flat();
                else if (Array.isArray(res.data)) results = res.data;

                if (results.length) {
                    setFilteredIssues(results);
                    setActiveFilter({ label: label || 'Filter', count: results.length });
                } else {
                    setFilteredIssues([]);
                    setActiveFilter({ label: label || 'Filter', count: 0 });
                }
            }
        } catch (err) {
            console.error("Query failed", err);
        } finally {
            setLoading(false);
        }
    };

    // When selection changes, ensure right panel makes sense
    useEffect(() => {
        if (selectedId) {
            if (rightView === 'ai' || rightView === 'advisor') {
                // Keep AI/Advisor open
            } else if (rightView === 'graph') {
                loadFocusData(selectedId);
            } else if (rightView === 'focus') {
                // Focus view auto-updates
            } else {
                setRightView('detail');
            }
        }
    }, [selectedId]);

    const handleSync = async () => {
        setSyncing(true);
        try {
            await system.sync();
            refreshIssues();
        } catch (error) {
            console.error("Sync failed:", error);
        } finally {
            setSyncing(false);
        }
    };

    const refreshIssues = async () => {
        setLoading(true);
        try {
            const res = await issuesApi.list({ limit: 100 });
            setIssues(res.data.issues || []);
        } catch (err) {
            console.error("Failed to load issues", err);
        } finally {
            setLoading(false);
        }
    };

    const handleRemoteFilters = useCallback(async (filterPayload) => {
        setLoading(true);
        setFilteredIssues(null);
        setActiveFilter(null);
        try {
            const params = { limit: 100 };
            const projects = (filterPayload.projects || []).slice().sort();
            const statuses = (filterPayload.statuses || []).slice().sort();
            const priorities = (filterPayload.priorities || []).slice().sort();
            const assignees = (filterPayload.assignees || []).slice().sort();
            if (projects.length) params.projects = projects.join(',');
            if (statuses.length) params.statuses = statuses.join(',');
            if (priorities.length) params.priorities = priorities.join(',');
            if (filterPayload.assigneeAny) {
                params.assignee_any = true;
            } else if (assignees.length) {
                params.assignees = assignees.join(',');
            }
            const res = await issuesApi.list(params);
            const nextIssues = res.data.issues || [];
            setIssues(nextIssues);
            setSelectedId((prev) => (prev && !nextIssues.find(i => i.key === prev) ? null : prev));
        } catch (err) {
            console.error("Failed to load filtered issues", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshIssues();
    }, []);

    const clearFilter = () => {
        setFilteredIssues(null);
        setActiveFilter(null);
    };

    const triggerLeftPanel = () => {
        if (leftPanelTimer.current) clearTimeout(leftPanelTimer.current);
        setLeftPanelLoading(true);
        leftPanelTimer.current = setTimeout(() => setLeftPanelLoading(false), 280);
    };

    const triggerRightPanel = () => {
        if (rightPanelTimer.current) clearTimeout(rightPanelTimer.current);
        setRightPanelLoading(true);
        rightPanelTimer.current = setTimeout(() => setRightPanelLoading(false), 280);
    };

    return (
        <Layout
            onSync={handleSync}
            isSyncing={syncing}
            onOpenSettings={() => setShowConfig(true)}
        >
            <div className="split-pane">
                <div className={`left-pane ${leftCollapsed ? 'collapsed' : ''}`}>
                    <div className="pane-header">
                        <div className="view-toggles">
                            {!leftCollapsed && (
                                <>
                                    <button
                                        className={leftView === 'list' ? 'active' : ''}
                                        onClick={() => {
                                            if (leftView !== 'list') {
                                                triggerLeftPanel();
                                                setLeftView('list');
                                            }
                                        }}
                                        title="List View"
                                    >
                                        <List size={18} />
                                    </button>
                                    <button
                                        className={leftView === 'tree' ? 'active' : ''}
                                        onClick={() => {
                                            if (leftView !== 'tree') {
                                                triggerLeftPanel();
                                                setLeftView('tree');
                                            }
                                        }}
                                        title="Tree View"
                                    >
                                        <GitMerge size={18} />
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="pane-actions">
                            {!leftCollapsed && <span className="count-badge">{displayIssues.length}</span>}
                            <button
                                className="collapse-btn"
                                onClick={() => setLeftCollapsed(prev => !prev)}
                                title={leftCollapsed ? 'Expand left pane' : 'Collapse left pane'}
                            >
                                {leftCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                            </button>
                        </div>
                    </div>

                    {!leftCollapsed && <SearchBar onResults={handleSearchResults} />}

                    {!leftCollapsed && <SavedQueries onSelectQuery={handleQuerySelect} />}

                    {!leftCollapsed && activeFilter && (
                        <div className="active-filter">
                            <span className="filter-label">{activeFilter.label}</span>
                            <span className="filter-count">{activeFilter.count}</span>
                            <button className="filter-clear" onClick={clearFilter}>Clear</button>
                        </div>
                    )}

                    <div className="pane-content">
                        {(loading || leftPanelLoading) && (
                            <div className="pane-spinner">
                                <div className="spinner-ring" />
                                <span>Loading…</span>
                            </div>
                        )}
                        {leftCollapsed ? (
                            <div className="collapsed-rail">
                                <div className="collapsed-count">{displayIssues.length}</div>
                            <div className="collapsed-list scroll-area">
                                {displayIssues.map((issue) => (
                                    <button
                                        key={issue.key}
                                        className={`collapsed-item ${issue.key === selectedId ? 'active' : ''}`}
                                            onClick={() => setSelectedId(issue.key)}
                                            title={issue.summary || issue.key}
                                        >
                                            {issue.key}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            leftView === 'list' ? (
                                <IssueList
                                    issues={displayIssues}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                    onFiltersChange={handleRemoteFilters}
                                />
                            ) : (
                                <IssueTree
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                />
                            )
                        )}
                    </div>
                </div>

                {/* RIGHT PANE */}
                <div className="right-pane">
                    <div className="pane-header">
                        <div className="view-toggles">
                            <button
                                className={rightView === 'detail' ? 'active' : ''}
                                onClick={() => {
                                    if (rightView !== 'detail') {
                                        triggerRightPanel();
                                        setRightView('detail');
                                    }
                                }}
                                title="Details"
                            >
                                <LayoutDashboard size={18} /> Details
                            </button>
                            <button
                                className={rightView === 'focus' ? 'active' : ''}
                                onClick={() => {
                                    if (rightView !== 'focus') {
                                        triggerRightPanel();
                                        setRightView('focus');
                                    }
                                }}
                                title="Focus Mode"
                            >
                                <Share2 size={18} /> Focus
                            </button>
                            <button
                                className={rightView === 'graph' ? 'active' : ''}
                                onClick={() => {
                                    if (rightView !== 'graph') {
                                        triggerRightPanel();
                                    }
                                    setRightView('graph');
                                    if (selectedId) loadFocusData(selectedId);
                                }}
                                title="Graph View"
                            >
                                <GitMerge size={18} /> Graph
                            </button>
                            <button
                                className={rightView === 'ai' ? 'active' : ''}
                                onClick={() => {
                                    if (rightView !== 'ai') {
                                        triggerRightPanel();
                                        setRightView('ai');
                                    }
                                }}
                                title="AI Assistant"
                            >
                                <Bot size={18} /> AI
                            </button>
                            <button
                                className={rightView === 'advisor' ? 'active' : ''}
                                onClick={() => {
                                    if (rightView !== 'advisor') {
                                        triggerRightPanel();
                                        setRightView('advisor');
                                    }
                                }}
                                title="Task Advisor"
                            >
                                <BrainCircuit size={18} /> Advisor
                            </button>
                        </div>
                    </div>

                    <div className="pane-content">
                        {rightPanelLoading && (
                            <div className="pane-spinner">
                                <div className="spinner-ring" />
                                <span>Switching…</span>
                            </div>
                        )}
                        {rightView === 'detail' && (
                            <IssueDetail
                                issue={selectedIssue}
                                onClose={() => setSelectedId(null)}
                                onSelectIssue={setSelectedId}
                            />
                        )}
                        {rightView === 'focus' && (
                            <FocusView issueKey={selectedId} onSelect={setSelectedId} />
                        )}
                        {rightView === 'graph' && (
                            <TaskGraphPanel
                                focusData={focusData}
                                focusKey={selectedId}
                                onSelectIssue={(nodeId) => setSelectedId(nodeId)}
                                onRefocus={loadFocusData}
                            />
                        )}
                        {rightView === 'ai' && (
                            <AIPanel onSelectIssue={setSelectedId} />
                        )}
                        {rightView === 'advisor' && (
                            <AdvisorPanel issueKey={selectedId} />
                        )}
                    </div>
                </div>
            </div>

            {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

            <style>{`
            .split-pane { display: flex; width: 100%; height: calc(100vh - 64px); gap: 16px; padding: 16px; }
            .left-pane { width: 420px; border: 1px solid var(--border); border-radius: var(--radius-lg); display: flex; flex-direction: column; background: var(--bg-elevated); box-shadow: var(--shadow-sm); overflow: visible; transition: width 0.25s ease; }
            .left-pane.collapsed { width: 120px; overflow: hidden; }
            .right-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-elevated); border-radius: var(--radius-lg); border: 1px solid var(--border); box-shadow: var(--shadow-sm); }
            .pane-header { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary); height: 44px; position: sticky; top: 0; z-index: 15; }
            .view-toggles { display: flex; gap: 6px; flex-wrap: wrap; }
            .view-toggles button { border: 1px solid transparent; background: none; padding: 6px 10px; border-radius: 999px; cursor: pointer; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; font-size: 0.82rem; font-weight: 600; transition: all 0.2s ease; }
            .view-toggles button:hover { background: var(--bg-primary); color: var(--text-primary); border-color: var(--border); }
            .view-toggles button.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
            .count-badge { font-size: 0.75rem; background: var(--bg-primary); padding: 2px 10px; border-radius: 999px; color: var(--text-secondary); border: 1px solid var(--border); }
            .pane-actions { display: flex; gap: 8px; align-items: center; }
            .collapse-btn { border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-secondary); border-radius: 999px; padding: 4px 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
            .collapse-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
            .pane-content { flex: 1; overflow: hidden; position: relative; animation: fadeUp 0.35s ease; }
            .left-pane .pane-content { overflow: visible; min-height: 0; }
            .right-pane .pane-content { overflow: hidden; }
            .collapsed-rail {
              display: flex;
              flex-direction: column;
              align-items: stretch;
              gap: 10px;
              padding: 10px 6px;
              color: var(--text-secondary);
              height: 100%;
              background: radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 50%);
            }
            .collapsed-count {
              font-size: 0.7rem;
              text-align: center;
              padding: 6px 0;
              border: 1px solid var(--border);
              border-radius: 999px;
              background: var(--bg-primary);
              color: var(--text-secondary);
            }
            .collapsed-list {
              display: flex;
              flex-direction: column;
              gap: 6px;
              overflow-y: auto;
              padding-bottom: 6px;
            }
            .collapsed-item {
              border: 1px solid var(--border);
              background: var(--bg-primary);
              color: var(--text-secondary);
              border-radius: 10px;
              padding: 6px 4px;
              font-size: 0.72rem;
              cursor: pointer;
              text-align: center;
              font-family: monospace;
              letter-spacing: 0.02em;
            }
            .collapsed-item:hover {
              border-color: var(--accent);
              color: var(--accent);
              background: var(--accent-soft);
            }
            .collapsed-item.active {
              border-color: var(--accent);
              color: var(--accent);
              background: var(--accent-soft);
            }
            .scroll-area::-webkit-scrollbar {
              width: 8px;
              height: 8px;
            }
            .scroll-area::-webkit-scrollbar-thumb {
              background: linear-gradient(180deg, var(--accent) 0%, var(--accent-soft) 100%);
              border-radius: 999px;
              border: 1px solid var(--border);
            }
            .scroll-area::-webkit-scrollbar-track {
              background: transparent;
            }
            .scroll-area {
              scrollbar-width: thin;
              scrollbar-color: var(--accent) transparent;
            }
            .pane-spinner {
              position: absolute;
              inset: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 10px;
              background: linear-gradient(180deg, rgba(10, 14, 20, 0.18), rgba(10, 14, 20, 0.35));
              color: var(--text-secondary);
              font-size: 0.85rem;
              letter-spacing: 0.02em;
              z-index: 5;
              backdrop-filter: blur(3px);
            }
            .spinner-ring {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              border: 3px solid var(--border);
              border-top-color: var(--accent);
              animation: spin 0.9s linear infinite;
            }
            .active-filter {
              margin: 0 10px 10px 10px;
              padding: 8px 10px;
              border: 1px solid var(--border);
              border-radius: 10px;
              background: var(--bg-secondary);
              display: flex;
              align-items: center;
              gap: 8px;
              justify-content: space-between;
            }
            .filter-label {
              font-size: 0.85rem;
              color: var(--text-primary);
              font-weight: 600;
            }
            .filter-count {
              font-size: 0.75rem;
              color: var(--text-secondary);
              padding: 2px 8px;
              border-radius: 999px;
              background: var(--bg-primary);
              border: 1px solid var(--border);
            }
            .filter-clear {
              background: none;
              border: 1px solid var(--border);
              padding: 4px 10px;
              border-radius: 999px;
              cursor: pointer;
              color: var(--text-secondary);
              font-size: 0.75rem;
            }
            .filter-clear:hover {
              border-color: var(--accent);
              color: var(--accent);
            }
            @media (max-width: 980px) {
              .split-pane {
                flex-direction: column;
                height: auto;
              }
              .left-pane {
                width: 100%;
                height: 50vh;
              }
              .right-pane {
                height: 60vh;
              }
            }
            @media (max-width: 640px) {
              .split-pane {
                padding: 10px;
              }
              .left-pane,
              .right-pane {
                height: auto;
                min-height: 320px;
              }
              .view-toggles {
                gap: 4px;
              }
              .view-toggles button {
                padding: 6px 8px;
                font-size: 0.75rem;
              }
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
            `}</style>
        </Layout>
    );
}

export default App;
