"""Hugging Face / llama.cpp GGUF provider — local inference without Ollama."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from taskforge.ai.base import AIProvider
from taskforge.config import get_settings

logger = logging.getLogger(__name__)

# Try to import llama_cpp; it's an optional dependency
_LLAMA_CPP_AVAILABLE = False
try:
    from llama_cpp import Llama  # type: ignore[import-untyped]
    _LLAMA_CPP_AVAILABLE = True
except ImportError:
    pass


class HuggingFaceProvider(AIProvider):
    """Local GGUF model provider via llama-cpp-python.

    Supports loading GGUF models from a configurable directory.
    Falls back gracefully if llama-cpp-python is not installed.
    """

    def __init__(
        self,
        model_dir: str | None = None,
        default_model: str | None = None,
        n_ctx: int = 2048,
        n_gpu_layers: int = 0,
        **kwargs,
    ) -> None:
        settings = get_settings()
        self.model_dir = Path(
            os.path.expanduser(model_dir or settings.gguf_model_dir)
        )
        self.default_model = default_model or settings.get_model("default")
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self._loaded: dict[str, Any] = {}  # cache loaded models

    def _get_model_path(self, model_name: str) -> Path | None:
        """Resolve model name to a .gguf file path."""
        # Direct path
        direct = Path(model_name)
        if direct.exists() and direct.suffix == ".gguf":
            return direct

        # Search in model_dir
        if self.model_dir.exists():
            # Exact match
            exact = self.model_dir / model_name
            if exact.exists():
                return exact
            # With extension
            with_ext = self.model_dir / f"{model_name}.gguf"
            if with_ext.exists():
                return with_ext
            # Glob partial match
            matches = list(self.model_dir.glob(f"*{model_name}*.gguf"))
            if matches:
                return matches[0]

        return None

    def _load_model(self, model_name: str) -> Any:
        """Load a GGUF model (cached)."""
        if not _LLAMA_CPP_AVAILABLE:
            raise RuntimeError(
                "llama-cpp-python is not installed. Install with:\n"
                "  pip install llama-cpp-python\n"
                "Or for GPU support:\n"
                "  CMAKE_ARGS='-DLLAMA_CUBLAS=on' pip install llama-cpp-python"
            )

        if model_name in self._loaded:
            return self._loaded[model_name]

        model_path = self._get_model_path(model_name)
        if model_path is None:
            raise FileNotFoundError(
                f"GGUF model not found: {model_name}\n"
                f"Searched in: {self.model_dir}\n"
                "Download a .gguf model file and place it there."
            )

        logger.info("Loading GGUF model: %s", model_path)
        llm = Llama(
            model_path=str(model_path),
            n_ctx=self.n_ctx,
            n_gpu_layers=self.n_gpu_layers,
            verbose=False,
        )
        self._loaded[model_name] = llm
        return llm

    def generate(self, prompt: str, context: str = "", model: str | None = None) -> str:
        """Generate a response using a local GGUF model."""
        model_name = model or self.default_model

        full_prompt = prompt
        if context:
            full_prompt = (
                "You are a helpful task assistant. Use ONLY the following task data "
                "to answer. Do NOT invent or hallucinate any information.\n\n"
                f"=== TASK DATA ===\n{context}\n=== END DATA ===\n\n"
                f"Question: {prompt}"
            )

        try:
            llm = self._load_model(model_name)
            output = llm(
                full_prompt,
                max_tokens=1024,
                temperature=0.3,
                top_p=0.9,
                echo=False,
            )
            choices = output.get("choices", [])
            if choices:
                return choices[0].get("text", "").strip()
            return ""
        except RuntimeError as exc:
            return f"⚠️  HuggingFace/GGUF error: {exc}"
        except FileNotFoundError as exc:
            return f"⚠️  {exc}"
        except Exception as exc:
            return f"⚠️  HuggingFace/GGUF error: {exc}"

    def list_models(self) -> list[dict[str, Any]]:
        """List GGUF model files in the model directory."""
        if not self.model_dir.exists():
            return []

        models: list[dict[str, Any]] = []
        for path in sorted(self.model_dir.glob("*.gguf")):
            stat = path.stat()
            models.append(
                {
                    "name": path.stem,
                    "path": str(path),
                    "size": stat.st_size,
                    "size_gb": round(stat.st_size / (1024**3), 2),
                }
            )
        return models

    def health_check(self) -> dict[str, Any]:
        """Check if llama-cpp-python is available and models exist."""
        result: dict[str, Any] = {
            "ok": _LLAMA_CPP_AVAILABLE,
            "llama_cpp_installed": _LLAMA_CPP_AVAILABLE,
            "model_dir": str(self.model_dir),
            "model_dir_exists": self.model_dir.exists(),
        }

        if self.model_dir.exists():
            gguf_files = list(self.model_dir.glob("*.gguf"))
            result["models_found"] = len(gguf_files)
            result["model_files"] = [f.name for f in gguf_files]
        else:
            result["models_found"] = 0

        if _LLAMA_CPP_AVAILABLE:
            result["detail"] = "llama-cpp-python is available"
        else:
            result["detail"] = (
                "llama-cpp-python is NOT installed. "
                "Install with: pip install llama-cpp-python"
            )

        return result

    def get_model_info(self, model: str) -> dict[str, Any]:
        """Get info about a specific GGUF model file."""
        path = self._get_model_path(model)
        if path is None:
            return {"error": f"Model not found: {model}"}

        stat = path.stat()
        return {
            "name": path.stem,
            "path": str(path),
            "size": stat.st_size,
            "size_gb": round(stat.st_size / (1024**3), 2),
        }
