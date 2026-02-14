"""Configuration management — loads .env and validates with Pydantic."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings


def _find_project_root() -> Path:
    """Walk up from CWD to find directory containing pyproject.toml or .env."""
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        if (parent / "pyproject.toml").exists() or (parent / ".env").exists():
            return parent
    return cwd


PROJECT_ROOT = _find_project_root()

# Load .env from project root (if it exists)
_env_path = PROJECT_ROOT / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


class Settings(BaseSettings):
    """All TaskForge configuration, loaded from env vars / .env file."""

    # ── Jira ──────────────────────────────────────────────────────────
    jira_base_url: str = Field(default="", description="Jira instance URL")
    jira_auth_mode: str = Field(
        default="cloud", description="'cloud' (email+token) or 'server' (PAT)"
    )
    jira_email: str = Field(default="", description="Atlassian account email (cloud)")
    jira_api_token: str = Field(default="", description="API token or PAT")
    jira_jql: str = Field(
        default="assignee=currentUser() ORDER BY updated DESC",
        description="JQL filter for fetching issues",
    )
    jira_timeout: int = Field(default=30, description="Request timeout seconds")
    jira_max_retries: int = Field(default=3, description="Max retries on 429/5xx")

    # ── Blocked detection ─────────────────────────────────────────────
    blocked_link_keywords: str = Field(
        default="is blocked by,Blocked,depends on",
        description="Comma-separated link type names indicating blocking",
    )
    blocked_flag_field: Optional[str] = Field(
        default=None, description="Custom field name for impediment/flag"
    )

    # ── AI ────────────────────────────────────────────────────────────
    ai_provider: str = Field(default="ollama", description="AI provider name")
    ollama_host: str = Field(
        default="http://localhost:11434", description="Ollama API host"
    )
    ai_model_default: str = Field(default="phi3:mini", description="Default model")
    ai_model_fast: str = Field(default="phi3:mini", description="Fast/small model")
    ai_model_reason: str = Field(default="phi3:mini", description="Reasoning model")
    ai_model_heavy: str = Field(
        default="phi3:medium", description="Heavy/large model"
    )
    ai_models: str = Field(
        default="",
        description="Comma-separated list of models with optional strength, e.g. 'phi3:mini=1,phi3:medium=3,llama3.1:8b=4'",
    )
    ai_skip_local: bool = Field(
        default=False, description="Skip local LLM and use Groq directly"
    )
    groq_api_key: str = Field(
        default="", description="Groq API key"
    )
    groq_base_url: str = Field(
        default="https://api.groq.com", description="Groq API base URL"
    )
    groq_model_default: str = Field(
        default="llama3.1-8b-instant", description="Groq default model"
    )

    # ── Advisor prompt ────────────────────────────────────────────────
    advisor_include_current_description: bool = Field(
        default=True, description="Include current task description in advisor prompt"
    )
    advisor_include_subtask_descriptions: bool = Field(
        default=False, description="Include subtask descriptions in advisor prompt"
    )
    advisor_include_parent_description: bool = Field(
        default=False, description="Include parent description in advisor prompt"
    )

    # ── Model storage paths ───────────────────────────────────────────
    ollama_models_dir: Optional[str] = Field(
        default=None, description="Ollama models directory"
    )
    gguf_model_dir: str = Field(
        default="~/.cache/taskforge/models", description="GGUF models directory"
    )
    hf_home: Optional[str] = Field(default=None, description="HF_HOME path")
    transformers_cache: Optional[str] = Field(default=None)
    huggingface_hub_cache: Optional[str] = Field(default=None)

    # ── Paths ─────────────────────────────────────────────────────────
    output_dir: str = Field(default="out", description="Output directory")
    data_dir: str = Field(default="data", description="Data directory")

    # ── Logging ─────────────────────────────────────────────────────
    log_level: str = Field(default="INFO", description="Logging level")
    log_file: str = Field(default="logs/taskforge.log", description="Log file path")
    log_json: bool = Field(default=False, description="Output logs in JSON")

    # Use absolute env_file path so Pydantic-settings finds it regardless of CWD
    model_config = {
        "env_file": str(_env_path),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    # ── Derived helpers ───────────────────────────────────────────────

    @property
    def output_path(self) -> Path:
        p = Path(self.output_dir)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def snapshots_path(self) -> Path:
        p = self.data_path / "snapshots"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def sqlite_path(self) -> Path:
        return self.data_path / "jira.sqlite"

    @property
    def blocked_keywords(self) -> list[str]:
        return [k.strip().lower() for k in self.blocked_link_keywords.split(",") if k.strip()]

    @property
    def gguf_path(self) -> Path:
        return Path(os.path.expanduser(self.gguf_model_dir))

    @property
    def ollama_models_path(self) -> Path | None:
        if self.ollama_models_dir:
            return Path(os.path.expanduser(self.ollama_models_dir))
        default = Path.home() / ".ollama" / "models"
        return default if default.exists() else None

    def get_model(self, tier: str = "default") -> str:
        """Return model name for the given tier."""
        mapping = {
            "default": self.get_effective_default_model(),
            "fast": self.ai_model_fast,
            "reason": self.ai_model_reason,
            "heavy": self.ai_model_heavy,
        }
        return mapping.get(tier, self.ai_model_default)

    def parse_ai_models(self) -> list[dict[str, str | int | bool]]:
        """Parse AI_MODELS into a list of model descriptors.

        Format: "model=3,other:thing=1,*default=2"
        Use trailing "*" on model name to mark default.
        """
        raw = (self.ai_models or "").strip()
        if not raw:
            return []

        items: list[dict[str, str | int | bool]] = []
        for part in raw.split(","):
            entry = part.strip()
            if not entry:
                continue
            name = entry
            strength: int | None = None

            if "=" in entry:
                name_part, strength_part = entry.rsplit("=", 1)
                name = name_part.strip()
                try:
                    strength = int(strength_part.strip())
                except ValueError:
                    strength = None

            is_default = name.endswith("*")
            if is_default:
                name = name[:-1].strip()

            provider = "local"
            if "@" in name:
                name_part, provider_part = name.split("@", 1)
                name = name_part.strip()
                provider = provider_part.strip().lower() or "local"
                if provider not in ("local", "groq"):
                    provider = "local"

            if not name:
                continue

            items.append({
                "name": name,
                "strength": strength if strength is not None else 0,
                "default": is_default,
                "provider": provider,
            })

        return items

    def get_effective_default_model(self) -> str:
        """Resolve the effective default model.

        Priority:
        1) AI_MODEL_DEFAULT (unless set to 'auto')
        2) AI_MODELS entry marked with '*'
        3) Strongest AI_MODELS entry
        4) Fallback to ai_model_default
        """
        if self.ai_model_default and self.ai_model_default.lower() != "auto":
            return self.ai_model_default

        models = self.parse_ai_models()
        for m in models:
            if m.get("default"):
                return str(m["name"])

        if models:
            models_sorted = sorted(models, key=lambda x: int(x.get("strength", 0)), reverse=True)
            return str(models_sorted[0]["name"])

        return self.ai_model_default

    def validate_jira_config(self) -> list[str]:
        """Validate that required Jira settings are present.

        Returns a list of error messages (empty = valid).
        """
        errors: list[str] = []
        if not self.jira_base_url:
            errors.append("JIRA_BASE_URL is not set. Add it to your .env file.")
        if not self.jira_api_token:
            errors.append("JIRA_API_TOKEN is not set. Add it to your .env file.")
        if self.jira_auth_mode == "cloud" and not self.jira_email:
            errors.append(
                "JIRA_EMAIL is required for cloud auth mode. Add it to your .env file."
            )
        if self.jira_auth_mode not in ("cloud", "server"):
            errors.append(
                f"JIRA_AUTH_MODE must be 'cloud' or 'server', got: {self.jira_auth_mode!r}"
            )
        return errors

    def as_display_dict(self) -> dict[str, str]:
        """Return a sanitized dict of all config values for display."""
        token = self.jira_api_token
        masked_token = f"{'*' * 8}...{token[-4:]}" if len(token) > 4 else ("***" if token else "(not set)")
        return {
            "JIRA_BASE_URL": self.jira_base_url or "(not set)",
            "JIRA_AUTH_MODE": self.jira_auth_mode,
            "JIRA_EMAIL": self.jira_email or "(not set)",
            "JIRA_API_TOKEN": masked_token,
            "JIRA_JQL": self.jira_jql,
            "JIRA_TIMEOUT": str(self.jira_timeout),
            "JIRA_MAX_RETRIES": str(self.jira_max_retries),
            "BLOCKED_LINK_KEYWORDS": self.blocked_link_keywords,
            "BLOCKED_FLAG_FIELD": self.blocked_flag_field or "(not set)",
            "AI_PROVIDER": self.ai_provider,
            "OLLAMA_HOST": self.ollama_host,
            "AI_MODEL_DEFAULT": self.ai_model_default,
            "AI_MODEL_FAST": self.ai_model_fast,
            "AI_MODEL_REASON": self.ai_model_reason,
            "AI_MODEL_HEAVY": self.ai_model_heavy,
            "AI_MODELS": self.ai_models or "(not set)",
            "AI_MODEL_DEFAULT_EFFECTIVE": self.get_effective_default_model(),
            "AI_SKIP_LOCAL": str(self.ai_skip_local),
            "GROQ_API_KEY": "***" if self.groq_api_key else "(not set)",
            "GROQ_BASE_URL": self.groq_base_url,
            "GROQ_MODEL_DEFAULT": self.groq_model_default,
            "ADVISOR_INCLUDE_CURRENT_DESCRIPTION": str(self.advisor_include_current_description),
            "ADVISOR_INCLUDE_SUBTASK_DESCRIPTIONS": str(self.advisor_include_subtask_descriptions),
            "ADVISOR_INCLUDE_PARENT_DESCRIPTION": str(self.advisor_include_parent_description),
            "GGUF_MODEL_DIR": self.gguf_model_dir,
            "OUTPUT_DIR": str(self.output_path),
            "DATA_DIR": str(self.data_path),
            "LOG_LEVEL": self.log_level,
            "LOG_FILE": self.log_file,
            "LOG_JSON": str(self.log_json),
        }


# ── Singleton accessor ────────────────────────────────────────────────

_settings_instance: Settings | None = None


def get_settings() -> Settings:
    """Return a cached Settings instance."""
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = Settings()
    return _settings_instance


def reset_settings() -> None:
    """Invalidate the cached Settings so the next call to get_settings() reloads."""
    global _settings_instance
    _settings_instance = None
