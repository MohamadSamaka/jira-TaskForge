import React from 'react';
import { Star, AlertTriangle, Layers, Calendar } from 'lucide-react';

export function SavedQueries({ onSelectQuery }) {
    const PRESETS = [
        { id: 'blocked', label: 'Blocked Issues', icon: <AlertTriangle size={14} />, color: '#ef4444' },
        { id: 'next', label: 'What to do next?', icon: <Star size={14} />, color: '#f59e0b' },
        { id: 'today', label: 'Due / Updated Today', icon: <Calendar size={14} />, color: '#3b82f6' },
        { id: 'project', label: 'By Project', icon: <Layers size={14} />, color: '#8b5cf6' },
    ];

    const handleClick = (preset) => {
        onSelectQuery?.(preset.id, preset.label);
    };

    return (
        <div className="saved-queries">
            <span className="section-label">Quick Filters</span>
            <div className="chips">
                {PRESETS.map(p => (
                    <button
                        key={p.id}
                        className="query-chip"
                        onClick={() => handleClick(p)}
                        style={{ '--chip-color': p.color }}
                    >
                        {p.icon} {p.label}
                    </button>
                ))}
            </div>
            <style>{`
        .saved-queries {
          padding: 8px 12px 12px 12px;
          border-bottom: 1px solid var(--border);
        }
        .section-label {
          display: block;
          font-size: 0.7rem;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin-bottom: 8px;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .query-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--bg-elevated);
          font-size: 0.82rem;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: var(--shadow-sm);
        }
        .query-chip:hover {
          border-color: var(--chip-color);
          color: var(--chip-color);
          background: var(--accent-soft);
          transform: translateY(-1px);
        }
      `}</style>
        </div>
    );
}
