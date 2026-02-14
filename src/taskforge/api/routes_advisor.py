"""AI Advisor routes — context gathering and prompt generation."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)


class AdvisorRunRequest(BaseModel):
    model: str | None = None
    include_current_description: bool | None = None
    include_subtask_descriptions: bool | None = None
    include_parent_description: bool | None = None
    skip_local: bool | None = None


def _gather_task_context(key: str) -> Dict[str, Any]:
    """Gather deterministic context for a task: parent, subtasks, siblings."""
    from taskforge.storage import load_latest_issues

    all_issues = load_latest_issues()
    issues_by_key = {i["key"]: i for i in all_issues}
    
    current = issues_by_key.get(key)
    if not current:
        # Fallback to live fetch if not in local cache
        try:
            from taskforge.jira_client import JiraClient
            from taskforge.normalizer import normalize_issue, normalize_issues

            with JiraClient() as client:
                data = client._search_issues(f'key="{key}"', start_at=0, max_results=1)
                raw_issues = data.get("issues", [])
                if not raw_issues:
                    raise HTTPException(status_code=404, detail=f"Issue {key} not found")
                current = normalize_issue(raw_issues[0])

                # Fetch parent + subtasks (if any) for richer context
                keys: list[str] = []
                parent_key = None
                if isinstance(current.get("parent"), dict):
                    parent_key = current["parent"].get("key")
                if parent_key:
                    keys.append(parent_key)
                for st in current.get("subtasks", []):
                    st_key = st.get("key")
                    if st_key:
                        keys.append(st_key)

                if keys:
                    jql_keys = ",".join(sorted(set(keys)))
                    extra = client._search_issues(f"key in ({jql_keys})", start_at=0, max_results=len(keys))
                    extra_issues = normalize_issues(extra.get("issues", []))
                    issues_by_key = {i["key"]: i for i in extra_issues}
                    issues_by_key[current["key"]] = current
                    all_issues = [current, *extra_issues]
                else:
                    issues_by_key = {current["key"]: current}
                    all_issues = [current]
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=404, detail=f"Issue {key} not found in cache and live fetch failed: {exc}")

    # Parent
    parent = None
    if isinstance(current.get("parent"), dict):
        parent_key = current["parent"].get("key")
        parent = issues_by_key.get(parent_key) # minimal or full

    # Subtasks
    subtasks = [
        val for val in all_issues
        if isinstance(val.get("parent"), dict) and val["parent"].get("key") == key
    ]

    # Siblings
    siblings = []
    if parent:
        parent_key = parent.get("key")
        siblings = [
            val for val in all_issues
            if isinstance(val.get("parent"), dict)
            and val["parent"].get("key") == parent_key
            and val["key"] != key
        ]
        
    return {
        "current": current,
        "parent": parent,
        "subtasks": subtasks,
        "siblings": siblings
    }


def _build_advisor_prompt(
    context: Dict[str, Any],
    include_current_description: bool = True,
    include_subtask_descriptions: bool = False,
    include_parent_description: bool = False,
) -> str:
    """Construct a deterministic strict prompt from the dataset."""
    current = context["current"]
    parent = context["parent"]
    subtasks = context["subtasks"]
    siblings = context["siblings"]
    
    lines = []
    lines.append("You are a senior project manager AI. Analyze the following Jira task context and provide actionable advice.")
    lines.append("\n=== CURRENT TASK ===")
    lines.append(f"Key: {current.get('key')}")
    lines.append(f"Summary: {current.get('summary')}")
    lines.append(f"Type: {current.get('type')}")
    lines.append(f"Status: {current.get('status')} ({current.get('statusCategory')})")
    lines.append(f"Priority: {current.get('priority')}")
    lines.append(f"Assignee: {current.get('assignee') or 'Unassigned'}")
    
    if include_current_description:
        desc = current.get('description_plain')
        if desc:
            valid_desc = desc if len(desc) < 1000 else desc[:1000] + "...(truncated)"
            lines.append(f"Description:\n{valid_desc}")
        else:
            lines.append("Description: (None)")
    else:
        lines.append("Description: (omitted)")

    if parent:
        lines.append("\n=== PARENT TASK ===")
        lines.append(f"[{parent.get('key')}] {parent.get('summary')} ({parent.get('status')})")
        if include_parent_description:
            p_desc = parent.get('description_plain')
            if p_desc:
                trunc = p_desc if len(p_desc) < 600 else p_desc[:600] + "...(truncated)"
                lines.append(f"Parent Description:\n{trunc}")

    if subtasks:
        lines.append("\n=== SUBTASKS (Children) ===")
        for s in subtasks:
            summary = s.get('summary', 'No summary')
            status = s.get('status', 'Unknown')
            priority = s.get('priority', 'Unknown')
            lines.append(f"- [{s.get('key')}] {summary} (Status: {status}, Priority: {priority})")
            
            if include_subtask_descriptions:
                st_desc = s.get('description_plain')
                if st_desc:
                    trunc = st_desc if len(st_desc) < 300 else st_desc[:300] + "..."
                    lines.append(f"  Description: {trunc}")

    if siblings:
        lines.append("\n=== SIBLINGS (Same Parent) ===")
        for s in siblings:
            lines.append(f"- [{s.get('key')}] {s.get('summary')} (Status: {s.get('status')})")

    lines.append("\n=== INSTRUCTIONS ===")
    lines.append("Based on the above, answer the following:")
    lines.append("1. IMMEDIATE ACTION: What should be done first for the CURRENT TASK?")
    lines.append("2. BLOCKERS: key risks or dependencies based on status (e.g. parent is closed but subtask open).")
    lines.append("3. INCONSISTENCIES: Any mismatch in priority or status between parent/subtasks.")
    lines.append("4. MISSING INFO: meaningful fields or description details that seem absent.")
    lines.append("\nOutput format: JSON with keys 'action', 'blockers', 'inconsistencies', 'missing'.")
    lines.append("Return ONLY valid JSON. Use double quotes. No trailing commas. No extra text.")
    lines.append("Use arrays for 'blockers' and 'inconsistencies'. If none, use []. If unknown, use null.")
    lines.append('Example: {"action":"...", "blockers":[], "inconsistencies":[], "missing":null}')
    
    return "\n".join(lines)


@router.get("/advisor/dataset/{key}")
async def get_advisor_dataset(key: str):
    """Get structured context dataset for AI Advisor."""
    return _gather_task_context(key)


@router.get("/advisor/prompt/{key}")
async def get_advisor_prompt(
    key: str,
    include_current_description: bool | None = Query(None),
    include_subtask_descriptions: bool | None = Query(None),
    include_parent_description: bool | None = Query(None),
):
    """Get ready-to-use prompt text for AI Advisor."""
    from taskforge.config import get_settings

    settings = get_settings()
    context = _gather_task_context(key)
    return {"prompt": _build_advisor_prompt(
        context,
        include_current_description=(
            include_current_description
            if include_current_description is not None
            else settings.advisor_include_current_description
        ),
        include_subtask_descriptions=(
            include_subtask_descriptions
            if include_subtask_descriptions is not None
            else settings.advisor_include_subtask_descriptions
        ),
        include_parent_description=(
            include_parent_description
            if include_parent_description is not None
            else settings.advisor_include_parent_description
        ),
    )}


@router.post("/advisor/run/{key}")
async def run_advisor(key: str, req: AdvisorRunRequest | None = None):
    """Execute the AI Advisor analysis for a specific task."""
    from taskforge.config import get_settings
    context = _gather_task_context(key)
    prompt = _build_advisor_prompt(
        context,
        include_current_description=(
            req.include_current_description
            if req and req.include_current_description is not None
            else settings.advisor_include_current_description
        ),
        include_subtask_descriptions=(
            req.include_subtask_descriptions
            if req and req.include_subtask_descriptions is not None
            else settings.advisor_include_subtask_descriptions
        ),
        include_parent_description=(
            req.include_parent_description
            if req and req.include_parent_description is not None
            else settings.advisor_include_parent_description
        ),
    )
    
    settings = get_settings()
    try:
        from taskforge.ai.router import generate_with_fallback, validate_json_keys, GroqAuthError, GroqRequestError
        # Use provided model, else reason model if available, else default
        model = (req.model if req else None) or settings.ai_model_reason or settings.ai_model_default
        response, provider_used, validation = generate_with_fallback(
            prompt,
            context="",
            model=model,
            validator=lambda text: validate_json_keys(text, ["action", "blockers", "inconsistencies", "missing"]),
            entrypoint="api.advisor.run",
            skip_local=(req.skip_local if req else None),
        )
        return {
            "response": response,
            "prompt": prompt,
            "provider": provider_used,
            "validation": {"ok": validation.ok, "detail": validation.detail} if validation else None,
        }
    except GroqAuthError as exc:
        raise HTTPException(status_code=401, detail=f"Groq authentication failed. {exc} Update GROQ_API_KEY and restart.")
    except GroqRequestError as exc:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI execution failed: {exc}")
