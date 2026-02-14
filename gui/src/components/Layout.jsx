import React from 'react';
import { Layout as LayoutIcon, Settings, Moon, Sun, RefreshCw } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function Layout({ children, onSync, isSyncing, onOpenSettings }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="app-container animate__animated animate__fadeIn" data-theme={isDark ? 'dark' : 'light'}>
      <header className="header">
        <div className="logo">
          <LayoutIcon className="icon" />
          <span>TaskForge</span>
        </div>

        <div className="actions">
          <button
            className={`btn-icon ${isSyncing ? 'spin' : ''}`}
            onClick={onSync}
            title="Sync with Jira"
            disabled={isSyncing}
          >
            <RefreshCw className="icon" />
          </button>

          <button className="btn-icon" onClick={onOpenSettings} title="Settings & Doctor">
            <Settings className="icon" />
          </button>

          <button className="btn-icon" onClick={toggleTheme} title="Toggle Theme">
            {isDark ? <Sun className="icon" /> : <Moon className="icon" />}
          </button>
        </div>
      </header>

      <div className="main-content">
        {children}
      </div>

      <style>{`
        .header {
          height: 64px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          background: var(--bg-elevated);
          box-shadow: var(--shadow-sm);
          position: sticky;
          top: 0;
          z-index: 30;
          animation: fadeUp 0.5s ease;
        }
        
        .logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 700;
          font-size: 1.2rem;
          letter-spacing: 0.02em;
        }
        
        .actions {
          display: flex;
          gap: 10px;
        }
        
        .btn-icon {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          cursor: pointer;
          padding: 8px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        
        .btn-icon:hover {
          background: var(--accent-soft);
          border-color: var(--accent);
          color: var(--accent);
          transform: translateY(-1px);
        }
        
        .btn-icon:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .spin {
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .main-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        
        .icon {
          width: 20px;
          height: 20px;
        }
        @media (max-width: 640px) {
          .header {
            padding: 8px 12px;
            height: auto;
          }
          .logo {
            font-size: 1rem;
          }
          .actions {
            gap: 6px;
          }
        }
      `}</style>
    </div>
  );
}
