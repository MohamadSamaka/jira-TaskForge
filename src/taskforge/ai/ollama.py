"""Ollama AI provider — local LLM via Ollama HTTP API."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from taskforge.ai.base import AIProvider
from taskforge.config import get_settings

logger = logging.getLogger(__name__)


class OllamaProvider(AIProvider):
    """Ollama local LLM provider using the HTTP API."""

    def __init__(self, host: str | None = None, default_model: str | None = None, **kwargs) -> None:
        settings = get_settings()
        self.host = (host or settings.ollama_host).rstrip("/")
        self.default_model = default_model or settings.get_model("default")
        self.timeout = httpx.Timeout(120.0, connect=10.0)

    def generate(self, prompt: str, context: str = "", model: str | None = None) -> str:
        """Generate a response using Ollama's /api/generate endpoint."""
        model_name = model or self.default_model

        full_prompt = prompt
        if context:
            full_prompt = (
                "You are a helpful task assistant. Use ONLY the following task data "
                "to answer. Do NOT invent or hallucinate any information. If the data "
                "does not contain the answer, say so.\n\n"
                f"=== TASK DATA ===\n{context}\n=== END DATA ===\n\n"
                f"Question: {prompt}"
            )

        payload = {
            "model": model_name,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": 1024,
            },
        }

        try:
            resp = httpx.post(
                f"{self.host}/api/generate",
                json=payload,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "").strip()
        except httpx.ConnectError:
            return (
                "⚠️  Cannot connect to Ollama. Is it running?\n"
                f"   Expected at: {self.host}\n"
                "   Start it with: ollama serve"
            )
        except httpx.HTTPStatusError as exc:
            return f"⚠️  Ollama error: HTTP {exc.response.status_code} — {exc.response.text[:200]}"
        except Exception as exc:
            return f"⚠️  Ollama error: {exc}"

    def list_models(self) -> list[dict[str, Any]]:
        """List locally available Ollama models."""
        try:
            resp = httpx.get(f"{self.host}/api/tags", timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            models = data.get("models", [])
            return [
                {
                    "name": m.get("name", ""),
                    "size": m.get("size", 0),
                    "modified": m.get("modified_at", ""),
                    "digest": m.get("digest", "")[:12],
                    "family": m.get("details", {}).get("family", ""),
                    "parameter_size": m.get("details", {}).get("parameter_size", ""),
                    "quantization": m.get("details", {}).get("quantization_level", ""),
                }
                for m in models
            ]
        except httpx.ConnectError:
            logger.warning("Cannot connect to Ollama at %s", self.host)
            return []
        except Exception as exc:
            logger.warning("Error listing Ollama models: %s", exc)
            return []

    def health_check(self) -> dict[str, Any]:
        """Check if Ollama is reachable and responding."""
        try:
            resp = httpx.get(f"{self.host}/api/tags", timeout=httpx.Timeout(5.0))
            resp.raise_for_status()
            models = resp.json().get("models", [])
            return {
                "ok": True,
                "detail": f"Ollama reachable at {self.host}",
                "models_count": len(models),
                "host": self.host,
            }
        except httpx.ConnectError:
            return {
                "ok": False,
                "detail": f"Cannot connect to Ollama at {self.host}",
                "host": self.host,
            }
        except Exception as exc:
            return {"ok": False, "detail": str(exc), "host": self.host}

    def get_model_info(self, model: str) -> dict[str, Any]:
        """Get info about a specific Ollama model."""
        try:
            resp = httpx.post(
                f"{self.host}/api/show",
                json={"name": model},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            return {"error": str(exc)}
