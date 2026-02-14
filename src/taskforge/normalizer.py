"""Normalizer — converts raw Jira JSON into a stable, deterministic schema."""

from __future__ import annotations

from typing import Any


# ── ADF (Atlassian Document Format) parser ─────────────────────────────


def adf_to_text(node: Any) -> str:
    """Recursively extract plain text from a Jira Cloud ADF document.

    ADF is a nested JSON tree. We walk it depth-first, collecting text
    content and adding basic formatting hints (newlines, bullet markers).
    """
    if node is None:
        return ""
    if isinstance(node, str):
        return node

    if not isinstance(node, dict):
        return ""

    node_type = node.get("type", "")
    text_parts: list[str] = []

    # Leaf text node
    if node_type == "text":
        return node.get("text", "")

    # Emoji
    if node_type == "emoji":
        attrs = node.get("attrs", {})
        return attrs.get("shortName", attrs.get("text", ""))

    # Mention
    if node_type == "mention":
        attrs = node.get("attrs", {})
        return f"@{attrs.get('text', attrs.get('id', ''))}"

    # Hard break
    if node_type == "hardBreak":
        return "\n"

    # Media — just note that media exists
    if node_type in ("media", "mediaGroup", "mediaSingle"):
        return "[media]"

    # Inline card (link)
    if node_type == "inlineCard":
        attrs = node.get("attrs", {})
        return attrs.get("url", "[link]")

    # Process children
    children = node.get("content", [])
    for child in children:
        text_parts.append(adf_to_text(child))

    joined = "".join(text_parts)

    # Block-level formatting
    if node_type in ("paragraph", "heading"):
        return joined.strip() + "\n"
    if node_type == "bulletList":
        return joined
    if node_type == "orderedList":
        return joined
    if node_type == "listItem":
        return "• " + joined.strip() + "\n"
    if node_type == "blockquote":
        lines = joined.strip().split("\n")
        return "\n".join(f"> {line}" for line in lines) + "\n"
    if node_type == "codeBlock":
        return "```\n" + joined + "```\n"
    if node_type == "rule":
        return "---\n"
    if node_type == "table":
        return joined + "\n"
    if node_type in ("tableRow", "tableHeader", "tableCell"):
        return joined + " | "

    return joined


def _safe_str(val: Any) -> str | None:
    """Extract a string value or return None."""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        return val.get("name") or val.get("displayName") or val.get("value") or str(val)
    return str(val)


def _extract_description(fields: dict[str, Any]) -> tuple[str | None, Any]:
    """Extract plain text and raw description from Jira fields.

    Returns (plain_text, raw_value).
    """
    desc = fields.get("description")
    if desc is None:
        return None, None

    # String description (Jira Server or simple text)
    if isinstance(desc, str):
        return desc, desc

    # ADF document (Jira Cloud)
    if isinstance(desc, dict) and desc.get("type") == "doc":
        plain = adf_to_text(desc).strip()
        return plain if plain else None, desc

    # Unknown format — stringify
    return str(desc), desc


def _normalize_link(link: dict[str, Any]) -> dict[str, Any]:
    """Normalize a single issue link into a flat structure."""
    link_type = link.get("type", {})
    type_name = link_type.get("name", "")

    # Determine direction and linked issue
    if "inwardIssue" in link:
        direction = "inward"
        linked = link["inwardIssue"]
        relation = link_type.get("inward", type_name)
    elif "outwardIssue" in link:
        direction = "outward"
        linked = link["outwardIssue"]
        relation = link_type.get("outward", type_name)
    else:
        return {
            "type": type_name,
            "direction": "unknown",
            "relation": type_name,
            "linked_key": None,
            "linked_summary": None,
            "linked_status": None,
            "linked_status_category": None,
        }

    linked_fields = linked.get("fields", {})
    linked_status = linked_fields.get("status", {})

    return {
        "type": type_name,
        "direction": direction,
        "relation": relation,
        "linked_key": linked.get("key"),
        "linked_summary": linked_fields.get("summary"),
        "linked_status": linked_status.get("name") if isinstance(linked_status, dict) else None,
        "linked_status_category": (
            linked_status.get("statusCategory", {}).get("name")
            if isinstance(linked_status, dict)
            else None
        ),
    }


def _normalize_minimal(issue: dict[str, Any]) -> dict[str, Any]:
    """Normalize a parent or subtask into minimal fields."""
    fields = issue.get("fields", {})
    status = fields.get("status") or {}
    priority = fields.get("priority") or {}
    issuetype = fields.get("issuetype") or {}

    return {
        "key": issue.get("key"),
        "id": issue.get("id"),
        "summary": fields.get("summary"),
        "type": issuetype.get("name") if isinstance(issuetype, dict) else _safe_str(issuetype),
        "status": status.get("name") if isinstance(status, dict) else _safe_str(status),
        "statusCategory": (
            status.get("statusCategory", {}).get("name")
            if isinstance(status, dict)
            else None
        ),
        "priority": priority.get("name") if isinstance(priority, dict) else _safe_str(priority),
    }


def normalize_issue(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw Jira issue into the TaskForge canonical schema.

    Every key in the output is always present. Missing values → None.
    """
    fields = raw.get("fields", {})

    # Status
    status = fields.get("status") or {}
    status_category = (
        status.get("statusCategory", {}) if isinstance(status, dict) else {}
    )

    # Priority
    priority = fields.get("priority") or {}

    # Assignee
    assignee_raw = fields.get("assignee") or {}

    # Issue type
    issuetype = fields.get("issuetype") or {}

    # Project
    project = fields.get("project") or {}

    # Description
    desc_plain, desc_raw = _extract_description(fields)

    # Parent
    parent_raw = fields.get("parent")
    parent = _normalize_minimal(parent_raw) if parent_raw else None

    # Subtasks
    subtasks_raw = fields.get("subtasks") or []
    subtasks = [_normalize_minimal(st) for st in subtasks_raw]

    # Links
    links_raw = fields.get("issuelinks") or []
    links = [_normalize_link(lnk) for lnk in links_raw]

    # Labels & components
    labels = fields.get("labels") or []
    components_raw = fields.get("components") or []
    components = [
        c.get("name") if isinstance(c, dict) else str(c) for c in components_raw
    ]

    return {
        "key": raw.get("key"),
        "id": raw.get("id"),
        "projectKey": project.get("key") if isinstance(project, dict) else None,
        "type": issuetype.get("name") if isinstance(issuetype, dict) else _safe_str(issuetype),
        "summary": fields.get("summary"),
        "status": status.get("name") if isinstance(status, dict) else _safe_str(status),
        "statusCategory": (
            status_category.get("name") if isinstance(status_category, dict) else None
        ),
        "priority": priority.get("name") if isinstance(priority, dict) else _safe_str(priority),
        "assignee": (
            (assignee_raw.get("displayName") or assignee_raw.get("name") or assignee_raw.get("emailAddress"))
            if isinstance(assignee_raw, dict)
            else _safe_str(assignee_raw)
        ) if assignee_raw else None,
        "created": fields.get("created"),
        "updated": fields.get("updated"),
        "dueDate": fields.get("duedate"),
        "description_plain": desc_plain,
        "description_raw": desc_raw,
        "parent": parent,
        "subtasks": subtasks,
        "links": links,
        "labels": labels,
        "components": components,
    }


def normalize_issues(raw_issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize a list of raw Jira issues."""
    return [normalize_issue(issue) for issue in raw_issues]
