"""Deterministic queries — blocked, next, by-project, today."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from taskforge.config import Settings, get_settings


# ── Blocked detection ──────────────────────────────────────────────────


def find_blocked(
    issues: list[dict[str, Any]], settings: Settings | None = None
) -> list[dict[str, Any]]:
    """Return issues that are blocked, with blocker details.

    An issue is blocked if:
    1. It has an inward link whose relation matches a blocked keyword, OR
    2. A configurable flag field is set.

    Returns list of dicts: {issue, blockers: [{key, summary, status, relation}]}
    """
    s = settings or get_settings()
    keywords = s.blocked_keywords
    flag_field = s.blocked_flag_field

    results: list[dict[str, Any]] = []

    for issue in issues:
        blockers: list[dict[str, Any]] = []

        for link in issue.get("links", []):
            relation = (link.get("relation") or "").lower()
            if any(kw in relation for kw in keywords):
                blockers.append(
                    {
                        "key": link.get("linked_key"),
                        "summary": link.get("linked_summary"),
                        "status": link.get("linked_status"),
                        "relation": link.get("relation"),
                    }
                )

        # Check custom flag field (rare but supported)
        if flag_field and issue.get(flag_field):
            blockers.append(
                {
                    "key": None,
                    "summary": f"Flagged via {flag_field}",
                    "status": None,
                    "relation": "flagged",
                }
            )

        if blockers:
            results.append({"issue": issue, "blockers": blockers})

    return results


def is_blocked(issue: dict[str, Any], settings: Settings | None = None) -> bool:
    """Check whether a single issue is blocked."""
    return len(find_blocked([issue], settings)) > 0


# ── Next / priority ranking ───────────────────────────────────────────

PRIORITY_SCORES: dict[str | None, int] = {
    "Highest": 100,
    "High": 75,
    "Medium": 50,
    "Low": 25,
    "Lowest": 10,
    None: 30,
}

# Case-insensitive set of status categories that mean "done"
_DONE_CATEGORIES_LOWER = {"done", "complete", "closed"}


def _is_done_category(cat: str | None) -> bool:
    """Check if a status category indicates completion (case-insensitive)."""
    if not cat:
        return False
    return cat.strip().lower() in _DONE_CATEGORIES_LOWER


def _due_date_score(due: str | None) -> float:
    """Score urgency based on due date. Higher = more urgent."""
    if not due:
        return 0.0
    try:
        due_dt = datetime.fromisoformat(due.replace("Z", "+00:00"))
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        days_left = (due_dt - now).total_seconds() / 86400
        if days_left < 0:
            return 80.0  # overdue
        if days_left < 1:
            return 60.0
        if days_left < 3:
            return 40.0
        if days_left < 7:
            return 20.0
        return 5.0
    except (ValueError, TypeError):
        return 0.0


def _recency_score(updated: str | None) -> float:
    """Score recency — recently updated items get a small boost."""
    if not updated:
        return 0.0
    try:
        upd_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
        if upd_dt.tzinfo is None:
            upd_dt = upd_dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        hours_ago = (now - upd_dt).total_seconds() / 3600
        if hours_ago < 4:
            return 15.0
        if hours_ago < 24:
            return 10.0
        if hours_ago < 72:
            return 5.0
        return 0.0
    except (ValueError, TypeError):
        return 0.0


def rank_next(
    issues: list[dict[str, Any]],
    top: int = 10,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Rank issues by priority, due date, recency, blocked penalty.

    Returns list of {issue, score, breakdown} sorted descending.
    Only includes non-done issues.
    """
    s = settings or get_settings()
    blocked_keys = {
        r["issue"]["key"]
        for r in find_blocked(issues, s)
    }

    results: list[dict[str, Any]] = []

    for issue in issues:
        # Skip done issues (case-insensitive check)
        cat = issue.get("statusCategory", "")
        if _is_done_category(cat):
            continue

        priority = issue.get("priority")
        p_score = PRIORITY_SCORES.get(priority, 30)
        d_score = _due_date_score(issue.get("dueDate"))
        r_score = _recency_score(issue.get("updated"))
        b_penalty = -50.0 if issue.get("key") in blocked_keys else 0.0

        total = p_score + d_score + r_score + b_penalty

        results.append(
            {
                "issue": issue,
                "score": round(total, 1),
                "breakdown": {
                    "priority": p_score,
                    "due_date": round(d_score, 1),
                    "recency": round(r_score, 1),
                    "blocked_penalty": b_penalty,
                },
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top]


# ── Group by project ──────────────────────────────────────────────────


def group_by_project(
    issues: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Group issues by projectKey."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for issue in issues:
        proj = issue.get("projectKey") or "UNKNOWN"
        groups.setdefault(proj, []).append(issue)
    # Sort keys
    return dict(sorted(groups.items()))


# ── Today ─────────────────────────────────────────────────────────────


def filter_today(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return issues that were updated today or are due today."""
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    results: list[dict[str, Any]] = []

    for issue in issues:
        updated = issue.get("updated") or ""
        due = issue.get("dueDate") or ""

        if updated.startswith(today_str) or due.startswith(today_str):
            results.append(issue)

    return results
