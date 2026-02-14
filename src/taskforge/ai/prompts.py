"""Prompt builder - constructs context-grounded prompts for AI commands."""

from __future__ import annotations

import json
from datetime import date
from typing import Any


def _build_task_context(issues: list[dict[str, Any]], max_issues: int = 50) -> str:
    """Build a concise task context string from issues for AI consumption.

    Selects key fields only to stay within token limits.
    """
    context_items: list[dict[str, Any]] = []
    for issue in issues[:max_issues]:
        item = {
            "key": issue.get("key"),
            "type": issue.get("type"),
            "summary": issue.get("summary"),
            "status": issue.get("status"),
            "statusCategory": issue.get("statusCategory"),
            "priority": issue.get("priority"),
            "assignee": issue.get("assignee"),
            "dueDate": issue.get("dueDate"),
            "updated": issue.get("updated"),
            "labels": issue.get("labels", []),
            "projectKey": issue.get("projectKey"),
            "parentKey": (issue.get("parent") or {}).get("key") if isinstance(issue.get("parent"), dict) else None,
        }
        # Include description if short
        desc = issue.get("description_plain") or ""
        if len(desc) < 300:
            item["description"] = desc
        else:
            item["description"] = desc[:300] + "..."

        # Include blockers
        links = issue.get("links", [])
        blockers = [
            lnk for lnk in links
            if "block" in (lnk.get("relation") or "").lower()
        ]
        if blockers:
            item["blockers"] = [
                {"key": b.get("linked_key"), "status": b.get("linked_status")}
                for b in blockers
            ]

        context_items.append(item)

    return json.dumps(context_items, indent=1, default=str)


def _grounding_rules() -> str:
    return (
        "Use ONLY the TASK DATA JSON. Do not invent fields or tasks. "
        "If the answer is not in the data, say 'Not in data'. "
        "Prefer concise, actionable output."
    )


def build_today_prompt(issues: list[dict[str, Any]]) -> tuple[str, str]:
    """Build prompt for 'summarize today's tasks'.

    Returns (prompt, context).
    """
    from taskforge.queries import filter_today

    today_issues = filter_today(issues)
    if not today_issues:
        today_issues = issues  # fallback to all if nothing today-specific

    context = _build_task_context(today_issues)
    today = date.today().isoformat()
    prompt = (
        f"Today is {today}. {_grounding_rules()} "
        "Summarize today's tasks. Group by project when possible. "
        "Output format:\n"
        "1) Project heading (e.g., 'Project ABC')\n"
        "2) Bullets: KEY - Summary (Status, Priority, DueDate)\n"
        "3) Add flags: [OVERDUE], [BLOCKED], [HIGH]\n"
        "Finish with a short 'Risks' section if any blockers/overdue exist."
    )
    return prompt, context


def build_next_prompt(
    issues: list[dict[str, Any]],
    ranked: list[dict[str, Any]],
) -> tuple[str, str]:
    """Build prompt for 'what should I work on next?'.

    Uses the deterministic ranking as ground truth.
    Returns (prompt, context).
    """
    ranked_context = []
    for item in ranked[:10]:
        issue = item["issue"]
        ranked_context.append(
            {
                "rank_score": item["score"],
                "breakdown": item["breakdown"],
                "key": issue.get("key"),
                "summary": issue.get("summary"),
                "status": issue.get("status"),
                "priority": issue.get("priority"),
                "dueDate": issue.get("dueDate"),
                "projectKey": issue.get("projectKey"),
            }
        )

    context = json.dumps(ranked_context, indent=1, default=str)
    prompt = (
        f"{_grounding_rules()} Based on the ranked task list below, explain "
        "what to work on next and WHY. Use the ranking order provided. "
        "Return the top 3-5 items as a numbered list. Each item must include: "
        "KEY, summary, and 1-2 reasons referencing the score breakdown. "
        "Do not invent tasks not in the data."
    )
    return prompt, context


def build_ask_prompt(
    issues: list[dict[str, Any]], question: str
) -> tuple[str, str]:
    """Build prompt for a free-form question about tasks.

    Returns (prompt, context).
    """
    context = _build_task_context(issues)
    prompt = (
        f"{_grounding_rules()} Answer the question using the TASK DATA JSON only. "
        f"Question: {question}"
    )
    return prompt, context
