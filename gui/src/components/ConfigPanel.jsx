import React, { useState, useEffect } from 'react';
import { system } from '../api';
import { ShieldCheck, Database, Server, Activity } from 'lucide-react';

export function ConfigPanel({ onClose }) {
    const [activeTab, setActiveTab] = useState('config'); // config, doctor
    const [config, setConfig] = useState(null);
    const [doctor, setDoctor] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [confRes, docRes] = await Promise.all([
                system.getConfig(),
                system.getDoctor()
            ]);
            setConfig(confRes.data);
            setDoctor(docRes.data);
        } catch (err) {
            console.error("Failed to load config/doctor", err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="config-overlay">
            <div className="config-modal">
                <div className="modal-header">
                    <h2>Settings & Diagnostics</h2>
                    <button className="close-btn" onClick={onClose}>Close</button>
                </div>

                <div className="tabs">
                    <button
                        className={`tab ${activeTab === 'config' ? 'active' : ''}`}
                        onClick={() => setActiveTab('config')}
                    >
                        <Server size={16} /> Configuration
                    </button>
                    <button
                        className={`tab ${activeTab === 'doctor' ? 'active' : ''}`}
                        onClick={() => setActiveTab('doctor')}
                    >
                        <Activity size={16} /> System Doctor
                    </button>
                </div>

                <div className="modal-content">
                    {loading ? (
                        <div className="loading">Loading system info...</div>
                    ) : (
                        <>
                            {activeTab === 'config' && config && (
                                <div className="config-view">
                                    {config.errors && config.errors.length > 0 && (
                                        <div className="error-banner">
                                            <h4>Configuration Issues:</h4>
                                            <ul>{config.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                                        </div>
                                    )}
                                    <table className="config-table">
                                        <tbody>
                                            {Object.entries(config.config).map(([key, val]) => (
                                                <tr key={key}>
                                                    <td className="key">{key}</td>
                                                    <td className="val">{String(val)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {activeTab === 'doctor' && doctor && (
                                <div className="doctor-view">
                                    <Section title="System" icon={<Server size={16} />}>
                                        <Field label="Platform" value={doctor.platform} />
                                    </Section>

                                    <Section title="Jira Connection" icon={<ShieldCheck size={16} />}>
                                        <Field label="Base URL" value={doctor.jira.base_url} />
                                        <Field label="Auth Mode" value={doctor.jira.auth_mode} />
                                        <Field label="Status" value={doctor.jira.valid ? '✅ Valid' : '❌ Invalid'} />
                                    </Section>

                                    <Section title="Data Integrity" icon={<Database size={16} />}>
                                        <Field label="Total Issues" value={doctor.data_integrity.total_issues} />
                                        <Field label="Unique Keys" value={doctor.data_integrity.unique_keys} />
                                        {doctor.data_integrity.duplicates?.length > 0 && (
                                            <div className="warning">⚠️ Duplicates: {doctor.data_integrity.duplicates.join(', ')}</div>
                                        )}
                                        {doctor.data_integrity.orphan_parents?.length > 0 && (
                                            <div className="warning">⚠️ Orphan Parents: {doctor.data_integrity.orphan_parents.join(', ')}</div>
                                        )}
                                    </Section>

                                    <Section title="AI Status" icon={<Activity size={16} />}>
                                        <pre className="json-dump">{JSON.stringify(doctor.ai, null, 2)}</pre>
                                    </Section>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <style>{`
        .config-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .config-modal {
          background: var(--bg-elevated);
          width: 800px;
          height: 80vh;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
        }
        .modal-header {
          padding: 15px 20px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-header h2 { margin: 0; font-size: 1.2rem; }
        .close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--text-secondary);
        }
        .tabs {
          display: flex;
          padding: 0 20px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-secondary);
        }
        .tab {
          padding: 12px 16px;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
        }
        .tab.active {
          border-bottom-color: var(--accent);
          color: var(--accent);
          background: var(--bg-primary);
        }
        .modal-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .config-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .config-table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
        }
        .config-table .key {
          font-weight: 600;
          color: var(--text-secondary);
          width: 250px;
        }
        .config-table .val {
          font-family: monospace;
          color: var(--text-primary);
        }
        .section {
          margin-bottom: 25px;
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }
        .section-header {
          background: var(--bg-secondary);
          padding: 8px 15px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.95rem;
        }
        .section-body {
          padding: 15px;
        }
        .field {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 0.9rem;
        }
        .label { color: var(--text-secondary); }
        .value { font-weight: 500; }
        .warning {
          margin-top: 8px;
          color: #ef4444;
          font-size: 0.85rem;
          background: #fee2e2;
          padding: 8px;
          border-radius: 4px;
        }
        .error-banner {
          background: #fee2e2;
          border: 1px solid #fecaca;
          color: #991b1b;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .json-dump {
          background: var(--bg-secondary);
          padding: 10px;
          border-radius: 6px;
          font-size: 0.8rem;
          overflow-x: auto;
        }
        .loading {
          text-align: center;
          padding: 40px;
          color: var(--text-secondary);
        }
      `}</style>
        </div>
    );
}

function Section({ title, icon, children }) {
    return (
        <div className="section">
            <div className="section-header">{icon} {title}</div>
            <div className="section-body">{children}</div>
        </div>
    );
}

function Field({ label, value }) {
    return (
        <div className="field">
            <span className="label">{label}</span>
            <span className="value">{value}</span>
        </div>
    );
}
