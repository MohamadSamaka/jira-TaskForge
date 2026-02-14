"""AI API routes — status, models, ask, today, next, set-model."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)


class AskRequest(BaseModel):
    question: str
    model: str | None = None
    skip_local: bool | None = None


class SetModelRequest(BaseModel):
    name: str
    tier: str = "default"


class ModelRequest(BaseModel):
    model: str | None = None
    skip_local: bool | None = None


def _get_provider():
    """Get AI provider with error handling."""
    from taskforge.ai import get_provider
    from taskforge.config import get_settings
    settings = get_settings()
    try:
        return get_provider(settings.ai_provider)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI provider unavailable: {exc}")


@router.get("/ai/status")
async def ai_status():
    """Get AI provider status."""
    from taskforge.config import get_settings
    from taskforge.ai.doctor import _estimate_model_memory

    settings = get_settings()
    configured_models = settings.parse_ai_models()
    result = {
        "provider": settings.ai_provider,
        "model": settings.get_effective_default_model(),
        "memory_estimate": _estimate_model_memory(settings.get_effective_default_model()),
        "ollama_host": settings.ollama_host,
        "groq_base_url": settings.groq_base_url,
        "groq_configured": bool(settings.groq_api_key),
        "groq_status": {"ok": False, "detail": "GROQ_API_KEY not set"},
        "skip_local": settings.ai_skip_local,
        "models": {
            "default": settings.get_effective_default_model(),
            "fast": settings.ai_model_fast,
            "reason": settings.ai_model_reason,
            "heavy": settings.ai_model_heavy,
        },
        "models_configured": configured_models,
        "available": False,
        "detail": "",
    }

    try:
        from taskforge.ai import get_provider
        provider = get_provider(settings.ai_provider)
        health = provider.health_check()
        result["available"] = health.get("ok", False)
        result["detail"] = health.get("detail", "")
        if health.get("models_count"):
            result["models_count"] = health["models_count"]
    except Exception as exc:
        result["detail"] = str(exc)

    if settings.groq_api_key:
        try:
            from taskforge.ai.groq import GroqProvider
            result["groq_status"] = GroqProvider().health_check()
        except Exception as exc:
            result["groq_status"] = {"ok": False, "detail": str(exc)}

    return result


@router.get("/ai/models")
async def list_models():
    """List available AI models."""
    from taskforge.config import get_settings
    settings = get_settings()
    configured = settings.parse_ai_models()
    configured_by_name = {m["name"]: m for m in configured}
    errors: list[str] = []

    provider = _get_provider()
    try:
        models = provider.list_models()
    except Exception as exc:
        errors.append(f"local provider: {exc}")
        models = []

    merged: list[dict] = []

    # Merge configured strength/default into local provider models
    for m in models:
        name = m.get("name")
        if name in configured_by_name:
            m = {**m, **configured_by_name[name], "source": "config+provider"}
            configured_by_name.pop(name, None)
        else:
            m = {**m, "source": "provider", "provider": "local"}
        merged.append(m)

    # Optionally include Groq models if configured
    if settings.groq_api_key:
        try:
            from taskforge.ai.groq import GroqProvider
            groq_models = GroqProvider().list_models()
            for m in groq_models:
                name = m.get("name")
                if name in configured_by_name:
                    m = {**m, **configured_by_name[name], "source": "config+groq"}
                    configured_by_name.pop(name, None)
                else:
                    m = {**m, "source": "groq", "provider": "groq"}
                merged.append(m)
        except Exception as exc:
            errors.append(f"groq: {exc}")

    # Add any configured-only models (useful if provider is down)
    for name, meta in configured_by_name.items():
        merged.append({"name": name, **meta, "source": "config"})

    # Sort by strength (desc) then name
    merged.sort(key=lambda x: (int(x.get("strength", 0)), x.get("name", "")), reverse=True)
    if errors:
        return {"models": merged, "errors": errors}
    return {"models": merged}


@router.post("/ai/set-model")
async def set_model(req: SetModelRequest):
    """Set the active AI model."""
    from taskforge.config import PROJECT_ROOT, reset_settings

    key_map = {
        "default": "AI_MODEL_DEFAULT",
        "fast": "AI_MODEL_FAST",
        "reason": "AI_MODEL_REASON",
        "heavy": "AI_MODEL_HEAVY",
    }
    env_key = key_map.get(req.tier)
    if not env_key:
        raise HTTPException(400, f"Unknown tier: {req.tier}")

    env_file = PROJECT_ROOT / ".env"
    lines = []
    found = False
    if env_file.exists():
        lines = env_file.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if line.startswith(f"{env_key}=") or line.startswith(f"# {env_key}="):
                lines[i] = f"{env_key}={req.name}"
                found = True
                break
    if not found:
        lines.append(f"{env_key}={req.name}")

    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    reset_settings()
    return {"ok": True, "key": env_key, "value": req.name}


@router.post("/ai/ask")
async def ai_ask(req: AskRequest):
    """Ask a question grounded in task data."""
    from taskforge.storage import load_latest_issues
    from taskforge.ai.prompts import build_ask_prompt

    issues = load_latest_issues()
    if not issues:
        raise HTTPException(400, "No synced issues. Run sync first.")

    prompt, context = build_ask_prompt(issues, req.question)
    provider = _get_provider()
    try:
        from taskforge.ai.router import generate_with_fallback, GroqAuthError, GroqRequestError
        response, provider_used, _ = generate_with_fallback(
            prompt,
            context,
            model=req.model,
            entrypoint="api.ai.ask",
            skip_local=req.skip_local,
        )
        return {"response": response, "question": req.question, "provider": provider_used}
    except GroqAuthError as exc:
        raise HTTPException(status_code=401, detail=f"Groq authentication failed. {exc} Update GROQ_API_KEY and restart.")
    except GroqRequestError as exc:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {exc}")
    except Exception as exc:
        raise HTTPException(500, f"AI generation failed: {exc}")


@router.post("/ai/today")
async def ai_today(req: ModelRequest | None = None):
    """AI summary of today's tasks."""
    from taskforge.storage import load_latest_issues
    from taskforge.ai.prompts import build_today_prompt

    issues = load_latest_issues()
    if not issues:
        raise HTTPException(400, "No synced issues. Run sync first.")

    prompt, context = build_today_prompt(issues)
    provider = _get_provider()
    try:
        from taskforge.ai.router import generate_with_fallback, GroqAuthError, GroqRequestError
        model = req.model if req else None
        skip_local = req.skip_local if req else None
        response, provider_used, _ = generate_with_fallback(
            prompt,
            context,
            model=model,
            entrypoint="api.ai.today",
            skip_local=skip_local,
        )
        return {"response": response, "provider": provider_used}
    except GroqAuthError as exc:
        raise HTTPException(status_code=401, detail=f"Groq authentication failed. {exc} Update GROQ_API_KEY and restart.")
    except GroqRequestError as exc:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {exc}")
    except Exception as exc:
        raise HTTPException(500, f"AI generation failed: {exc}")


@router.post("/ai/next")
async def ai_next(req: ModelRequest | None = None):
    """AI recommendation for what to work on next."""
    from taskforge.storage import load_latest_issues
    from taskforge.queries import rank_next
    from taskforge.ai.prompts import build_next_prompt

    issues = load_latest_issues()
    if not issues:
        raise HTTPException(400, "No synced issues. Run sync first.")

    ranked = rank_next(issues, top=10)
    prompt, context = build_next_prompt(issues, ranked)
    provider = _get_provider()
    try:
        from taskforge.ai.router import generate_with_fallback, GroqAuthError, GroqRequestError
        model = req.model if req else None
        skip_local = req.skip_local if req else None
        response, provider_used, _ = generate_with_fallback(
            prompt,
            context,
            model=model,
            entrypoint="api.ai.next",
            skip_local=skip_local,
        )
        return {"response": response, "provider": provider_used}
    except GroqAuthError as exc:
        raise HTTPException(status_code=401, detail=f"Groq authentication failed. {exc} Update GROQ_API_KEY and restart.")
    except GroqRequestError as exc:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {exc}")
    except Exception as exc:
        raise HTTPException(500, f"AI generation failed: {exc}")
