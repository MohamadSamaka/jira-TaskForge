"""Query API routes — blocked, next, today, by-project."""

from __future__ import annotations

from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/query/blocked")
async def query_blocked():
    """Return blocked issues with blocker details."""
    from taskforge.storage import load_latest_issues
    from taskforge.queries import find_blocked

    issues = load_latest_issues()
    blocked = find_blocked(issues)
    return {"blocked": blocked, "total": len(blocked)}


@router.get("/query/next")
async def query_next(
    top: int = Query(10, description="Number of recommendations", ge=1, le=50),
):
    """Rank issues by priority/due/recency and return top recommendations."""
    from taskforge.storage import load_latest_issues
    from taskforge.queries import rank_next

    issues = load_latest_issues()
    ranked = rank_next(issues, top=top)
    return {"ranked": ranked, "total": len(ranked)}


@router.get("/query/today")
async def query_today():
    """Return issues updated or due today."""
    from taskforge.storage import load_latest_issues
    from taskforge.queries import filter_today

    issues = load_latest_issues()
    today_issues = filter_today(issues)
    return {"issues": today_issues, "total": len(today_issues)}


@router.get("/query/by-project")
async def query_by_project():
    """Group issues by project key."""
    from taskforge.storage import load_latest_issues
    from taskforge.queries import group_by_project

    issues = load_latest_issues()
    groups = group_by_project(issues)
    return {"groups": groups}
