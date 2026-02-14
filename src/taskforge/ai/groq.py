"""Groq AI provider using the official Groq SDK."""

from __future__ import annotations

import logging
from typing import Any

import groq
import httpx
from groq import Groq

from taskforge.ai.base import AIProvider
from taskforge.config import get_settings

logger = logging.getLogger(__name__)


class GroqProvider(AIProvider):
    """Groq provider using the official Groq SDK."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str | None = None,
        **kwargs,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.groq_api_key
        resolved_base_url = (base_url or settings.groq_base_url).rstrip("/")
        if resolved_base_url.endswith("/openai/v1"):
            resolved_base_url = resolved_base_url[: -len("/openai/v1")]
        self.base_url = resolved_base_url
        self.default_model = default_model or settings.groq_model_default
        self.timeout = httpx.Timeout(120.0, connect=10.0)

        self.client: Groq | None = None
        if self.api_key:
            client_kwargs: dict[str, Any] = {
                "api_key": self.api_key,
                "timeout": self.timeout,
            }
            if self.base_url:
                client_kwargs["base_url"] = self.base_url
            self.client = Groq(**client_kwargs)

    def generate(self, prompt: str, context: str = "", model: str | None = None) -> str:
        model_name = model or self.default_model
        if not self.api_key or self.client is None:
            return "Groq API key not configured. Set GROQ_API_KEY."

        full_prompt = prompt
        if context:
            full_prompt = (
                "You are a helpful task assistant. Use ONLY the following task data "
                "to answer. Do NOT invent or hallucinate any information. If the data "
                "does not contain the answer, say so.\n\n"
                f"=== TASK DATA ===\n{context}\n=== END DATA ===\n\n"
                f"Question: {prompt}"
            )

        try:
            completion = self.client.chat.completions.create(
                messages=[{"role": "user", "content": full_prompt}],
                model=model_name,
                temperature=0.2,
            )
            if completion.choices:
                message = completion.choices[0].message
                return (message.content or "").strip()
            return ""
        except groq.APIStatusError as exc:
            detail = ""
            response = getattr(exc, "response", None)
            if response is not None:
                detail = getattr(response, "text", "") or getattr(response, "content", b"")
                if isinstance(detail, bytes):
                    detail = detail.decode("utf-8", errors="ignore")
                detail = detail.strip()
            detail_snip = detail[:200].strip()
            if exc.status_code in (401, 403) or "invalid_api_key" in detail.lower():
                return f"Groq auth error: {detail_snip}".strip()
            return f"Groq error: HTTP {exc.status_code} {detail_snip}".strip()
        except groq.APIConnectionError as exc:
            return f"Groq connection error: {exc}"
        except groq.APIError as exc:
            return f"Groq error: {exc}"
        except Exception as exc:
            return f"Groq error: {exc}"

    def list_models(self) -> list[dict[str, Any]]:
        if not self.api_key or self.client is None:
            return []
        try:
            result = self.client.models.list()
            models = getattr(result, "data", result) or []
            items: list[dict[str, Any]] = []
            for model in models:
                items.append({
                    "name": getattr(model, "id", ""),
                    "created": getattr(model, "created", ""),
                    "owned_by": getattr(model, "owned_by", ""),
                })
            return items
        except groq.APIStatusError as exc:
            detail = ""
            response = getattr(exc, "response", None)
            if response is not None:
                detail = getattr(response, "text", "") or getattr(response, "content", b"")
                if isinstance(detail, bytes):
                    detail = detail.decode("utf-8", errors="ignore")
                detail = detail.strip()
            if exc.status_code in (401, 403) or "invalid_api_key" in detail.lower():
                raise RuntimeError("Groq authentication failed. Check GROQ_API_KEY.") from exc
            raise
        except Exception as exc:
            logger.warning("Error listing Groq models: %s", exc)
            raise

    def health_check(self) -> dict[str, Any]:
        if not self.api_key or self.client is None:
            return {"ok": False, "detail": "GROQ_API_KEY not set"}
        try:
            self.client.models.list()
            return {"ok": True, "detail": "Groq reachable", "host": self.base_url}
        except groq.APIStatusError as exc:
            detail = ""
            response = getattr(exc, "response", None)
            if response is not None:
                detail = getattr(response, "text", "") or getattr(response, "content", b"")
                if isinstance(detail, bytes):
                    detail = detail.decode("utf-8", errors="ignore")
                detail = detail.strip()
            if exc.status_code in (401, 403) or "invalid_api_key" in detail.lower():
                return {"ok": False, "detail": "Groq authentication failed (invalid/expired API key).", "host": self.base_url}
            return {"ok": False, "detail": f"Groq error: HTTP {exc.status_code} {detail[:120]}".strip(), "host": self.base_url}
        except Exception as exc:
            return {"ok": False, "detail": str(exc), "host": self.base_url}

    def get_model_info(self, model: str) -> dict[str, Any]:
        if not self.api_key or self.client is None:
            return {"error": "GROQ_API_KEY not set"}
        try:
            result = self.client.models.retrieve(model)
            if hasattr(result, "to_dict"):
                return result.to_dict()
            if hasattr(result, "model_dump"):
                return result.model_dump()
            return dict(result)
        except Exception as exc:
            return {"error": str(exc)}
