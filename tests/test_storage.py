"""Tests for storage layer — JSON snapshots and SQLite."""

import json
import tempfile
from pathlib import Path

import pytest

from taskforge.config import Settings
from taskforge.storage import save_snapshot, load_latest_issues, load_latest_tree, SQLiteStore


def _make_settings(tmp_path: Path) -> Settings:
    """Create settings pointing to temp dirs."""
    return Settings(
        output_dir=str(tmp_path / "out"),
        data_dir=str(tmp_path / "data"),
    )


def _make_issues() -> list[dict]:
    return [
        {
            "key": "TEST-1",
            "id": "1",
            "projectKey": "TEST",
            "type": "Task",
            "summary": "Test issue 1",
            "status": "Open",
            "statusCategory": "To Do",
            "priority": "Medium",
            "assignee": "user",
            "created": "2025-01-01T00:00:00.000+0000",
            "updated": "2025-01-02T00:00:00.000+0000",
            "dueDate": None,
            "description_plain": None,
            "description_raw": None,
            "parent": None,
            "subtasks": [],
            "links": [],
            "labels": [],
            "components": [],
        }
    ]


class TestJsonSnapshots:
    def test_save_and_load_issues(self, tmp_path):
        settings = _make_settings(tmp_path)
        issues = _make_issues()
        tree = [{"key": "TEST-1", "children": []}]

        snap_path = save_snapshot(issues, tree, settings)

        # Snapshot file exists
        assert snap_path.exists()
        assert snap_path.suffix == ".json"

        # Latest files exist
        loaded = load_latest_issues(settings)
        assert len(loaded) == 1
        assert loaded[0]["key"] == "TEST-1"

    def test_save_and_load_tree(self, tmp_path):
        settings = _make_settings(tmp_path)
        issues = _make_issues()
        tree = [{"key": "TEST-1", "children": []}]

        save_snapshot(issues, tree, settings)

        loaded_tree = load_latest_tree(settings)
        assert len(loaded_tree) == 1
        assert loaded_tree[0]["key"] == "TEST-1"

    def test_load_empty_returns_empty(self, tmp_path):
        settings = _make_settings(tmp_path)
        assert load_latest_issues(settings) == []
        assert load_latest_tree(settings) == []

    def test_snapshot_creates_directories(self, tmp_path):
        settings = _make_settings(tmp_path)
        issues = _make_issues()
        tree = []

        save_snapshot(issues, tree, settings)

        assert (tmp_path / "out" / "tasks.json").exists()
        assert (tmp_path / "data" / "snapshots").is_dir()


class TestSQLiteStore:
    def test_record_and_query(self, tmp_path):
        settings = _make_settings(tmp_path)
        issues = _make_issues()

        with SQLiteStore(settings) as store:
            snap_id = store.record_sync(issues, Path("test_snap.json"))
            assert snap_id > 0

            # Query snapshots
            snaps = store.get_snapshots()
            assert len(snaps) == 1

            # Query issue history
            history = store.get_issue_history("TEST-1")
            assert len(history) == 1
            assert history[0]["status"] == "Open"

    def test_multiple_syncs(self, tmp_path):
        settings = _make_settings(tmp_path)
        issues = _make_issues()

        with SQLiteStore(settings) as store:
            store.record_sync(issues, Path("snap1.json"))

            # Update status
            issues[0]["status"] = "In Progress"
            store.record_sync(issues, Path("snap2.json"))

            snaps = store.get_snapshots()
            assert len(snaps) == 2

            history = store.get_issue_history("TEST-1")
            assert len(history) == 2
            assert history[0]["status"] == "Open"
            assert history[1]["status"] == "In Progress"

    def test_db_file_created(self, tmp_path):
        settings = _make_settings(tmp_path)
        with SQLiteStore(settings) as store:
            _ = store.conn  # trigger creation
        assert settings.sqlite_path.exists()
