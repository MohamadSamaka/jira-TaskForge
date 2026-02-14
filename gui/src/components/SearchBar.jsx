import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { issues as issuesApi } from '../api';

export function SearchBar({ onResults }) {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim()) {
            // Clear search, reload all
            onResults(null, null);
            return;
        }

        setLoading(true);
        try {
            // Use cache by default for responsiveness
            const res = await issuesApi.search(query, true);
            onResults(res.data.issues, `Search: ${query}`);
        } catch (err) {
            console.error("Search failed", err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form className="search-bar" onSubmit={handleSearch}>
            <Search size={16} className="search-icon" />
            <input
                type="text"
                placeholder="Search key, summary, or JQL (status=done)..."
                value={query}
                onChange={e => setQuery(e.target.value)}
            />

            <style>{`
        .search-bar {
          display: flex;
          align-items: center;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 6px 14px;
          margin: 12px 12px 6px 12px;
          box-shadow: var(--shadow-sm);
          transition: all 0.2s ease;
        }
        .search-bar:focus-within {
          border-color: var(--accent);
          background: var(--bg-primary);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .search-icon {
          color: var(--text-secondary);
        }
        .search-bar input {
          flex: 1;
          border: none;
          background: none;
          padding: 6px 10px;
          color: var(--text-primary);
          font-size: 0.9rem;
          min-width: 0;
        }
        .search-bar input:focus {
          outline: none;
        }
      `}</style>
        </form>
    );
}
