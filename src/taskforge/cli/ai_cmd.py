"""CLI AI commands — models list, set-model, today, next, ask, doctor, status."""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

ai_app = typer.Typer(help="Local AI assistant commands")
console = Console()


def _get_provider():
    """Get the configured AI provider, with graceful error handling."""
    from taskforge.ai import get_provider
    from taskforge.config import get_settings

    settings = get_settings()
    try:
        return get_provider(settings.ai_provider)
    except Exception as exc:
        console.print(f"[bold red]AI provider error:[/bold red] {exc}")
        console.print("[yellow]AI features are unavailable. Other commands still work.[/yellow]")
        raise typer.Exit(1)


def _load_issues() -> list:
    from taskforge.storage import load_latest_issues

    issues = load_latest_issues()
    if not issues:
        console.print("[yellow]No synced issues. Run 'jira-assist sync' first.[/yellow]")
        raise typer.Exit(1)
    return issues


# ── models ────────────────────────────────────────────────────────────

models_app = typer.Typer(help="Manage AI models")
ai_app.add_typer(models_app, name="models")


@models_app.command(name="list")
def models_list() -> None:
    """List available AI models."""
    provider = _get_provider()
    try:
        models = provider.list_models()
    except Exception as exc:
        console.print(f"[red]Failed to list models:[/red] {exc}")
        return

    if not models:
        console.print("[yellow]No models found. Is the AI provider running?[/yellow]")
        return

    table = Table(title="Available Models", show_lines=True, header_style="bold cyan")
    table.add_column("Name", style="bold yellow")
    table.add_column("Size", justify="right")
    table.add_column("Family")
    table.add_column("Quantization")

    for m in models:
        size = m.get("size", 0)
        if size:
            size_str = f"{size / (1024**3):.1f} GB"
        elif m.get("size_gb"):
            size_str = f"{m['size_gb']} GB"
        else:
            size_str = "?"

        table.add_row(
            m.get("name", "?"),
            size_str,
            m.get("family", m.get("path", "")),
            m.get("quantization", ""),
        )

    console.print(table)


# ── set-model ─────────────────────────────────────────────────────────

@ai_app.command(name="set-model")
def set_model(
    name: str = typer.Argument(help="Model name to set as default"),
    tier: str = typer.Option("default", "--tier", "-t", help="Model tier: default, fast, reason, heavy"),
) -> None:
    """Set the active AI model (updates .env)."""
    from taskforge.config import PROJECT_ROOT, reset_settings

    env_file = PROJECT_ROOT / ".env"
    key_map = {
        "default": "AI_MODEL_DEFAULT",
        "fast": "AI_MODEL_FAST",
        "reason": "AI_MODEL_REASON",
        "heavy": "AI_MODEL_HEAVY",
    }
    env_key = key_map.get(tier)
    if not env_key:
        console.print(f"[red]Unknown tier: {tier}. Use: default, fast, reason, heavy[/red]")
        raise typer.Exit(1)

    # Read, update, write .env
    lines: list[str] = []
    found = False
    if env_file.exists():
        lines = env_file.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if line.startswith(f"{env_key}=") or line.startswith(f"# {env_key}="):
                lines[i] = f"{env_key}={name}"
                found = True
                break

    if not found:
        lines.append(f"{env_key}={name}")

    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Invalidate cached settings so next access picks up the change
    reset_settings()

    console.print(f"Set {env_key}={name} in .env")


# ── AI task commands ──────────────────────────────────────────────────

@ai_app.command()
def today(
    model: str = typer.Option(None, "--model", "-m", help="Override model for this run"),
    skip_local: bool = typer.Option(False, "--skip-local", help="Skip local LLM and use Groq"),
) -> None:
    """AI summary of today's tasks."""
    from taskforge.ai.prompts import build_today_prompt

    issues = _load_issues()
    prompt, context = build_today_prompt(issues)

    console.print("Generating today's summary...\n")
    try:
        from taskforge.ai.router import generate_with_fallback
        response, provider_used, _ = generate_with_fallback(
            prompt,
            context,
            model=model,
            entrypoint="cli.ai.today",
            skip_local=skip_local,
        )
        console.print(Panel(response, title=f"Today's Summary ({provider_used})", style="cyan"))
    except Exception as exc:
        console.print(f"[red]AI generation failed:[/red] {exc}")
        console.print("[yellow]Try checking 'jira-assist ai status' for diagnostics.[/yellow]")


