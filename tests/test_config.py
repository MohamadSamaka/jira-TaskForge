"""Tests for config — loading, validation, path resolution, model tiers."""

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from taskforge.config import Settings, reset_settings


class TestSettings:
    """Tests for the Settings configuration class."""

    def test_defaults(self):
        s = Settings()
        assert s.jira_auth_mode == "cloud"
        assert s.jira_timeout == 30
        assert s.jira_max_retries == 3
        assert s.ai_provider == "ollama"
        assert s.ai_model_default == "phi3:mini"

    def test_blocked_keywords_parsing(self):
        s = Settings(blocked_link_keywords="is blocked by, depends on, waiting for")
        kw = s.blocked_keywords
        assert "is blocked by" in kw
        assert "depends on" in kw
        assert "waiting for" in kw
        assert all(k == k.strip() for k in kw)

    def test_blocked_keywords_empty(self):
        s = Settings(blocked_link_keywords="")
        assert s.blocked_keywords == []

    def test_model_tier_mapping(self):
        s = Settings(
            ai_model_default="default-model",
            ai_model_fast="fast-model",
            ai_model_reason="reason-model",
            ai_model_heavy="heavy-model",
        )
        assert s.get_model("default") == "default-model"
        assert s.get_model("fast") == "fast-model"
        assert s.get_model("reason") == "reason-model"
        assert s.get_model("heavy") == "heavy-model"
        assert s.get_model("unknown") == "default-model"

    def test_validate_jira_config_empty(self):
        s = Settings()
        errors = s.validate_jira_config()
        assert len(errors) >= 2  # base_url and api_token missing

    def test_validate_jira_config_valid_cloud(self):
        s = Settings(
            jira_base_url="https://test.atlassian.net",
            jira_auth_mode="cloud",
            jira_email="user@test.com",
            jira_api_token="abc123",
        )
        errors = s.validate_jira_config()
        assert errors == []

    def test_validate_jira_config_cloud_missing_email(self):
        s = Settings(
            jira_base_url="https://test.atlassian.net",
            jira_auth_mode="cloud",
            jira_email="",
            jira_api_token="abc123",
        )
        errors = s.validate_jira_config()
        assert any("JIRA_EMAIL" in e for e in errors)

    def test_validate_jira_config_server_ok_without_email(self):
        s = Settings(
            jira_base_url="https://jira.company.com",
            jira_auth_mode="server",
            jira_api_token="my-pat",
        )
        errors = s.validate_jira_config()
        assert errors == []

    def test_validate_invalid_auth_mode(self):
        s = Settings(
            jira_base_url="https://x.com",
            jira_auth_mode="oauth",
            jira_api_token="x",
        )
        errors = s.validate_jira_config()
        assert any("JIRA_AUTH_MODE" in e for e in errors)

    def test_as_display_dict_masks_token(self):
        s = Settings(jira_api_token="abcdef123456")
        d = s.as_display_dict()
        assert "abcdef" not in d["JIRA_API_TOKEN"]
        assert d["JIRA_API_TOKEN"].endswith("3456")

    def test_as_display_dict_short_token(self):
        s = Settings(jira_api_token="abc")
        d = s.as_display_dict()
        assert d["JIRA_API_TOKEN"] == "***"

    def test_as_display_dict_empty_token(self):
        s = Settings(jira_api_token="")
        d = s.as_display_dict()
        assert d["JIRA_API_TOKEN"] == "(not set)"

    def test_output_path_uses_pathlib(self):
        s = Settings(output_dir="test_out")
        p = s.output_path
        assert isinstance(p, Path)
        assert p.name == "test_out"
        # Cleanup
        if p.exists():
            p.rmdir()

    def test_data_path_uses_pathlib(self):
        s = Settings(data_dir="test_data")
        p = s.data_path
        assert isinstance(p, Path)
        assert p.name == "test_data"
        # Cleanup
        if p.exists():
            p.rmdir()

    def test_gguf_path_expands_user(self):
        s = Settings(gguf_model_dir="~/models")
        p = s.gguf_path
        assert isinstance(p, Path)
        assert "~" not in str(p)


class TestResetSettings:
    def test_reset_clears_cache(self):
        from taskforge.config import get_settings, reset_settings, _settings_instance

        # Get settings, then reset
        s1 = get_settings()
        reset_settings()
        s2 = get_settings()
        # After reset, a new instance should be created
        # (they may be equal in values but should be different objects)
        reset_settings()  # cleanup
