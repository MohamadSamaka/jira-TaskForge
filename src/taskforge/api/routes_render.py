"""Render API routes — JSON and Markdown export."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter()


@router.get("/render/json")
async def render_json():
    """Return issues as formatted JSON."""
    from taskforge.storage import load_latest_issues
    from taskforge.renderer import render_json as _render_json

    issues = load_latest_issues()
    return PlainTextResponse(_render_json(issues), media_type="application/json")


@router.get("/render/md")
async def render_md():
    """Return issues as a Markdown report."""
    from taskforge.storage import load_latest_issues
    from taskforge.renderer import render_markdown

    issues = load_latest_issues()
    return PlainTextResponse(render_markdown(issues), media_type="text/markdown")
