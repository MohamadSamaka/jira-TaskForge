"""Tests for queries — blocked detection, ranking, today filter."""

import pytest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

from taskforge.queries import (
    find_blocked,
    is_blocked,
    rank_next,
    group_by_project,
    filter_today,
    PRIORITY_SCORES,
)
from taskforge.config import Settings


def _make_issue(
    key="TEST-1",
    status="Open",
    status_category="To Do",
    priority="Medium",
    due_date=None,
    updated=None,
    links=None,
    project_key="TEST",
    **kwargs,
):
    return {
        "key": key,
        "id": "1",
        "projectKey": project_key,
        "type": "Task",
        "summary": f"Issue {key}",
        "status": status,
        "statusCategory": status_category,
        "priority": priority,
        "assignee": "user",
        "created": "2025-01-01T00:00:00.000+0000",
        "updated": updated or "2025-01-02T00:00:00.000+0000",
        "dueDate": due_date,
        "description_plain": None,
        "description_raw": None,
        "parent": None,
        "subtasks": [],
        "links": links or [],
        "labels": [],
        "components": [],
        **kwargs,
    }


def _make_settings(**kwargs):
    return Settings(
        blocked_link_keywords=kwargs.get("blocked_link_keywords", "is blocked by,depends on"),
        **{k: v for k, v in kwargs.items() if k != "blocked_link_keywords"},
    )


# ── Blocked detection ─────────────────────────────────────────────────


class TestBlocked:
    def test_no_blocks(self):
        issues = [_make_issue()]
        settings = _make_settings()
        result = find_blocked(issues, settings)
        assert len(result) == 0

    def test_blocked_by_link(self):
        issues = [
            _make_issue(
                key="A-1",
                links=[
                    {
                        "type": "Blocks",
                        "direction": "inward",
                        "relation": "is blocked by",
                        "linked_key": "A-2",
                        "linked_summary": "Blocker",
                        "linked_status": "Open",
                        "linked_status_category": "To Do",
                    }
                ],
            )
        ]
        settings = _make_settings()
        result = find_blocked(issues, settings)
        assert len(result) == 1
        assert result[0]["issue"]["key"] == "A-1"
        assert result[0]["blockers"][0]["key"] == "A-2"

    def test_depends_on_link(self):
        issues = [
            _make_issue(
                key="B-1",
                links=[
                    {
                        "type": "Dependency",
                        "direction": "inward",
                        "relation": "depends on",
                        "linked_key": "B-2",
                        "linked_summary": "Dep",
                        "linked_status": "Open",
                        "linked_status_category": "To Do",
                    }
                ],
            )
        ]
        settings = _make_settings()
        result = find_blocked(issues, settings)
        assert len(result) == 1

    def test_non_blocking_link_ignored(self):
        issues = [
            _make_issue(
                key="C-1",
                links=[
                    {
                        "type": "Related",
                        "direction": "outward",
                        "relation": "relates to",
                        "linked_key": "C-2",
                        "linked_summary": "Related",
                        "linked_status": "Open",
                        "linked_status_category": "To Do",
                    }
                ],
            )
        ]
        settings = _make_settings()
        result = find_blocked(issues, settings)
        assert len(result) == 0

    def test_is_blocked_helper(self):
        issue = _make_issue(
            links=[
                {
                    "type": "Blocks",
                    "relation": "is blocked by",
                    "linked_key": "X-1",
                    "linked_summary": "X",
                    "linked_status": "Open",
                    "linked_status_category": "To Do",
                    "direction": "inward",
                }
            ]
        )
        settings = _make_settings()
        assert is_blocked(issue, settings) is True

    def test_custom_keywords(self):
        issues = [
            _make_issue(
                links=[
                    {
                        "type": "Custom",
                        "relation": "waiting for",
                        "linked_key": "X-2",
                        "linked_summary": "W",
                        "linked_status": "Open",
                        "linked_status_category": "To Do",
                        "direction": "inward",
                    }
                ]
            )
        ]
        settings = _make_settings(blocked_link_keywords="waiting for")
        result = find_blocked(issues, settings)
        assert len(result) == 1


# ── Ranking ───────────────────────────────────────────────────────────


