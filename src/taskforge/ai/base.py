"""Abstract base for AI providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AIProvider(ABC):
    """Base class for pluggable AI providers."""

    @abstractmethod
    def generate(self, prompt: str, context: str = "", model: str | None = None) -> str:
        """Generate a response for the given prompt + context.

        Args:
            prompt: The user question / instruction.
            context: Task data context (JSON/text) to ground the response.
            model: Override model name. If None, use provider default.

        Returns:
            Generated text response.
        """

    @abstractmethod
    def list_models(self) -> list[dict[str, Any]]:
        """List available models from this provider."""

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Check provider health. Returns {ok: bool, detail: str, ...}."""

    @abstractmethod
    def get_model_info(self, model: str) -> dict[str, Any]:
        """Get info about a specific model."""
