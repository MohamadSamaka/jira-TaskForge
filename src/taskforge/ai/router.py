"""Hybrid LLM router with validation and fallback."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable

from taskforge.ai import get_provider
from taskforge.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    ok: bool
    detail: str | None = None
    data: Any | None = None


class GroqAuthError(RuntimeError):
    """Groq auth error (invalid/expired API key)."""


class GroqRequestError(RuntimeError):
    """Groq request error (non-auth)."""


def validate_json_keys(text: str, required_keys: list[str]) -> ValidationResult:
    """Validate that text is JSON and contains required keys."""
    try:
        data = json.loads(text)
    except Exception as exc:
        return ValidationResult(ok=False, detail=f"Invalid JSON: {exc}")
    missing = [k for k in required_keys if k not in data]
    if missing:
        return ValidationResult(ok=False, detail=f"Missing keys: {missing}", data=data)
    return ValidationResult(ok=True, data=data)


def generate_with_fallback(
    prompt: str,
    context: str = "",
    model: str | None = None,
    validator: Callable[[str], ValidationResult] | None = None,
    entrypoint: str = "unknown",
    skip_local: bool | None = None,
    force_groq: bool = False,
) -> tuple[str, str, ValidationResult | None]:
    """Generate with local LLM, validate, and fallback to Groq if needed.

    Returns: (response_text, provider_used, validation_result)
    """
    settings = get_settings()
    use_groq = force_groq or (skip_local if skip_local is not None else settings.ai_skip_local)

    def _raise_if_groq_error(response: str) -> None:
        if not isinstance(response, str):
            return
        text = response.strip()
        lower = text.lower()
        if "groq api key not configured" in lower:
            raise GroqAuthError("Groq API key is missing. Set GROQ_API_KEY in .env.")
        if text.startswith("Groq auth error:") or "invalid_api_key" in lower:
            raise GroqAuthError("Groq authentication failed. Your GROQ_API_KEY may be expired or invalid.")
        if text.startswith("Groq error: HTTP 401") or text.startswith("Groq error: HTTP 403"):
            raise GroqAuthError("Groq authentication failed. Your GROQ_API_KEY may be expired or invalid.")
        if text.startswith("Groq error:"):
            raise GroqRequestError(text)

    def _normalize_model(provider_name: str, model_name: str | None) -> str | None:
        if not model_name:
            return None
        models = settings.parse_ai_models()
        meta = next((m for m in models if m.get("name") == model_name), None)
        if meta and meta.get("provider") and meta.get("provider") != provider_name:
            return None
        if provider_name == "groq":
            # Heuristic: local models usually include ":" (e.g., ollama/gguf names)
            if ":" in model_name and (meta is None or meta.get("provider") != "groq"):
                return None
        return model_name

    def _call(provider_name: str) -> str:
        provider = get_provider(provider_name)
        selected_model = _normalize_model(provider_name, model)
        return provider.generate(prompt, context, model=selected_model)

    # Direct Groq
    if use_groq:
        response = _call("groq")
        _raise_if_groq_error(response)
        validation = validator(response) if validator else None
        return response, "groq", validation

    # Try local first
    local_provider_name = settings.ai_provider
    response = _call(local_provider_name)
    validation = validator(response) if validator else None

    if validator and not validation.ok:
        logger.warning(
            "LLM validation failed; falling back to Groq. entrypoint=%s provider=%s detail=%s",
            entrypoint, local_provider_name, validation.detail
        )
        response = _call("groq")
        _raise_if_groq_error(response)
        validation = validator(response)
        return response, "groq", validation

    return response, local_provider_name, validation