class TestRanking:
    def test_higher_priority_ranked_first(self):
        issues = [
            _make_issue(key="L-1", priority="Low"),
            _make_issue(key="H-1", priority="High"),
        ]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        assert ranked[0]["issue"]["key"] == "H-1"

    def test_done_issues_excluded(self):
        issues = [
            _make_issue(key="D-1", status_category="Done"),
            _make_issue(key="O-1", status_category="To Do"),
        ]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        keys = [r["issue"]["key"] for r in ranked]
        assert "D-1" not in keys
        assert "O-1" in keys

    def test_overdue_gets_high_score(self):
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        issues = [
            _make_issue(key="OD-1", due_date=yesterday, priority="Low"),
            _make_issue(key="ND-1", priority="High"),
        ]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        # Overdue Low-prio should still compete with non-due High-prio
        scores = {r["issue"]["key"]: r["score"] for r in ranked}
        assert scores["OD-1"] > 0

    def test_blocked_penalty_applied(self):
        issues = [
            _make_issue(
                key="BLK-1",
                priority="High",
                links=[
                    {
                        "type": "Blocks",
                        "relation": "is blocked by",
                        "linked_key": "X-1",
                        "linked_summary": "X",
                        "linked_status": "Open",
                        "linked_status_category": "To Do",
                        "direction": "inward",
                    }
                ],
            ),
            _make_issue(key="FREE-1", priority="Medium"),
        ]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        scores = {r["issue"]["key"]: r for r in ranked}
        assert scores["BLK-1"]["breakdown"]["blocked_penalty"] == -50.0

    def test_score_breakdown_present(self):
        issues = [_make_issue()]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        assert len(ranked) == 1
        bd = ranked[0]["breakdown"]
        assert "priority" in bd
        assert "due_date" in bd
        assert "recency" in bd
        assert "blocked_penalty" in bd

    def test_top_limits_results(self):
        issues = [_make_issue(key=f"T-{i}") for i in range(20)]
        settings = _make_settings()
        ranked = rank_next(issues, top=3, settings=settings)
        assert len(ranked) == 3


# ── Group by project ──────────────────────────────────────────────────


class TestGroupByProject:
    def test_groups_correctly(self):
        issues = [
            _make_issue(key="A-1", project_key="ALPHA"),
            _make_issue(key="A-2", project_key="ALPHA"),
            _make_issue(key="B-1", project_key="BETA"),
        ]
        groups = group_by_project(issues)
        assert len(groups["ALPHA"]) == 2
        assert len(groups["BETA"]) == 1

    def test_sorted_keys(self):
        issues = [
            _make_issue(key="Z-1", project_key="ZETA"),
            _make_issue(key="A-1", project_key="ALPHA"),
        ]
        groups = group_by_project(issues)
        assert list(groups.keys()) == ["ALPHA", "ZETA"]


# ── Today filter ──────────────────────────────────────────────────────


class TestToday:
    def test_updated_today(self):
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000")
        issues = [
            _make_issue(key="T-1", updated=today_str),
            _make_issue(key="T-2", updated="2020-01-01T00:00:00.000+0000"),
        ]
        result = filter_today(issues)
        assert len(result) == 1
        assert result[0]["key"] == "T-1"

    def test_due_today(self):
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        issues = [
            _make_issue(key="D-1", due_date=today_str),
            _make_issue(key="D-2"),
        ]
        result = filter_today(issues)
        assert len(result) == 1
        assert result[0]["key"] == "D-1"

    def test_none_today(self):
        issues = [
            _make_issue(key="N-1", updated="2020-01-01T00:00:00.000+0000"),
        ]
        result = filter_today(issues)
        assert len(result) == 0


# ── Edge cases ────────────────────────────────────────────────────────


class TestEdgeCases:
    def test_done_case_insensitive(self):
        """Done status should be filtered regardless of case."""
        issues = [
            _make_issue(key="DONE-1", status_category="done"),
            _make_issue(key="DONE-2", status_category="Done"),
            _make_issue(key="DONE-3", status_category="DONE"),
            _make_issue(key="OPEN-1", status_category="To Do"),
        ]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        keys = [r["issue"]["key"] for r in ranked]
        assert "DONE-1" not in keys
        assert "DONE-2" not in keys
        assert "DONE-3" not in keys
        assert "OPEN-1" in keys

    def test_none_priority_handled(self):
        issues = [_make_issue(key="NP-1", priority=None)]
        settings = _make_settings()
        ranked = rank_next(issues, top=10, settings=settings)
        assert len(ranked) == 1
        assert ranked[0]["breakdown"]["priority"] == 30  # None fallback

    def test_empty_issues(self):
        settings = _make_settings()
        blocked = find_blocked([], settings)
        assert blocked == []
        ranked = rank_next([], top=10, settings=settings)
        assert ranked == []

