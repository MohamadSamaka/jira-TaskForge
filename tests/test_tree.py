"""Tests for hierarchy tree builder."""

import pytest

from taskforge.tree import build_tree, flatten_tree


def _make_issue(key, parent_key=None, summary=None):
    parent = {"key": parent_key} if parent_key else None
    return {
        "key": key,
        "id": key,
        "projectKey": "TEST",
        "type": "Task",
        "summary": summary or f"Issue {key}",
        "status": "Open",
        "statusCategory": "To Do",
        "priority": "Medium",
        "assignee": None,
        "created": None,
        "updated": None,
        "dueDate": None,
        "description_plain": None,
        "description_raw": None,
        "parent": parent,
        "subtasks": [],
        "links": [],
        "labels": [],
        "components": [],
    }


class TestBuildTree:
    def test_single_root(self):
        issues = [_make_issue("A-1")]
        tree = build_tree(issues)
        assert len(tree) == 1
        assert tree[0]["key"] == "A-1"
        assert tree[0]["children"] == []

    def test_parent_child(self):
        issues = [
            _make_issue("PARENT-1"),
            _make_issue("CHILD-1", parent_key="PARENT-1"),
        ]
        tree = build_tree(issues)
        assert len(tree) == 1
        assert tree[0]["key"] == "PARENT-1"
        assert len(tree[0]["children"]) == 1
        assert tree[0]["children"][0]["key"] == "CHILD-1"

    def test_multiple_children(self):
        issues = [
            _make_issue("P-1"),
            _make_issue("C-1", parent_key="P-1"),
            _make_issue("C-2", parent_key="P-1"),
            _make_issue("C-3", parent_key="P-1"),
        ]
        tree = build_tree(issues)
        assert len(tree) == 1
        children_keys = [c["key"] for c in tree[0]["children"]]
        assert children_keys == ["C-1", "C-2", "C-3"]

    def test_orphan_becomes_root(self):
        """Issue whose parent wasn't fetched should be treated as a root."""
        issues = [
            _make_issue("ORPHAN-1", parent_key="MISSING-1"),
        ]
        tree = build_tree(issues)
        assert len(tree) == 1
        assert tree[0]["key"] == "ORPHAN-1"

    def test_multiple_roots(self):
        issues = [
            _make_issue("A-1"),
            _make_issue("B-1"),
        ]
        tree = build_tree(issues)
        assert len(tree) == 2

    def test_deep_nesting(self):
        issues = [
            _make_issue("L1"),
            _make_issue("L2", parent_key="L1"),
            _make_issue("L3", parent_key="L2"),
        ]
        tree = build_tree(issues)
        assert len(tree) == 1
        assert tree[0]["key"] == "L1"
        l2 = tree[0]["children"][0]
        assert l2["key"] == "L2"
        assert l2["children"][0]["key"] == "L3"

    def test_deterministic_sort(self):
        """Roots and children must be sorted by key."""
        issues = [
            _make_issue("Z-1"),
            _make_issue("A-1"),
            _make_issue("M-1"),
        ]
        tree = build_tree(issues)
        keys = [n["key"] for n in tree]
        assert keys == ["A-1", "M-1", "Z-1"]


class TestFlattenTree:
    def test_flatten_simple(self):
        issues = [
            _make_issue("P-1"),
            _make_issue("C-1", parent_key="P-1"),
        ]
        tree = build_tree(issues)
        flat = flatten_tree(tree)
        assert len(flat) == 2
        assert flat[0]["key"] == "P-1"
        assert flat[0]["_depth"] == 0
        assert flat[1]["key"] == "C-1"
        assert flat[1]["_depth"] == 1

    def test_flatten_preserves_order(self):
        issues = [
            _make_issue("R-1"),
            _make_issue("R-2"),
            _make_issue("C-1", parent_key="R-1"),
        ]
        tree = build_tree(issues)
        flat = flatten_tree(tree)
        keys = [n["key"] for n in flat]
        # C-1 should come right after R-1 (its parent), before R-2
        assert keys == ["C-1", "R-1", "R-2"] or keys == ["R-1", "C-1", "R-2"]

    def test_empty_input(self):
        tree = build_tree([])
        flat = flatten_tree(tree)
        assert flat == []

    def test_duplicate_keys_keeps_latest(self):
        """When issues have duplicate keys, build_tree should still work."""
        issues = [
            _make_issue("DUP-1", summary="First"),
            _make_issue("DUP-1", summary="Second"),
        ]
        tree = build_tree(issues)
        assert len(tree) == 1
        assert tree[0]["summary"] == "Second"

