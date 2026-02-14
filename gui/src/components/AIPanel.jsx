import React, { useState, useEffect, useRef } from 'react';
import { ai } from '../api';
import { Bot, Send, Sparkles, Cpu, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export function AIPanel({ onSelectIssue }) {
    const [input, setInput] = useState('');
    const [conversation, setConversation] = useState([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [forceGroq, setForceGroq] = useState(false);
    const [statusLoading, setStatusLoading] = useState(true);
    const [modelsLoading, setModelsLoading] = useState(true);
    const [modelsError, setModelsError] = useState(null);
    const activeRequestRef = useRef(null);
    const requestIdRef = useRef(0);
    const [groqAuthError, setGroqAuthError] = useState(null);

    useEffect(() => {
        loadStatus();
        loadModels();
    }, []);

    const loadStatus = async () => {
        setStatusLoading(true);
        try {
            const res = await ai.status();
            setStatus(res.data);
            if (res.data.model) setSelectedModel(res.data.model);
        } catch (err) {
            console.error("Failed to load AI status", err);
        } finally {
            setStatusLoading(false);
        }
    };

    const loadModels = async () => {
        setModelsLoading(true);
        setModelsError(null);
        try {
            const res = await ai.models();
            setModels(res.data.models || []);
            if (res.data.errors) {
                setModelsError(res.data.errors.join(" | "));
            }
            if (!selectedModel && res.data.models && res.data.models.length) {
                setSelectedModel(res.data.models[0].name);
            }
        } catch (err) {
            console.error("Failed to load models", err);
            setModelsError(err.message);
        } finally {
            setModelsLoading(false);
        }
    };

    const abortActiveRequest = () => {
        if (activeRequestRef.current) {
            activeRequestRef.current.abort();
            activeRequestRef.current = null;
        }
    };

    const handleSend = async () => {
        if (!input.trim()) return;

        abortActiveRequest();
        const userMsg = { role: 'user', text: input };
        setConversation(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        const controller = new AbortController();
        activeRequestRef.current = controller;
        const requestId = ++requestIdRef.current;

        try {
            const { model, skipLocal } = resolveModelForRequest();
            const res = await ai.ask(input, model, skipLocal, { signal: controller.signal });
            const aiMsg = { role: 'ai', text: res.data.response };
            setConversation(prev => [...prev, aiMsg]);
            setGroqAuthError(null);
        } catch (err) {
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                setConversation(prev => [...prev, { role: 'error', text: "Request canceled." }]);
            } else {
                if (err.response?.status === 401 && String(err.response?.data?.detail || '').toLowerCase().includes('groq')) {
                    setGroqAuthError(err.response.data.detail);
                }
                const errMsg = { role: 'error', text: "Error: " + (err.response?.data?.detail || err.message) };
                setConversation(prev => [...prev, errMsg]);
            }
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
                activeRequestRef.current = null;
            }
        }
    };

    const handleQuickAction = async (action) => {
        setLoading(true);
        let promise;
        let label;

        abortActiveRequest();
        const controller = new AbortController();
        activeRequestRef.current = controller;
        const requestId = ++requestIdRef.current;
        const { model, skipLocal } = resolveModelForRequest();

        if (action === 'today') {
            promise = ai.today(model, skipLocal, { signal: controller.signal });
            label = "Summarize Today";
        } else if (action === 'next') {
            promise = ai.next(model, skipLocal, { signal: controller.signal });
            label = "What Next?";
        }

        setConversation(prev => [...prev, { role: 'user', text: `[Action: ${label}]` }]);

        try {
            const res = await promise;
            setConversation(prev => [...prev, { role: 'ai', text: res.data.response }]);
            setGroqAuthError(null);
        } catch (err) {
            if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
                setConversation(prev => [...prev, { role: 'error', text: "Action canceled." }]);
            } else {
                if (err.response?.status === 401 && String(err.response?.data?.detail || '').toLowerCase().includes('groq')) {
                    setGroqAuthError(err.response.data.detail);
                }
                setConversation(prev => [...prev, { role: 'error', text: "Action failed: " + err.message }]);
            }
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
                activeRequestRef.current = null;
            }
        }
    };

    const handleModelChange = async (e) => {
        const newModel = e.target.value;
        setSelectedModel(newModel);
        const meta = modelOptions.find(m => m.name === newModel);
        if (meta?.provider === 'groq') {
            return;
        }
        try {
            await ai.setModel(newModel);
            loadStatus(); // refresh status
        } catch (err) {
            alert("Failed to set model: " + err.message);
        }
    };

    // Helper to detect issue keys in text and make them clickable
    const renderText = (text) => {
        const safeText = (text === null || text === undefined)
            ? ''
            : (typeof text === 'string' ? text : JSON.stringify(text, null, 2));
        // Regex for Jira keys (Simple: 2+ UPCASE chars, hyphen, digits)
        const parts = safeText.split(/([A-Z]{2,}-\d+)/g);
        return parts.map((part, i) => {
            if (part.match(/^[A-Z]{2,}-\d+$/)) {
                return (
                    <span
                        key={i}
                        className="issue-ref"
                        onClick={() => onSelectIssue && onSelectIssue(part)}
                    >
                        {part}
                    </span>
                );
            }
            return part;
        });
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

    useEffect(() => () => abortActiveRequest(), []);

    const displayedModels = modelOptions;

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

    const routeLabel = (() => {
        const selectedMeta = modelOptions.find(m => m.name === selectedModel);
        const skipLocal = forceGroq || selectedMeta?.provider === 'groq';
        return skipLocal ? 'Groq' : 'Local';
    })();

    return (
        <div className="ai-panel">
            <div className="ai-header">
                <div className="status-indicator">
                    {status?.available ? <CheckCircle size={16} color="#10b981" /> : <AlertTriangle size={16} color="#ef4444" />}
                    <span>{status?.provider || 'AI'}</span>
                </div>
                <span className="route-pill">{routeLabel}</span>
                <label className="skip-toggle">
                    <input
                        type="checkbox"
                        checked={forceGroq}
                        onChange={e => setForceGroq(e.target.checked)}
                    />
                    Skip local (Groq)
                </label>
                {(statusLoading || modelsLoading) && <span className="mini-spinner" title="Loading models" />}
                <select
                    value={selectedModel}
                    onChange={handleModelChange}
                    className="model-select"
                    disabled={loading || modelsLoading}
                >
                    {displayedModels.map(m => (
                        <option key={m.name} value={m.name}>
                            {m.name}
                            {m.provider ? ` [${m.provider}]` : ''}
                            {m.strength ? ` (S${m.strength})` : ''}
                            {m.size ? ` • ${formatSize(m.size)}` : ''}
                        </option>
                    ))}
                    {!displayedModels.length && <option>Loading...</option>}
                </select>
            </div>
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

            <div className="conversation-area">
                {conversation.length === 0 && (
                    <div className="welcome-msg">
                        <Bot size={40} className="bot-icon" />
                        <p>TaskForge AI is ready to help.</p>
                        <div className="quick-actions">
                            <button onClick={() => handleQuickAction('today')} disabled={!status?.available || loading}>
                                <Sparkles size={14} /> Summarize Today
                            </button>
                            <button onClick={() => handleQuickAction('next')} disabled={!status?.available || loading}>
                                <Cpu size={14} /> What Next?
                            </button>
                        </div>
                    </div>
                )}

                {conversation.map((msg, i) => {
                    const displayText = (typeof msg.text === 'string')
                        ? msg.text
                        : JSON.stringify(msg.text, null, 2);
                    return (
                        <div key={i} className={`msg ${msg.role}`}>
                            <div className="msg-content">
                                {msg.role === 'ai' || msg.role === 'error' ? renderText(displayText) : displayText}
                            </div>
                        </div>
                    );
                })}
                {loading && (
                    <div className="msg ai loading-msg">
                        <div className="msg-content">
                            <span className="typing-dots">
                                <span />
                                <span />
                                <span />
                            </span>
                            <span className="loading-label">Thinking</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="input-area">
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Ask a question about your tasks..."
                    disabled={loading || !status?.available}
                />
                {loading && (
                    <button className="cancel-btn" onClick={abortActiveRequest} title="Cancel request">
                        <XCircle size={16} />
                    </button>
                )}
                <button onClick={handleSend} disabled={loading || !input.trim() || !status?.available}>
                    <Send size={16} />
                </button>
            </div>

            <style>{`
        .ai-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary);
          animation: fadeUp 0.3s ease;
        }
        .ai-header {
          padding: 10px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--bg-secondary);
        }
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.85rem;
          font-weight: 500;
        }
        .model-select {
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          font-size: 0.8rem;
          max-width: 200px;
          background: var(--bg-elevated);
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
          border-bottom: 1px solid var(--border);
        }
        .model-hint.warn {
          color: #ef4444;
          background: #fff1f2;
          border-color: #fecdd3;
        }
        .route-pill {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid var(--border);
          color: var(--text-secondary);
        }
        .skip-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          padding: 4px 10px;
          border-radius: 999px;
        }
        .skip-toggle input {
          accent-color: var(--accent);
        }
        .conversation-area {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .welcome-msg {
          text-align: center;
          margin-top: 40px;
          color: var(--text-secondary);
        }
        .bot-icon {
          color: var(--accent);
          margin-bottom: 10px;
          animation: float 3s ease-in-out infinite;
        }
        .quick-actions {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-top: 20px;
        }
        .quick-actions button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border: 1px solid var(--border);
          background: var(--bg-elevated);
          border-radius: 999px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
          box-shadow: var(--shadow-sm);
        }
        .quick-actions button:hover {
          border-color: var(--accent);
          color: var(--accent);
          transform: translateY(-1px);
        }
        .quick-actions button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .msg {
          display: flex;
          flex-direction: column;
          max-width: 85%;
        }
        .msg.user {
          align-self: flex-end;
          align-items: flex-end;
        }
        .msg.ai {
          align-self: flex-start;
          align-items: flex-start;
        }
        .msg-content {
          padding: 10px 14px;
          border-radius: 14px;
          font-size: 0.95rem;
          line-height: 1.5;
          white-space: pre-wrap;
          box-shadow: var(--shadow-sm);
        }
        .msg.user .msg-content {
          background: var(--accent);
          color: white;
          border-bottom-right-radius: 2px;
        }
        .msg.ai .msg-content {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border-bottom-left-radius: 2px;
        }
        .msg.error .msg-content {
          background: #fee2e2;
          color: #ef4444;
          border: 1px solid #fecaca;
        }
        .loading-msg {
          color: var(--text-secondary);
          font-size: 0.85rem;
        }
        .typing-dots {
          display: inline-flex;
          gap: 4px;
          margin-right: 8px;
        }
        .typing-dots span {
          width: 6px;
          height: 6px;
          background: var(--accent);
          border-radius: 999px;
          opacity: 0.4;
          animation: dotPulse 1s ease-in-out infinite;
        }
        .typing-dots span:nth-child(2) {
          animation-delay: 0.2s;
        }
        .typing-dots span:nth-child(3) {
          animation-delay: 0.4s;
        }
        .loading-label {
          font-weight: 500;
          letter-spacing: 0.02em;
        }
        .input-area {
          padding: 15px;
          border-top: 1px solid var(--border);
          display: flex;
          gap: 10px;
          background: var(--bg-secondary);
        }
        .input-area input {
          flex: 1;
          padding: 10px 15px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--bg-elevated);
          color: var(--text-primary);
          font-size: 0.95rem;
        }
        .input-area input:focus {
          outline: none;
          border-color: var(--accent);
          background: var(--bg-primary);
        }
        .input-area button {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: var(--accent);
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--shadow-sm);
        }
        .cancel-btn {
          background: var(--bg-elevated);
          color: var(--text-secondary);
          border: 1px solid var(--border);
        }
        .cancel-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .input-area button:disabled {
          background: var(--border);
          cursor: not-allowed;
        }
        .issue-ref {
          color: var(--accent);
          cursor: pointer;
          text-decoration: underline;
          font-weight: 500;
        }
        .issue-ref:hover {
          color: var(--text-primary);
        }
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

function formatSize(bytes) {
    if (!bytes) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    return gb.toFixed(1) + ' GB';
}
