"""Issue browsing API routes — list, detail, focus, search."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
import re

router = APIRouter()
logger = logging.getLogger(__name__)


# Helper: Simple TTL Cache
import time
from typing import Dict, Any, Tuple
_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}

def _get_cache(key: str, ttl: int = 60) -> Any | None:
    if key in _TTL_CACHE:
        ts, data = _TTL_CACHE[key]
        if time.time() - ts < ttl:
            return data
        del _TTL_CACHE[key]
    return None

def _set_cache(key: str, data: Any):
    _TTL_CACHE[key] = (time.time(), data)

# Global Semaphore for Jira Concurrency
import asyncio
_JIRA_SEMAPHORE = asyncio.Semaphore(3)


@router.get("/issues")
async def list_issues(
    limit: int = Query(100, ge=1, le=500, description="Max issues to return"),
    cursor: Optional[str] = Query(None, description="Jira nextPageToken for pagination"),
    updated_days: int = Query(30, ge=1, le=365, description="Fetch issues updated in last N days"),
    status: Optional[str] = Query(None, description="Filter by status (post-fetch)"),
    assignees: Optional[str] = Query(None, description="Comma-separated assignees (id:accountId, name:Display Name, UNASSIGNED)"),
    assignee_any: bool = Query(False, description="Ignore currentUser assignee filter"),
    projects: Optional[str] = Query(None, description="Comma-separated project keys"),
    statuses: Optional[str] = Query(None, description="Comma-separated statuses"),
    priorities: Optional[str] = Query(None, description="Comma-separated priorities"),
):
    """List issues with cursor-based pagination, hard caps, and TTL caching.
    
    Prevents runaway pagination by enforcing limit and time window.
    Uses POST /rest/api/3/search/jql as strict requirement for Jira Cloud.
    """
    # 1. Check Cache
    cache_key = f"issues_l{limit}_c{cursor}_d{updated_days}_{status}_{assignees}_{assignee_any}_{projects}_{statuses}_{priorities}"
    cached = _get_cache(cache_key)
    if cached:
        return {**cached, "source": "cache"}

    # 2. Build JQL
    from taskforge.config import get_settings
    settings = get_settings()

    def _append_clause(jql: str, clause: str) -> str:
        parts = re.split(r"\border\s+by\b", jql, flags=re.IGNORECASE, maxsplit=1)
        if len(parts) == 2:
            base, order = parts
            return f"({base.strip()}) AND {clause} ORDER BY {order.strip()}"
        return f"({jql.strip()}) AND {clause}"

    def _parse_list(value: str | None) -> list[str]:
        if not value:
            return []
        return [v.strip() for v in value.split(",") if v.strip()]

    def _quote(val: str) -> str:
        return f'"{val.replace("\"", "\\\"")}"'

    def _strip_current_user_assignee(jql: str) -> tuple[str, str]:
        parts = re.split(r"\border\s+by\b", jql, flags=re.IGNORECASE, maxsplit=1)
        base = parts[0]
        order = parts[1] if len(parts) == 2 else ""
        base = re.sub(r"(?i)\bassignee\s*=\s*currentuser\(\)\b", "", base)
        base = re.sub(r"(?i)\bassignee\s+in\s*\(\s*currentuser\(\)\s*\)\b", "", base)
        base = re.sub(r"(?i)\b(AND|OR)\b\s*$", "", base).strip()
        base = re.sub(r"(?i)^\s*(AND|OR)\b", "", base).strip()
        base = re.sub(r"\s{2,}", " ", base).strip()
        return base, order.strip()

    base_jql = settings.jira_jql or "assignee=currentUser() ORDER BY updated DESC"
    if assignee_any or _parse_list(assignees):
        base_part, order_part = _strip_current_user_assignee(base_jql)
        if not base_part:
            base_part = f"updated >= -{updated_days}d"
        base_jql = base_part
        if order_part:
            base_jql = f"{base_jql} ORDER BY {order_part}"

    jql_lower = base_jql.lower()
    if "updated" not in jql_lower and not (assignee_any or _parse_list(assignees)):
        base_jql = _append_clause(base_jql, f"updated >= -{updated_days}d")
    if status:
        safe_status = status.replace('"', '\\"')
        base_jql = _append_clause(base_jql, f'status = "{safe_status}"')

    # Multi-value filters
    project_list = _parse_list(projects)
    status_list = _parse_list(statuses)
    priority_list = _parse_list(priorities)
    assignee_list = _parse_list(assignees)

    if project_list:
        clause = "project in (" + ",".join(_quote(p) for p in project_list) + ")"
        base_jql = _append_clause(base_jql, clause)

    if status_list:
        clause = "status in (" + ",".join(_quote(s) for s in status_list) + ")"
        base_jql = _append_clause(base_jql, clause)

    if priority_list:
        clause = "priority in (" + ",".join(_quote(p) for p in priority_list) + ")"
        base_jql = _append_clause(base_jql, clause)

    if assignee_list and not assignee_any:
        include_unassigned = any(a.upper() == "UNASSIGNED" for a in assignee_list)
        ids: list[str] = []
        names: list[str] = []
        for raw in assignee_list:
            if raw.upper() == "UNASSIGNED":
                continue
            if raw.startswith("id:"):
                ids.append(raw[3:])
            elif raw.startswith("name:"):
                names.append(raw[5:])
            else:
                names.append(raw)
        items = ids + names
        clause_parts: list[str] = []
        if items:
            clause_parts.append("assignee in (" + ",".join(_quote(a) for a in items) + ")")
        if include_unassigned:
            clause_parts.append("assignee is EMPTY")
        if clause_parts:
            clause = " OR ".join(clause_parts)
            if len(clause_parts) > 1:
                clause = f"({clause})"
            base_jql = _append_clause(base_jql, clause)
    
    # 3. Async Fetch with Retry
    import httpx
    
    async def fetch_page():
        async with _JIRA_SEMAPHORE:
            headers = {"Accept": "application/json"}
            auth = None
            if settings.jira_auth_mode == "cloud":
                auth = httpx.BasicAuth(settings.jira_email, settings.jira_api_token)
            else:
                headers["Authorization"] = f"Bearer {settings.jira_api_token}"

            async with httpx.AsyncClient(base_url=settings.jira_base_url, timeout=30.0) as client:
                for attempt in range(3):
                    try:
                        # STRICT: Jira Cloud requires POST /rest/api/3/search/jql 
                        # and strictly forbids 'startAt'. Must use 'nextPageToken'.
                        payload = {
                            "jql": base_jql,
                            "maxResults": min(limit, 100),
                            "fields": ["summary","status","priority","assignee","created","updated","duedate","parent","issuetype","description","project"]
                        }
                        
                        if cursor:
                            payload["nextPageToken"] = cursor
                        
                        resp = await client.post("/rest/api/3/search/jql", json=payload, headers=headers, auth=auth)
                        
                        if resp.status_code == 429:
                            retry_after = int(resp.headers.get("Retry-After", 1))
                            await asyncio.sleep(retry_after)
                            continue
                            
                        if resp.status_code >= 500:
                            await asyncio.sleep(2 ** attempt)
                            continue
                            
                        resp.raise_for_status()
                        return resp.json()
                    except Exception as e:
                        if attempt == 2: raise e
                        await asyncio.sleep(1)

    try:
        data = await fetch_page()
        from taskforge.normalizer import normalize_issues

        raw_issues = data.get("issues", [])
        issues = normalize_issues(raw_issues)
        total = data.get("total", 0)
        next_token = data.get("nextPageToken")
        
        result = {
            "issues": issues,
            "next_cursor": next_token, # usage: ?cursor=...
            "total": total,
            "limit": limit
        }

        # Keep a short-lived snapshot for tree view (UI often fetches /issues then /issues/tree)
        _set_cache("issues_last", issues)

        _set_cache(cache_key, result)
        return {**result, "source": "live"}
        
    except Exception as e:
        import traceback
        error_body = ""
        if hasattr(e, "response") and e.response:
             error_body = f"\nResponse: {e.response.text}"
        
        logger.error(f"Async fetch failed: {e}{error_body}\n{traceback.format_exc()}")
        raise HTTPException(status_code=502, detail=f"Jira fetch failed: {str(e)}")


@router.get("/issues/tree")
async def get_tree():
    """Return the hierarchical tree of issues."""
    import json
    from taskforge.storage import load_latest_tree, load_latest_issues
    from taskforge.tree import build_tree
    from taskforge.config import get_settings

    tree = load_latest_tree()
    if not tree:
        issues = _get_cache("issues_last", ttl=300) or load_latest_issues()
        if issues:
            tree = build_tree(issues)
            # Persist tree so subsequent requests are fast
            settings = get_settings()
            tree_path = settings.output_path / "tasks_tree.json"
            tree_path.write_text(json.dumps(tree, indent=2, default=str), encoding="utf-8")
    return {"tree": tree}


@router.get("/issues/assignees")
async def list_assignees(
    project: str | None = Query(None, description="Project key to limit assignable users"),
):
    """Return assignable users for a project or across cached projects."""
    from taskforge.jira_client import JiraClient
    from taskforge.storage import load_latest_issues

    def _parse_list(value: str | None) -> list[str]:
        if not value:
            return []
        return [v.strip() for v in value.split(",") if v.strip()]

    cache_key = f"assignees_{project or 'all'}"
    cached = _get_cache(cache_key, ttl=300)
    if cached:
        return {"assignees": cached, "source": "cache"}

    project_keys: list[str] = []
    if project:
        project_keys = _parse_list(project)
    else:
        issues = _get_cache("issues_last", ttl=300) or load_latest_issues()
        project_keys = sorted({(i.get("projectKey") or "") for i in issues if i.get("projectKey")})

    if not project_keys:
        # Fallback to visible assignees from cached issues
        issues = _get_cache("issues_last", ttl=300) or load_latest_issues()
        local_assignees = sorted({
            (i.get("assignee") or "") for i in issues if i.get("assignee")
        })
        result = [{"displayName": a} for a in local_assignees]
        return {
            "assignees": result,
            "source": "local",
            "warning": "No project keys found. Run sync or select a project filter to load full assignable users.",
        }

    assignees: dict[str, dict] = {}
    try:
        with JiraClient() as client:
            if not project_keys:
                users = client.list_assignable_users()
                for u in users:
                    key = u.get("accountId") or u.get("name") or u.get("emailAddress") or u.get("displayName")
                    if not key:
                        continue
                    assignees[key] = {
                        "id": u.get("accountId") or u.get("name"),
                        "displayName": u.get("displayName") or u.get("name") or u.get("emailAddress"),
                        "email": u.get("emailAddress"),
                        "active": u.get("active", True),
                    }
            else:
                for pk in project_keys:
                    users = client.list_assignable_users(project_key=pk)
                    for u in users:
                        key = u.get("accountId") or u.get("name") or u.get("emailAddress") or u.get("displayName")
                        if not key:
                            continue
                        assignees[key] = {
                            "id": u.get("accountId") or u.get("name"),
                            "displayName": u.get("displayName") or u.get("name") or u.get("emailAddress"),
                            "email": u.get("emailAddress"),
                            "active": u.get("active", True),
                        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list assignees: {exc}")

    result = sorted(
        assignees.values(),
        key=lambda a: (a.get("displayName") or "").lower(),
    )
    _set_cache(cache_key, result)
    return {"assignees": result, "source": "live"}


@router.get("/issues/{key}")
async def get_issue(key: str):
    """Get a single issue by key."""
    from taskforge.storage import load_latest_issues

    issues = load_latest_issues()
    issue = next((i for i in issues if i.get("key") == key), None)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found in cache")
    return issue


@router.get("/focus/{key}")
async def focus_issue(key: str):
    """Focus on a single issue: return parent, subtasks, siblings, links, descriptions.

    This is the key endpoint for the pro-level browsing experience.
    """
    from taskforge.storage import load_latest_issues

    all_issues = load_latest_issues()
    issues_by_key = {i["key"]: i for i in all_issues}

    issue = issues_by_key.get(key)
    if not issue:
        # Fallback to live fetch if not in local cache
        try:
            from taskforge.jira_client import JiraClient
            from taskforge.normalizer import normalize_issue, normalize_issues

            with JiraClient() as client:
                data = client._search_issues(f'key="{key}"', start_at=0, max_results=1)
                raw_issues = data.get("issues", [])
                if not raw_issues:
                    raise HTTPException(status_code=404, detail=f"Issue {key} not found in cache")
                issue = normalize_issue(raw_issues[0])

                extra_issues: list[dict] = []

                # Fetch parent + subtasks by key for richer context
                keys: list[str] = []
                parent_key = None
                if isinstance(issue.get("parent"), dict):
                    parent_key = issue["parent"].get("key")
                if parent_key:
                    keys.append(parent_key)
                for st in issue.get("subtasks", []):
                    st_key = st.get("key")
                    if st_key:
                        keys.append(st_key)

                if keys:
                    jql_keys = ",".join(sorted(set(keys)))
                    extra = client._search_issues(f"key in ({jql_keys})", start_at=0, max_results=len(keys))
                    extra_issues = normalize_issues(extra.get("issues", []))

                # Fetch siblings by parent if possible (non-fatal if it fails)
                sibling_issues: list[dict] = []
                if parent_key:
                    try:
                        sib = client._search_issues(f'parent="{parent_key}"', start_at=0, max_results=50)
                        sibling_issues = normalize_issues(sib.get("issues", []))
                    except Exception:
                        sibling_issues = []

                all_issues = [issue, *extra_issues, *sibling_issues]
                issues_by_key = {i["key"]: i for i in all_issues if i.get("key")}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=404, detail=f"Issue {key} not found in cache and live fetch failed: {exc}")

    # Parent
    parent = None
    parent_key = None
    if isinstance(issue.get("parent"), dict):
        parent_key = issue["parent"].get("key")
        parent = issues_by_key.get(parent_key, issue.get("parent"))

    # Subtasks: find all issues whose parent is this key
    subtasks = [
        i for i in all_issues
        if isinstance(i.get("parent"), dict) and i["parent"].get("key") == key
    ]
    # Also include subtasks from the issue's own subtasks field
    for st in issue.get("subtasks", []):
        st_key = st.get("key")
        if st_key and st_key not in {s["key"] for s in subtasks}:
            full = issues_by_key.get(st_key, st)
            subtasks.append(full)

    subtasks.sort(key=lambda s: s.get("key", ""))

    # Siblings: if has parent, find other children of same parent
    siblings = []
    if parent_key:
        siblings = [
            i for i in all_issues
            if isinstance(i.get("parent"), dict)
            and i["parent"].get("key") == parent_key
            and i["key"] != key
        ]
        siblings.sort(key=lambda s: s.get("key", ""))

    # Linked issues
    linked = []
    for link in issue.get("links", []):
        linked_key = link.get("linked_key")
        linked_issue = issues_by_key.get(linked_key)
        linked.append({
            **link,
            "full_issue": linked_issue,
        })

    return {
        "issue": issue,
        "parent": parent,
        "subtasks": subtasks,
        "siblings": siblings,
        "linked": linked,
        "descriptions": {
            "plain": issue.get("description_plain"),
            "raw": issue.get("description_raw"),
        },
    }


@router.get("/search")
async def search_issues(
    jql: str = Query(..., description="JQL query string"),
    use_cache: bool = Query(True, description="Search cached issues or fetch live from Jira"),
):
    """Search issues by JQL — from cache (fast) or live from Jira."""
    if use_cache:
        from taskforge.storage import load_latest_issues

        all_issues = load_latest_issues()
        # Simple JQL interpreter for cached data
        results = _filter_by_simple_jql(all_issues, jql)
        return {"issues": results, "total": len(results), "source": "cache"}
    else:
        try:
            from taskforge.jira_client import JiraClient
            from taskforge.normalizer import normalize_issues

            with JiraClient() as client:
                # Override JQL for this search
                data = client._search_issues(jql, start_at=0, max_results=50)
                raw_issues = data.get("issues", [])
                issues = normalize_issues(raw_issues)
                return {"issues": issues, "total": len(issues), "source": "live"}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))


def _filter_by_simple_jql(issues: list, jql: str) -> list:
    """Simple JQL-like filter for cached issues.

    Supports basic patterns:
    - assignee=currentUser()
    - project=X
    - status="In Progress"
    - key=ABC-123
    - Full text search as fallback
    """
    jql_lower = jql.lower().strip()

    # Direct key match
    if jql_lower.startswith("key=") or jql_lower.startswith("key ="):
        target = jql.split("=", 1)[1].strip().strip('"').strip("'")
        return [i for i in issues if i.get("key", "").upper() == target.upper()]

    # Project filter
    if jql_lower.startswith("project=") or jql_lower.startswith("project ="):
        target = jql.split("=", 1)[1].strip().strip('"').strip("'").upper()
        return [i for i in issues if (i.get("projectKey") or "").upper() == target]

    # Status filter
    if jql_lower.startswith("status=") or jql_lower.startswith("status ="):
        target = jql.split("=", 1)[1].strip().strip('"').strip("'").lower()
        return [i for i in issues if (i.get("status") or "").lower() == target]

    # Assignee filter
    if "assignee=currentuser()" in jql_lower:
        # In cache mode, all issues are already the current user's
        return issues

    # Fallback: text search across key + summary
    return [
        i for i in issues
        if jql_lower in (i.get("key") or "").lower()
        or jql_lower in (i.get("summary") or "").lower()
        or jql_lower in (i.get("description_plain") or "").lower()
    ]
