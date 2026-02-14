"""System API routes — sync, auth-test, config, doctor, init."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)


class SyncRequest(BaseModel):
    use_db: bool = False


class SyncResponse(BaseModel):
    issues_count: int
    snapshot_path: str
    message: str


@router.post("/sync", response_model=SyncResponse)
async def sync(req: SyncRequest = SyncRequest()):
    """Fetch issues from Jira, normalize, store, and output."""
    try:
        from taskforge.jira_client import JiraClient, JiraClientError
        from taskforge.normalizer import normalize_issues
        from taskforge.tree import build_tree
        from taskforge.storage import save_snapshot

        with JiraClient() as client:
            raw_issues = client.fetch_with_hierarchy()

        issues = normalize_issues(raw_issues)
        tree = build_tree(issues)
        snap_path = save_snapshot(issues, tree)

        if req.use_db:
            try:
                from taskforge.storage import SQLiteStore
                with SQLiteStore() as store:
                    store.record_sync(issues, snap_path)
            except Exception as exc:
                logger.warning("SQLite recording failed (non-fatal): %s", exc)

        return SyncResponse(
            issues_count=len(issues),
            snapshot_path=str(snap_path),
            message=f"Synced {len(issues)} issues",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/auth-test")
async def auth_test():
    """Test Jira authentication."""
    try:
        from taskforge.jira_client import JiraClient, JiraClientError
        with JiraClient() as client:
            user = client.test_auth()
        return {
            "ok": True,
            "displayName": user.get("displayName", user.get("name", "?")),
            "email": user.get("emailAddress", ""),
            "accountId": user.get("accountId", "N/A"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.get("/config")
async def config_show():
    """Return resolved configuration (sensitive values masked)."""
    from taskforge.config import get_settings
    settings = get_settings()
    return {
        "config": settings.as_display_dict(),
        "errors": settings.validate_jira_config(),
    }


@router.post("/init")
async def init_project():
    """Initialize TaskForge project structure."""
    from taskforge.config import PROJECT_ROOT

    dirs = [
        Path("out"),
        Path("data"),
        Path("data") / "snapshots",
        Path("docs"),
    ]
    created = []
    for d in dirs:
        full = PROJECT_ROOT / d
        full.mkdir(parents=True, exist_ok=True)
        created.append(str(d))

    env_file = PROJECT_ROOT / ".env"
    env_created = False
    if not env_file.exists():
        env_file.touch()
        env_created = True

    return {
        "directories_created": created,
        "env_created": env_created,
        "project_root": str(PROJECT_ROOT),
    }


@router.get("/doctor")
async def doctor():
    """Run system diagnostics and return JSON report."""
    from taskforge.config import get_settings
    from taskforge.storage import load_latest_issues
    import json
    import platform

    settings = get_settings()
    report: dict = {
        "platform": f"{platform.system()} {platform.release()}",
        "jira": {},
        "storage": {},
        "data_integrity": {},
        "ai": {},
    }

    # Jira config
    errors = settings.validate_jira_config()
    report["jira"] = {
        "base_url": settings.jira_base_url or "(not set)",
        "auth_mode": settings.jira_auth_mode,
        "valid": len(errors) == 0,
        "errors": errors,
    }

    # Storage
    report["storage"] = {
        "output_dir": str(settings.output_path),
        "data_dir": str(settings.data_path),
        "sqlite_path": str(settings.sqlite_path),
    }

    # Data integrity
    issues = load_latest_issues()
    if issues:
        keys = [i.get("key") for i in issues if i.get("key")]
        unique_keys = set(keys)
        dupes = [k for k in unique_keys if keys.count(k) > 1]
        orphans = []
        for issue in issues:
            parent = issue.get("parent")
            if isinstance(parent, dict) and parent.get("key"):
                if parent["key"] not in unique_keys:
                    orphans.append(parent["key"])

        report["data_integrity"] = {
            "total_issues": len(issues),
            "unique_keys": len(unique_keys),
            "duplicates": dupes,
            "orphan_parents": list(set(orphans)),
            "missing_status": [i["key"] for i in issues if not i.get("status")][:5],
        }
    else:
        report["data_integrity"] = {"total_issues": 0, "message": "No synced data"}

    # AI
    try:
        from taskforge.ai.doctor import run_doctor as _run_doctor
        import io
        from rich.console import Console
        # Run doctor silently, capture report dict
        buf = io.StringIO()
        con = Console(file=buf, force_terminal=False, no_color=True)
        ai_report = _run_doctor(con)
        report["ai"] = ai_report
    except Exception as exc:
        report["ai"] = {"error": str(exc)}

    return report