@ai_app.command(name="next")
def ai_next(
    model: str = typer.Option(None, "--model", "-m", help="Override model for this run"),
    skip_local: bool = typer.Option(False, "--skip-local", help="Skip local LLM and use Groq"),
) -> None:
    """AI recommendation for what to work on next."""
    from taskforge.queries import rank_next
    from taskforge.ai.prompts import build_next_prompt

    issues = _load_issues()
    ranked = rank_next(issues, top=10)

    prompt, context = build_next_prompt(issues, ranked)

    console.print("Generating recommendations...\n")
    try:
        from taskforge.ai.router import generate_with_fallback
        response, provider_used, _ = generate_with_fallback(
            prompt,
            context,
            model=model,
            entrypoint="cli.ai.next",
            skip_local=skip_local,
        )
        console.print(Panel(response, title=f"Next Steps ({provider_used})", style="green"))
    except Exception as exc:
        console.print(f"[red]AI generation failed:[/red] {exc}")
        console.print("[yellow]Try checking 'jira-assist ai status' for diagnostics.[/yellow]")


@ai_app.command()
def ask(
    question: str = typer.Argument(help="Question to ask about your tasks"),
    model: str = typer.Option(None, "--model", "-m", help="Override model for this run"),
    skip_local: bool = typer.Option(False, "--skip-local", help="Skip local LLM and use Groq"),
) -> None:
    """Ask a free-form question about your tasks."""
    from taskforge.ai.prompts import build_ask_prompt

    issues = _load_issues()
    prompt, context = build_ask_prompt(issues, question)

    console.print("Thinking...\n")
    try:
        from taskforge.ai.router import generate_with_fallback
        response, provider_used, _ = generate_with_fallback(
            prompt,
            context,
            model=model,
            entrypoint="cli.ai.ask",
            skip_local=skip_local,
        )
        console.print(Panel(response, title=f"Answer ({provider_used})", style="cyan"))
    except Exception as exc:
        console.print(f"[red]AI generation failed:[/red] {exc}")
        console.print("[yellow]Try checking 'jira-assist ai status' for diagnostics.[/yellow]")


# ── status ──────────────────────────────────────────────────────────

@ai_app.command()
def status() -> None:
    """Show AI provider status — provider, model, availability, memory estimate."""
    from taskforge.config import get_settings
    from taskforge.ai.doctor import _estimate_model_memory

    settings = get_settings()

    table = Table(title="AI Status", show_lines=True, header_style="bold cyan")
    table.add_column("Property", style="bold yellow")
    table.add_column("Value")

    table.add_row("Provider", settings.ai_provider)
    table.add_row("Default Model", settings.get_effective_default_model())
    table.add_row("Memory Estimate", _estimate_model_memory(settings.get_effective_default_model()))
    table.add_row("Ollama Host", settings.ollama_host)

    # Check provider health
    try:
        from taskforge.ai import get_provider
        provider = get_provider(settings.ai_provider)
        health = provider.health_check()
        if health.get("ok"):
            table.add_row("Status", "[green]Available[/green]")
            if health.get("models_count"):
                table.add_row("Models Available", str(health["models_count"]))
        else:
            table.add_row("Status", f"[red]Unavailable[/red] — {health.get('detail', 'unknown')}")
    except Exception as exc:
        table.add_row("Status", f"[red]Error[/red] — {exc}")

    console.print(table)


@ai_app.command(name="doctor")
def ai_doctor_cmd() -> None:
    """Run AI diagnostics — check provider, models, hardware."""
    from taskforge.ai.doctor import run_doctor

    try:
        run_doctor(console)
    except Exception as exc:
        console.print(f"[red]AI doctor failed:[/red] {exc}")
