"""TaskForge AI layer — pluggable local AI providers."""

from taskforge.ai.base import AIProvider
from taskforge.ai.ollama import OllamaProvider
from taskforge.ai.huggingface import HuggingFaceProvider
from taskforge.ai.groq import GroqProvider


def get_provider(provider_name: str = "ollama", **kwargs) -> AIProvider:
    """Factory to get the configured AI provider."""
    providers = {
        "ollama": OllamaProvider,
        "huggingface": HuggingFaceProvider,
        "hf": HuggingFaceProvider,
        "groq": GroqProvider,
    }
    cls = providers.get(provider_name.lower())
    if cls is None:
        raise ValueError(
            f"Unknown AI provider: {provider_name!r}. "
            f"Available: {', '.join(providers.keys())}"
        )
    return cls(**kwargs)
