"""Hierarchy tree builder — converts flat issues into nested parent→children tree."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def build_tree(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build a nested hierarchy from flat normalized issues.

    Each issue can appear as a root or as a child under its parent.
    Issues whose parent was not fetched are treated as roots.

    Returns a list of root-level tree nodes, each with a 'children' key.
    """
    by_key: dict[str, dict[str, Any]] = {}

    for issue in issues:
        key = issue.get("key", "")
        if key in by_key:
            # Duplicate key detected — warn and keep the later version
            logger.warning("Duplicate issue key detected: %s — keeping latest", key)
        node = {**issue, "children": []}
        by_key[key] = node

    roots: list[dict[str, Any]] = []
    orphan_count = 0

    for node in by_key.values():
        parent = node.get("parent")
        parent_key = parent.get("key") if isinstance(parent, dict) else None

        if parent_key and parent_key in by_key:
            by_key[parent_key]["children"].append(node)
        else:
            if parent_key:
                orphan_count += 1
            roots.append(node)

    if orphan_count:
        logger.info(
            "Tree builder: %d issues had parent references not in the dataset (treated as roots)",
            orphan_count,
        )

    # Sort roots by key for deterministic output
    roots.sort(key=lambda n: n.get("key", ""))

    # Sort children recursively
    _sort_children(roots)

    return roots


def _sort_children(nodes: list[dict[str, Any]]) -> None:
    """Recursively sort children by key."""
    for node in nodes:
        children = node.get("children", [])
        children.sort(key=lambda n: n.get("key", ""))
        _sort_children(children)


def flatten_tree(tree: list[dict[str, Any]], depth: int = 0) -> list[dict[str, Any]]:
    """Flatten a tree back into a list, adding a '_depth' field for display."""
    result: list[dict[str, Any]] = []
    for node in tree:
        flat = {k: v for k, v in node.items() if k != "children"}
        flat["_depth"] = depth
        result.append(flat)
        result.extend(flatten_tree(node.get("children", []), depth + 1))
    return result
