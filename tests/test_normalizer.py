"""Tests for normalizer — ADF parsing and schema completeness."""

import pytest

from taskforge.normalizer import adf_to_text, normalize_issue


# ── ADF to text ───────────────────────────────────────────────────────


class TestAdfToText:
    """Tests for the ADF-to-plain-text extractor."""

    def test_none_returns_empty(self):
        assert adf_to_text(None) == ""

    def test_string_passthrough(self):
        assert adf_to_text("hello") == "hello"

    def test_simple_paragraph(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Hello world"}],
                }
            ],
        }
        result = adf_to_text(adf)
        assert "Hello world" in result

    def test_nested_paragraphs(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Line 1"}],
                },
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Line 2"}],
                },
            ],
        }
        result = adf_to_text(adf)
        assert "Line 1" in result
        assert "Line 2" in result

    def test_bullet_list(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "Item A"}],
                                }
                            ],
                        },
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "Item B"}],
                                }
                            ],
                        },
                    ],
                }
            ],
        }
        result = adf_to_text(adf)
        assert "Item A" in result
        assert "Item B" in result
        assert "•" in result

    def test_code_block(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "codeBlock",
                    "content": [{"type": "text", "text": "print('hello')"}],
                }
            ],
        }
        result = adf_to_text(adf)
        assert "print('hello')" in result
        assert "```" in result

    def test_mention(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "mention", "attrs": {"text": "John Doe", "id": "123"}},
                    ],
                }
            ],
        }
        result = adf_to_text(adf)
        assert "@John Doe" in result

    def test_emoji(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "emoji", "attrs": {"shortName": ":thumbsup:"}},
                    ],
                }
            ],
        }
        result = adf_to_text(adf)
        assert ":thumbsup:" in result

    def test_inline_card(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "inlineCard",
                            "attrs": {"url": "https://example.com"},
                        },
                    ],
                }
            ],
        }
        result = adf_to_text(adf)
        assert "https://example.com" in result

    def test_hard_break(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "before"},
                        {"type": "hardBreak"},
                        {"type": "text", "text": "after"},
                    ],
                }
            ],
        }
        result = adf_to_text(adf)
        assert "before" in result
        assert "after" in result

    def test_blockquote(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "blockquote",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "Quoted text"}],
                        }
                    ],
                }
            ],
        }
        result = adf_to_text(adf)
        assert ">" in result
        assert "Quoted text" in result


# ── Normalization schema ──────────────────────────────────────────────


EXPECTED_KEYS = {
    "key",
    "id",
    "projectKey",
    "type",
    "summary",
    "status",
    "statusCategory",
    "priority",
    "assignee",
    "created",
    "updated",
    "dueDate",
    "description_plain",
    "description_raw",
    "parent",
    "subtasks",
    "links",
    "labels",
    "components",
}


class TestNormalizeIssue:
    """Tests for normalize_issue schema completeness."""

    def _make_raw(self, **field_overrides) -> dict:
        """Build a raw Jira issue for testing."""
        fields = {
            "summary": "Test issue",
            "status": {"name": "Open", "statusCategory": {"name": "To Do"}},
            "priority": {"name": "Medium"},
            "assignee": {"displayName": "Jane", "emailAddress": "jane@co.com"},
            "issuetype": {"name": "Task"},
            "project": {"key": "TEST"},
            "created": "2025-01-01T00:00:00.000+0000",
            "updated": "2025-01-02T00:00:00.000+0000",
            "duedate": "2025-01-15",
            "description": "Plain text description",
            "parent": None,
            "subtasks": [],
            "issuelinks": [],
            "labels": ["backend"],
            "components": [{"name": "API"}],
        }
        fields.update(field_overrides)
        return {"key": "TEST-1", "id": "10001", "fields": fields}

    def test_all_keys_present(self):
        raw = self._make_raw()
        result = normalize_issue(raw)
        assert set(result.keys()) == EXPECTED_KEYS

    def test_null_for_missing_fields(self):
        raw = {"key": "X-1", "id": "1", "fields": {}}
        result = normalize_issue(raw)
        assert set(result.keys()) == EXPECTED_KEYS
        assert result["summary"] is None
        assert result["parent"] is None
        assert result["dueDate"] is None

    def test_string_description(self):
        raw = self._make_raw(description="Hello world")
        result = normalize_issue(raw)
        assert result["description_plain"] == "Hello world"
        assert result["description_raw"] == "Hello world"

    def test_adf_description(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "ADF content"}],
                }
            ],
        }
        raw = self._make_raw(description=adf)
        result = normalize_issue(raw)
        assert "ADF content" in result["description_plain"]
        assert result["description_raw"] == adf

    def test_parent_normalized(self):
        parent = {
            "key": "TEST-0",
            "id": "10000",
            "fields": {
                "summary": "Parent issue",
                "status": {"name": "In Progress", "statusCategory": {"name": "In Progress"}},
                "priority": {"name": "High"},
                "issuetype": {"name": "Story"},
            },
        }
        raw = self._make_raw(parent=parent)
        result = normalize_issue(raw)
        assert result["parent"]["key"] == "TEST-0"
        assert result["parent"]["summary"] == "Parent issue"

    def test_subtasks_normalized(self):
        subtasks = [
            {
                "key": "TEST-2",
                "id": "10002",
                "fields": {
                    "summary": "Sub 1",
                    "status": {"name": "Done", "statusCategory": {"name": "Done"}},
                    "priority": {"name": "Low"},
                    "issuetype": {"name": "Sub-task"},
                },
            }
        ]
        raw = self._make_raw(subtasks=subtasks)
        result = normalize_issue(raw)
        assert len(result["subtasks"]) == 1
        assert result["subtasks"][0]["key"] == "TEST-2"

    def test_links_normalized(self):
        links = [
            {
                "type": {"name": "Blocks", "inward": "is blocked by", "outward": "blocks"},
                "inwardIssue": {
                    "key": "TEST-5",
                    "fields": {
                        "summary": "Blocker",
                        "status": {"name": "Open", "statusCategory": {"name": "To Do"}},
                    },
                },
            }
        ]
        raw = self._make_raw(issuelinks=links)
        result = normalize_issue(raw)
        assert len(result["links"]) == 1
        link = result["links"][0]
        assert link["linked_key"] == "TEST-5"
        assert link["direction"] == "inward"
        assert link["relation"] == "is blocked by"

    def test_components_as_strings(self):
        raw = self._make_raw(components=[{"name": "Frontend"}, {"name": "Backend"}])
        result = normalize_issue(raw)
        assert result["components"] == ["Frontend", "Backend"]
