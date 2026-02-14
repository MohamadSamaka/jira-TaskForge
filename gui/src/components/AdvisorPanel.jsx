import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, Terminal, Play, XCircle } from 'lucide-react';
import api, { ai } from '../api';

export function AdvisorPanel({ issueKey }) {
    const [prompt, setPrompt] = useState(null);
    const [dataset, setDataset] = useState(null);
    const [loadingPrompt, setLoadingPrompt] = useState(false);
    const [running, setRunning] = useState(false);
    const [viewMode, setViewMode] = useState('prompt'); // prompt | response
    const [responseInput, setResponseInput] = useState('');
    const [parsedResult, setParsedResult] = useState(null);
    const [copied, setCopied] = useState(false);
    const knownKeys = ['action', 'blockers', 'inconsistencies', 'missing'];
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [status, setStatus] = useState(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [modelsLoading, setModelsLoading] = useState(true);
    const [modelsError, setModelsError] = useState(null);
    const [includeCurrentDesc, setIncludeCurrentDesc] = useState(true);
    const [includeSubtaskDesc, setIncludeSubtaskDesc] = useState(false);
    const [includeParentDesc, setIncludeParentDesc] = useState(false);
    const [forceGroq, setForceGroq] = useState(false);
    const runControllerRef = useRef(null);
    const [groqAuthError, setGroqAuthError] = useState(null);

    useEffect(() => {
        const loadModels = async () => {
            setStatusLoading(true);
            setModelsLoading(true);
            setModelsError(null);
            try {
                const [statusRes, modelsRes] = await Promise.all([
                    ai.status(),
                    ai.models(),
                ]);
                setStatus(statusRes.data);
                setModels(modelsRes.data.models || []);
                if (modelsRes.data.errors) {
                    setModelsError(modelsRes.data.errors.join(" | "));
                }
                if (statusRes.data?.model) {
                    setSelectedModel(statusRes.data.model);
                }
            } catch (err) {
                console.error("Failed to load AI models/status", err);
                setModelsError(err.message);
            } finally {
                setStatusLoading(false);
                setModelsLoading(false);
            }
        };
        loadModels();
    }, []);

    useEffect(() => () => abortRun(), []);

    const renderValue = (value) => {
        if (value === null || value === undefined) return "None";
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return "None";
            return (
                <pre className="json-block">
                    {JSON.stringify(value, null, 2)}
                </pre>
            );
        }
        if (typeof value === 'object') {
            return (
                <pre className="json-block">
                    {JSON.stringify(value, null, 2)}
                </pre>
            );
        }
        return String(value);
    };

    useEffect(() => {
        if (!issueKey) return;
        setLoadingPrompt(true);
        // Fetch prompt
        api.get(`/advisor/prompt/${issueKey}`, {
            params: {
                include_current_description: includeCurrentDesc,
                include_subtask_descriptions: includeSubtaskDesc,
                include_parent_description: includeParentDesc,
            },
        })
            .then(res => setPrompt(res.data.prompt))
            .catch(err => console.error("Failed to fetch prompt", err))
            .finally(() => setLoadingPrompt(false));

        // Fetch dataset (optional, for debug/detailed view)
        api.get(`/advisor/dataset/${issueKey}`)
            .then(res => setDataset(res.data))
            .catch(err => console.error("Failed to fetch dataset", err));
    }, [issueKey, includeCurrentDesc, includeSubtaskDesc, includeParentDesc]);

    const handleCopy = () => {
        if (prompt) {
            navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const normalizeAdvisorResult = (result) => {
        if (result === null || result === undefined) return { action: null, blockers: [], inconsistencies: [], missing: null };
        if (typeof result !== 'object') return { action: result, blockers: [], inconsistencies: [], missing: null };
        const normalized = { ...result };
        if (!Object.prototype.hasOwnProperty.call(normalized, 'action')) {
            normalized.action =
                normalized.immediate_next_step ??
                normalized.immediate_task ??
                normalized.next_step ??
                normalized.summary ??
                null;
        }
        if (!Object.prototype.hasOwnProperty.call(normalized, 'blockers')) {
            normalized.blockers = normalized.blocker ?? normalized.dependencies ?? [];
        }
        if (!Object.prototype.hasOwnProperty.call(normalized, 'inconsistencies')) {
            normalized.inconsistencies = normalized.inconsistency ?? [];
        }
        if (!Object.prototype.hasOwnProperty.call(normalized, 'missing')) {
            normalized.missing = normalized.missing_info ?? normalized.missingInfo ?? null;
        }
        return normalized;
    };

    const handleParse = () => {
        try {
            // Flexible parsing: try to find JSON block if text is mixed
            const input = typeof responseInput === 'string'
                ? responseInput
                : JSON.stringify(responseInput, null, 2);
            let jsonStr = input;
            const match = input.match(/\{[\s\S]*\}/);
            if (match) jsonStr = match[0];

            const result = JSON.parse(jsonStr);
            setParsedResult(normalizeAdvisorResult(result));
        } catch (e) {
            alert("Failed to parse JSON: " + e.message);
        }
    };

    const abortRun = () => {
        if (runControllerRef.current) {
            runControllerRef.current.abort();
            runControllerRef.current = null;
            setRunning(false);
        }
    };

    const handleRunAdvisor = async () => {
        abortRun();
        setRunning(true);
        const controller = new AbortController();
        runControllerRef.current = controller;
        try {
            const { model, skipLocal } = resolveModelForRequest();
            const payload = {
                model,
                include_current_description: includeCurrentDesc,
                include_subtask_descriptions: includeSubtaskDesc,
                include_parent_description: includeParentDesc,
                skip_local: skipLocal,
            };
            const res = await api.post(`/advisor/run/${issueKey}`, payload, { signal: controller.signal });
            const responseText = (typeof res.data.response === 'string')
                ? res.data.response
                : JSON.stringify(res.data.response, null, 2);
            setResponseInput(responseText);
            setViewMode('response');
            setGroqAuthError(null);

            // Auto-parse if possible
            try {
                let jsonStr = responseText;
                const match = responseText.match(/\{[\s\S]*\}/);
                if (match) jsonStr = match[0];
                const result = JSON.parse(jsonStr);
                setParsedResult(normalizeAdvisorResult(result));
            } catch (e) {
                // If parse fails, user sees raw text in response view
                console.debug("Auto-parse failed", e);
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                setResponseInput("Request canceled.");
                setViewMode('response');
            } else {
                console.error("Advisor run failed", err);
                if (err.response?.status === 401 && String(err.response?.data?.detail || '').toLowerCase().includes('groq')) {
                    setGroqAuthError(err.response.data.detail);
                }
                alert("Failed to run advisor: " + (err.response?.data?.detail || err.message));
            }
        } finally {
            setRunning(false);
            runControllerRef.current = null;
        }
    };

    const modelOptions = (() => {
        if (!models.length) {
            return status?.model ? [{ name: status.model }] : [];
        }
        if (status?.model && !models.some(m => m.name === status.model)) {
            return [...models, { name: status.model }];
        }
        return models;
    })();

    const displayedModels = forceGroq
        ? modelOptions.filter(m => m.provider === 'groq')
        : modelOptions;

    useEffect(() => {
        if (!forceGroq) return;
        const groqModels = modelOptions.filter(m => m.provider === 'groq');
        if (!groqModels.length) return;
        if (!selectedModel || !groqModels.some(m => m.name === selectedModel)) {
            setSelectedModel(groqModels[0].name);
        }
    }, [forceGroq, models, status, selectedModel]);

    const resolveModelForRequest = () => {
        const selectedMeta = modelOptions.find(m => m.name === selectedModel);
        const skipLocal = forceGroq || selectedMeta?.provider === 'groq';
        if (!skipLocal) {
            return { model: selectedModel || undefined, skipLocal: false };
        }
        const groqFallback = modelOptions.find(m => m.provider === 'groq')?.name;
        const model = (selectedMeta?.provider === 'groq')
            ? selectedModel
            : (groqFallback || undefined);
        return { model, skipLocal: true };
    };

    if (loadingPrompt && !prompt) {
        return (
            <div className="advisor-loading">
                <div className="typing-dots">
                    <span />
                    <span />
                    <span />
                </div>
                <span>Building prompt...</span>
            </div>
        );
    }
    if (!prompt) return null;

    const normalizedParsed = (parsedResult && typeof parsedResult === 'object')
        ? parsedResult
        : { action: parsedResult };

    const hasKnownKeys = normalizedParsed && knownKeys.some((k) =>
        Object.prototype.hasOwnProperty.call(normalizedParsed, k)
    );
    const hasBlockers = normalizedParsed && Object.prototype.hasOwnProperty.call(normalizedParsed, 'blockers');
    const hasMissing = normalizedParsed && Object.prototype.hasOwnProperty.call(normalizedParsed, 'missing');
    const hasInconsistencies = normalizedParsed && Object.prototype.hasOwnProperty.call(normalizedParsed, 'inconsistencies');

    return (
        <div className="advisor-panel">
            <div className="advisor-header">
                <div className="tabs">
                    <button
                        className={`tab-btn ${viewMode === 'prompt' ? 'active' : ''}`}
                        onClick={() => setViewMode('prompt')}
                    >
                        Prompt Builder
                    </button>
                    <button
                        className={`tab-btn ${viewMode === 'response' ? 'active' : ''}`}
                        onClick={() => setViewMode('response')}
                    >
                        Response Parser
                    </button>
                </div>
            </div>

            <div className="advisor-content">
                {viewMode === 'prompt' && (
                    <div className="prompt-view">
                        <div className="prompt-actions">
                            <div className="prompt-left">
                                <div className="control-strip">
                                    <div className="model-row">
                                        <span className="model-label">Model</span>
                                        <div className="model-select-wrap">
                                            <select
                                                className="model-select"
                                                value={selectedModel}
                                                onChange={e => setSelectedModel(e.target.value)}
                                                disabled={modelsLoading || (forceGroq && !displayedModels.length)}
                                            >
                                                {displayedModels.map(m => (
                                                    <option key={m.name} value={m.name}>
                                                        {m.name}{m.provider ? ` [${m.provider}]` : ''}{m.strength ? ` (S${m.strength})` : ''}
                                                    </option>
                                                ))}
                                                {forceGroq && !displayedModels.length && <option>No Groq models</option>}
                                                {!forceGroq && !displayedModels.length && <option>Loading...</option>}
                                            </select>
                                            {(statusLoading || modelsLoading) && (
                                                <span className="mini-spinner" title="Loading models" />
                                            )}
                                        </div>
                                    </div>
                                    <label className={`route-toggle ${forceGroq ? 'on' : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={forceGroq}
                                            onChange={e => setForceGroq(e.target.checked)}
                                        />
                                        <span className="route-label">Route</span>
                                        <span className="route-value">
                                            {forceGroq ? 'Groq only' : 'Local first'}
                                        </span>
                                    </label>
                                </div>
                                <span className="info">Use locally or copy to external AI</span>
                                {loadingPrompt && (
                                    <span className="loading-inline">
                                        <span className="mini-spinner" />
                                        Updating prompt...
                                    </span>
                                )}
                                <div className="toggle-row">
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={includeCurrentDesc}
                                            onChange={e => setIncludeCurrentDesc(e.target.checked)}
                                        />
                                        Include current description
                                    </label>
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={includeSubtaskDesc}
                                            onChange={e => setIncludeSubtaskDesc(e.target.checked)}
                                        />
                                        Include subtask descriptions
                                    </label>
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={includeParentDesc}
                                            onChange={e => setIncludeParentDesc(e.target.checked)}
                                        />
                                        Include parent description
                                    </label>
                                </div>
                            </div>
                            <div className="btn-group">
                                <button className="btn-primary" onClick={() => handleRunAdvisor()} disabled={running}>
                                    {running ? <div className="spinner-sm" /> : <Play size={16} />}
                                    {running ? "Running..." : "Run Analysis"}
                                </button>
                                {running && (
                                    <button className="btn-secondary" onClick={abortRun}>
                                        <XCircle size={16} /> Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                        {forceGroq && !displayedModels.length && (
                            <div className="model-hint">
                                No Groq models found. Add Groq models in AI_MODELS using @groq or set GROQ_MODEL_DEFAULT.
                            </div>
                        )}
                        {modelsError && (
                            <div className="model-hint warn">
                                Model list issue: {modelsError}
                            </div>
                        )}
                        {groqAuthError && (
                            <div className="model-hint warn">
                                {groqAuthError}
                            </div>
                        )}
                        <div className="prompt-area-wrap">
                            <textarea className="prompt-area" value={prompt} readOnly />
                            <button className="copy-fab" onClick={handleCopy} title="Copy prompt">
                                {copied ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                        </div>
                    </div>
                )}

                {viewMode === 'response' && (
                    <div className="parser-view">
                        {!parsedResult ? (
                            <>
                                <p className="info">Paste the JSON response from the AI here:</p>
                                <textarea
                                    className="input-area"
                                    placeholder='{"action": "Start subtask X", "blockers": [], ...}'
                                    value={typeof responseInput === 'string' ? responseInput : JSON.stringify(responseInput, null, 2)}
                                    onChange={e => setResponseInput(e.target.value)}
                                />
                                <button className="btn-primary full-width" onClick={handleParse}>
                                    <Terminal size={16} /> Parse & Visualize
                                </button>
                            </>
                        ) : (
                            <div className="results-view">
                                <button className="btn-text" onClick={() => setParsedResult(null)}>← Parse Another</button>

                                <div className="result-card action">
                                    <h4>🚀 Immediate Action</h4>
                                    <div className="result-body">{renderValue(normalizedParsed.action)}</div>
                                </div>

                                {hasBlockers && (
                                    <div className="result-card blocker">
                                        <h4>⛔ Blockers</h4>
                                        <div className="result-body">{renderValue(normalizedParsed.blockers)}</div>
                                    </div>
                                )}

                                {hasMissing && (
                                    <div className="result-card warn">
                                        <h4>⚠️ Missing Info</h4>
                                        <div className="result-body">{renderValue(normalizedParsed.missing)}</div>
                                    </div>
                                )}

                                {hasInconsistencies && (
                                    <div className="result-card warn">
                                        <h4>❓ Inconsistencies</h4>
                                        <div className="result-body">{renderValue(normalizedParsed.inconsistencies)}</div>
                                    </div>
                                )}

                                {parsedResult && !hasKnownKeys && (
                                    <div className="result-card warn">
                                        <h4>Raw JSON</h4>
                                        <div className="result-body">{renderValue(normalizedParsed)}</div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <style>{`
                .advisor-panel {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: var(--bg-primary);
                    animation: fadeUp 0.3s ease;
                }
                .advisor-loading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    padding: 20px;
                    color: var(--text-secondary);
                    font-weight: 500;
                }
                .advisor-header {
                    padding: 10px;
                    border-bottom: 1px solid var(--border);
                    background: var(--bg-secondary);
                }
                .tabs {
                    display: flex;
                    gap: 10px;
                }
                .tab-btn {
                    background: none;
                    border: none;
                    padding: 8px 14px;
                    cursor: pointer;
                    color: var(--text-secondary);
                    border-bottom: 2px solid transparent;
                }
                .tab-btn.active {
                    color: var(--accent);
                    border-bottom-color: var(--accent);
                }
                .advisor-content {
                    flex: 1;
                    padding: 15px;
                    overflow-y: auto;
                }
                .prompt-view, .parser-view {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                    height: 100%;
                }
                .prompt-actions {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .info {
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                }
                .btn-group {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }
                .btn-secondary {
                    background: var(--bg-elevated);
                    color: var(--text-primary);
                    border: 1px solid var(--border);
                    padding: 8px 16px;
                    border-radius: 999px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 500;
                }
                .btn-secondary:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                }
                .spinner-sm {
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--accent-soft);
                    border-top-color: var(--accent);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                .typing-dots {
                    display: inline-flex;
                    gap: 4px;
                }
                .typing-dots span {
                    width: 8px;
                    height: 8px;
                    background: var(--accent);
                    border-radius: 999px;
                    opacity: 0.4;
                    animation: dotPulse 1s ease-in-out infinite;
                }
                .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
                .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
                .prompt-left {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .control-strip {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .loading-inline {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 0.8rem;
                    color: var(--text-secondary);
                }
                .model-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                }
                .model-select-wrap {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                }
                .model-label {
                    font-weight: 600;
                    letter-spacing: 0.02em;
                    text-transform: uppercase;
                    font-size: 0.7rem;
                }
                .model-select {
                    min-width: 180px;
                    padding: 6px 8px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg-primary);
                    color: var(--text-primary);
                }
                .mini-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--accent-soft);
                    border-top-color: var(--accent);
                    border-radius: 50%;
                    animation: spin 0.9s linear infinite;
                }
                .model-hint {
                    font-size: 0.78rem;
                    color: var(--text-secondary);
                    padding: 6px 12px;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                }
                .model-hint.warn {
                    color: #ef4444;
                    background: #fff1f2;
                    border-color: #fecdd3;
                }
                .route-toggle {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 12px;
                    border-radius: 999px;
                    border: 1px solid var(--border);
                    background: var(--bg-secondary);
                    color: var(--text-secondary);
                    cursor: pointer;
                    font-size: 0.78rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }
                .route-toggle input {
                    position: absolute;
                    opacity: 0;
                    pointer-events: none;
                }
                .route-toggle .route-label {
                    opacity: 0.7;
                }
                .route-toggle .route-value {
                    padding: 2px 8px;
                    border-radius: 999px;
                    background: var(--bg-primary);
                    border: 1px solid var(--border);
                    font-size: 0.68rem;
                    letter-spacing: 0.06em;
                }
                .route-toggle.on {
                    border-color: var(--accent);
                    color: var(--accent);
                    background: var(--accent-soft);
                }
                .toggle-row {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    font-size: 0.8rem;
                    color: var(--text-secondary);
                }
                .toggle {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 10px;
                    border-radius: 999px;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                }
                .toggle input {
                    accent-color: var(--accent);
                }
                .prompt-area, .input-area {
                    flex: 1;
                    background: var(--bg-elevated);
                    color: var(--text-primary);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 10px;
                    font-family: monospace;
                    font-size: 0.9rem;
                    resize: none;
                }
                .prompt-area-wrap {
                    position: relative;
                    flex: 1;
                    display: flex;
                }
                .copy-fab {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    border: 1px solid var(--border);
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    padding: 6px;
                    border-radius: 999px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: var(--shadow-sm);
                }
                .copy-fab:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                }
                .btn-primary {
                    background: var(--accent);
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 999px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 500;
                    box-shadow: var(--shadow-sm);
                }
                .full-width { width: 100%; justify-content: center; }
                .result-card {
                    background: var(--bg-elevated);
                    border-radius: 12px;
                    padding: 15px;
                    margin-bottom: 15px;
                    border-left: 4px solid var(--border);
                    box-shadow: var(--shadow-sm);
                }
                .result-card h4 { margin: 0 0 8px 0; opacity: 0.8; }
                .result-card.action { border-left-color: #10b981; }
                .result-card.blocker { border-left-color: #ef4444; }
                .result-card.warn { border-left-color: #f59e0b; }
                .result-body { font-size: 0.95rem; line-height: 1.5; }
                .json-block {
                    margin: 0;
                    padding: 8px;
                    background: var(--bg-primary);
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    font-family: monospace;
                    font-size: 0.85rem;
                    white-space: pre-wrap;
                }
                .btn-text { background: none; border: none; color: var(--text-secondary); cursor: pointer; margin-bottom: 10px; }
                @keyframes dotPulse {
                    0%, 100% { transform: translateY(0); opacity: 0.35; }
                    50% { transform: translateY(-4px); opacity: 0.9; }
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
             `}</style>
        </div>
    );
}
