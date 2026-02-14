"""Main CLI commands — init, auth-test, sync, render, doctor, config show, gui."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from taskforge.cli.query import query_app
from taskforge.cli.ai_cmd import ai_app

app = typer.Typer(
    name="jira-assist",
    help="TaskForge — Local-first Jira assistant with deterministic queries and local AI.",
    add_completion=False,
    rich_markup_mode="rich",
)
app.add_typer(query_app, name="query", help="Deterministic queries on synced issues")
app.add_typer(ai_app, name="ai", help="Local AI assistant commands")

console = Console()


def _setup_logging(verbose: bool = False) -> None:
    from taskforge.config import get_settings
    from taskforge.logging_config import configure_logging

    settings = get_settings()
    level = "DEBUG" if verbose else settings.log_level
    configure_logging(level=level, log_file=settings.log_file, json_format=settings.log_json)


@app.callback()
def main(
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging"),
) -> None:
    """TaskForge CLI root."""
    _setup_logging(verbose)


# ── init ──────────────────────────────────────────────────────────────

@app.command()
def init() -> None:
    """Initialize TaskForge project structure and .env file."""
    import shutil
    from taskforge.config import PROJECT_ROOT

    # Use Path objects — cross-platform safe (no hardcoded '/')
    dirs = [
        Path("out"),
        Path("data"),
        Path("data") / "snapshots",
        Path("docs"),
    ]
    for d in dirs:
        (PROJECT_ROOT / d).mkdir(parents=True, exist_ok=True)
        console.print(f"  📁 Created {d}")

    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        example = PROJECT_ROOT / ".env.example"
        if example.exists():
            shutil.copy2(example, env_file)
            console.print("  📝 Created .env from .env.example")
        else:
            env_file.touch()
            console.print("  📝 Created empty .env")
    else:
        console.print("  ✅ .env already exists")

    console.print(Panel(
        "✅ [bold green]TaskForge initialized![/bold green]\n\n"
        "Edit .env with your Jira credentials, then run:\n"
        "  jira-assist auth-test",
        style="green",
    ))


# ── auth-test ─────────────────────────────────────────────────────────

@app.command(name="auth-test")
def auth_test() -> None:
    """Test Jira authentication and display current user info."""
    from taskforge.jira_client import JiraClient, JiraClientError

    console.print("🔐 Testing Jira authentication...")

    try:
        with JiraClient() as client:
            user = client.test_auth()
            name = user.get("displayName") or user.get("name", "?")
            email = user.get("emailAddress", "")
            console.print(Panel(
                f"✅ [bold green]Authentication successful![/bold green]\n\n"
                f"  User: {name}\n"
                f"  Email: {email}\n"
                f"  Account ID: {user.get('accountId', 'N/A')}",
                style="green",
            ))
    except JiraClientError as exc:
        console.print(f"[bold red]❌ Authentication failed:[/bold red] {exc}")
        raise typer.Exit(1)
    except Exception as exc:
        console.print(f"[bold red]❌ Error:[/bold red] {exc}")
        raise typer.Exit(1)


# ── sync ──────────────────────────────────────────────────────────────

@app.command()
def sync(
    use_db: bool = typer.Option(False, "--use-db", help="Record sync in SQLite history database"),
) -> None:
    """Fetch issues from Jira, normalize, store, and output."""
    from taskforge.jira_client import JiraClient, JiraClientError
    from taskforge.normalizer import normalize_issues
    from taskforge.tree import build_tree
    from taskforge.storage import save_snapshot

    console.print("🔄 [bold]Syncing issues from Jira...[/bold]")

    try:
        with JiraClient() as client:
            console.print("  📡 Fetching issues (with hierarchy)...")
            raw_issues = client.fetch_with_hierarchy()
            console.print(f"  ✅ Fetched {len(raw_issues)} issues")
    except JiraClientError as exc:
        console.print(f"[bold red]❌ Jira error:[/bold red] {exc}")
        raise typer.Exit(1)

    console.print("  🔧 Normalizing...")
    issues = normalize_issues(raw_issues)

    console.print("  🌳 Building hierarchy tree...")
    tree = build_tree(issues)

    console.print("  💾 Saving snapshots...")
    snap_path = save_snapshot(issues, tree)

    # SQLite is OPTIONAL — only used when --use-db flag is set
    if use_db:
        try:
            from taskforge.storage import SQLiteStore
            console.print("  🗄️  Recording in SQLite...")
            with SQLiteStore() as store:
                store.record_sync(issues, snap_path)
        except Exception as exc:
            console.print(f"  ⚠️  SQLite recording failed (non-fatal): {exc}")

    console.print(Panel(
        f"✅ [bold green]Sync complete![/bold green]\n\n"
        f"  Issues: {len(issues)}\n"
        f"  Snapshot: {snap_path}\n"
        f"  Output: out/tasks.json, out/tasks_tree.json",
        style="green",
    ))


# ── render ────────────────────────────────────────────────────────────

@app.command()
def render(
    fmt: str = typer.Argument("table", help="Output format: json, md, table"),
) -> None:
    """Render latest synced issues in the chosen format."""
    from taskforge.storage import load_latest_issues
    from taskforge.renderer import render_json, render_markdown, render_table

    issues = load_latest_issues()
    if not issues:
        console.print("[yellow]No synced issues found. Run 'jira-assist sync' first.[/yellow]")
        raise typer.Exit(1)

    if fmt == "json":
        console.print(render_json(issues))
    elif fmt in ("md", "markdown"):
        console.print(render_markdown(issues))
    elif fmt == "table":
        render_table(issues, console)
    else:
        console.print(f"[red]Unknown format: {fmt}. Use json, md, or table.[/red]")
        raise typer.Exit(1)


# ── config show ──────────────────────────────────────────────────────

@app.command(name="config")
def config_show() -> None:
    """Print resolved configuration (sensitive values masked)."""
    from taskforge.config import get_settings

    settings = get_settings()
    display = settings.as_display_dict()

    table = Table(
        title="TaskForge Configuration",
        show_lines=True,
        header_style="bold cyan",
    )
    table.add_column("Setting", style="bold yellow", no_wrap=True)
    table.add_column("Value")

    for key, val in display.items():
        table.add_row(key, val)

    console.print(table)

    # Validation check
    errors = settings.validate_jira_config()
    if errors:
        console.print("\n[bold red]⚠️  Configuration issues:[/bold red]")
        for err in errors:
            console.print(f"  • {err}")
    else:
        console.print("\n[bold green]✅ Configuration looks valid[/bold green]")


# ── doctor ────────────────────────────────────────────────────────────

@app.command()
def doctor() -> None:
    """Run system diagnostics — check Jira config, AI setup, storage, data integrity."""
    from taskforge.config import get_settings

    settings = get_settings()

    console.print(Panel("🩺 [bold]TaskForge Doctor[/bold]", style="cyan"))

    # Jira config check
    console.print("\n[bold]Jira Configuration:[/bold]")
    errors = settings.validate_jira_config()
    if not errors:
        console.print(f"  ✅ Base URL: {settings.jira_base_url}")
        console.print(f"  ✅ Auth mode: {settings.jira_auth_mode}")
        token = settings.jira_api_token
        masked = f"{'*' * 8}...{token[-4:]}" if len(token) > 4 else "***"
        console.print(f"  ✅ API token: {masked}")
    else:
        for err in errors:
            console.print(f"  ❌ {err}")

    # Storage check
    console.print("\n[bold]Storage:[/bold]")
    console.print(f"  Output dir: {settings.output_path}")
    console.print(f"  Data dir: {settings.data_path}")
    console.print(f"  SQLite: {settings.sqlite_path}")

    tasks_json = settings.output_path / "tasks.json"
    if tasks_json.exists():
        issues = json.loads(tasks_json.read_text(encoding="utf-8"))
        console.print(f"  ✅ Latest sync: {len(issues)} issues in tasks.json")

        # Dataset integrity checks
        _check_data_integrity(issues)
    else:
        console.print("  ⚠️  No synced data yet. Run 'jira-assist sync'.")

    # AI check (delegate to ai doctor)
    console.print("\n[bold]AI System:[/bold]")
    try:
        from taskforge.ai.doctor import run_doctor
        run_doctor(console)
    except Exception as exc:
        console.print(f"  ⚠️  AI doctor failed: {exc}")


def _check_data_integrity(issues: list[dict]) -> None:
    """Check dataset for inconsistencies and warn the user."""
    console.print("\n[bold]Data Integrity:[/bold]")

    # Check for duplicate keys
    keys = [i.get("key") for i in issues if i.get("key")]
    unique_keys = set(keys)
    if len(keys) != len(unique_keys):
        dupes = [k for k in unique_keys if keys.count(k) > 1]
        console.print(f"  ⚠️  Duplicate issue keys detected: {dupes}")
    else:
        console.print(f"  ✅ No duplicate keys ({len(keys)} unique issues)")

    # Check for orphan parent references
    orphan_parents = set()
    for issue in issues:
        parent = issue.get("parent")
        if isinstance(parent, dict) and parent.get("key"):
            if parent["key"] not in unique_keys:
                orphan_parents.add(parent["key"])
    if orphan_parents:
        console.print(f"  ⚠️  Orphan parent references (not in dataset): {orphan_parents}")
    else:
        console.print("  ✅ All parent references resolved")

    # Check for issues missing critical fields
    missing_status = [i["key"] for i in issues if not i.get("status")]
    if missing_status:
        console.print(f"  ⚠️  Issues missing status: {missing_status[:5]}")
    else:
        console.print("  ✅ All issues have status")


# ── gui ───────────────────────────────────────────────────────────────

@app.command()
def gui(
    port: int = typer.Option(8765, help="Port to run the GUI server on"),
    host: str = typer.Option("127.0.0.1", help="Host to bind the GUI server to"),
) -> None:
    """Start the TaskForge Web UI server."""
    try:
        import uvicorn
        from taskforge.api import create_app
    except ImportError:
        console.print("[bold red]GUI dependencies not installed.[/bold red]")
        console.print("Run: [yellow]pip install taskforge[gui][/yellow]")
        raise typer.Exit(1)

    console.print(Panel(
        f"🚀 [bold green]TaskForge GUI running![/bold green]\n\n"
        f"  Open in browser: http://localhost:{port}\n"
        f"  API Documentation: http://localhost:{port}/docs\n\n"
        "Press [bold]Ctrl+C[/bold] to stop.",
        style="green",
    ))

    uvicorn.run(create_app(), host=host, port=port, log_level="info")
