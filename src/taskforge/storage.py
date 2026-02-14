"""Storage layer — JSON snapshots + optional SQLite history tracking."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from taskforge.config import Settings, get_settings

logger = logging.getLogger(__name__)

# ── JSON snapshot helpers ──────────────────────────────────────────────


def save_snapshot(
    issues: list[dict[str, Any]],
    tree: list[dict[str, Any]],
    settings: Settings | None = None,
) -> Path:
    """Write snapshot files and return the snapshot path.

    Creates:
    - data/snapshots/YYYY-MM-DD_HHMM_tasks.json  (timestamped archive)
    - out/tasks.json                               (flat latest)
    - out/tasks_tree.json                          (hierarchy latest)
    """
    s = settings or get_settings()
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%d_%H%M")

    # Snapshot archive
    snap_path = s.snapshots_path / f"{stamp}_tasks.json"
    snap_path.write_text(json.dumps(issues, indent=2, default=str), encoding="utf-8")
    logger.info("Snapshot saved: %s", snap_path)

    # Latest flat
    tasks_path = s.output_path / "tasks.json"
    tasks_path.write_text(json.dumps(issues, indent=2, default=str), encoding="utf-8")

    # Latest tree
    tree_path = s.output_path / "tasks_tree.json"
    tree_path.write_text(json.dumps(tree, indent=2, default=str), encoding="utf-8")

    logger.info("Latest outputs: %s, %s", tasks_path, tree_path)
    return snap_path


def load_latest_issues(settings: Settings | None = None) -> list[dict[str, Any]]:
    """Load the latest tasks.json from the output directory."""
    s = settings or get_settings()
    tasks_path = s.output_path / "tasks.json"
    if not tasks_path.exists():
        return []
    return json.loads(tasks_path.read_text(encoding="utf-8"))


def load_latest_tree(settings: Settings | None = None) -> list[dict[str, Any]]:
    """Load the latest tasks_tree.json from the output directory."""
    s = settings or get_settings()
    tree_path = s.output_path / "tasks_tree.json"
    if not tree_path.exists():
        return []
    return json.loads(tree_path.read_text(encoding="utf-8"))


# ── SQLite history (OPTIONAL — activated via --use-db) ────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    path        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
    key         TEXT    PRIMARY KEY,
    raw_json    TEXT    NOT NULL,
    first_seen  TEXT    NOT NULL,
    last_seen   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    issue_key   TEXT    NOT NULL,
    status      TEXT,
    priority    TEXT,
    assignee    TEXT,
    summary     TEXT
);

CREATE INDEX IF NOT EXISTS idx_issue_snapshots_key ON issue_snapshots(issue_key);
CREATE INDEX IF NOT EXISTS idx_issue_snapshots_snap ON issue_snapshots(snapshot_id);
"""


class SQLiteStore:
    """Manages the SQLite history database (optional component)."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._conn: sqlite3.Connection | None = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            db_path = self.settings.sqlite_path
            db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(db_path))
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(SCHEMA_SQL)
        return self._conn

    def record_sync(
        self,
        issues: list[dict[str, Any]],
        snapshot_path: Path,
    ) -> int:
        """Record a sync event: create snapshot row and upsert issues."""
        now = datetime.now(timezone.utc).isoformat()
        cur = self.conn.cursor()

        # Insert snapshot
        cur.execute(
            "INSERT INTO snapshots (timestamp, path) VALUES (?, ?)",
            (now, str(snapshot_path)),
        )
        snapshot_id = cur.lastrowid
        if snapshot_id is None:
            raise RuntimeError("Failed to create snapshot record in SQLite")

        for issue in issues:
            key = issue.get("key", "")
            raw = json.dumps(issue, default=str)

            # Upsert issue
            cur.execute(
                """INSERT INTO issues (key, raw_json, first_seen, last_seen)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET
                       raw_json = excluded.raw_json,
                       last_seen = excluded.last_seen
                """,
                (key, raw, now, now),
            )

            # Insert issue snapshot
            cur.execute(
                """INSERT INTO issue_snapshots
                   (snapshot_id, issue_key, status, priority, assignee, summary)
                   VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot_id,
                    key,
                    issue.get("status"),
                    issue.get("priority"),
                    issue.get("assignee"),
                    issue.get("summary"),
                ),
            )

        self.conn.commit()
        logger.info("Recorded sync in SQLite: snapshot_id=%d, issues=%d", snapshot_id, len(issues))
        return snapshot_id

    def get_snapshots(self, limit: int = 20) -> list[dict[str, Any]]:
        """Return recent snapshots."""
        cur = self.conn.execute(
            "SELECT id, timestamp, path FROM snapshots ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [{"id": r[0], "timestamp": r[1], "path": r[2]} for r in cur.fetchall()]

    def get_issue_history(self, key: str) -> list[dict[str, Any]]:
        """Return status history for a given issue key."""
        cur = self.conn.execute(
            """SELECT s.timestamp, isnap.status, isnap.priority, isnap.assignee, isnap.summary
               FROM issue_snapshots isnap
               JOIN snapshots s ON s.id = isnap.snapshot_id
               WHERE isnap.issue_key = ?
               ORDER BY s.timestamp
            """,
            (key,),
        )
        return [
            {
                "timestamp": r[0],
                "status": r[1],
                "priority": r[2],
                "assignee": r[3],
                "summary": r[4],
            }
            for r in cur.fetchall()
        ]

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
