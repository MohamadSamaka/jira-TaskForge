"""CLI query commands — blocked, next, by-project, today."""

from __future__ import annotations

import typer
from rich.console import Console

query_app = typer.Typer(help="Deterministic queries on synced issues")
console = Console()


def _load_issues() -> list:
    from taskforge.storage import load_latest_issues

    issues = load_latest_issues()
    if not issues:
        console.print("[yellow]No synced issues. Run 'jira-assist sync' first.[/yellow]")
        raise typer.Exit(1)
    return issues


@query_app.command()
def blocked() -> None:
    """Show issues that are blocked by other issues."""
    from taskforge.queries import find_blocked
    from taskforge.renderer import render_blocked_table

    issues = _load_issues()
    blocked_items = find_blocked(issues)

    if not blocked_items:
        console.print("[green]✅ No blocked issues found![/green]")
        return

    console.print(f"\nFound [bold red]{len(blocked_items)}[/bold red] blocked issues:\n")
    render_blocked_table(blocked_items, console)


@query_app.command()
def next(
    top: int = typer.Option(5, "--top", "-n", help="Number of recommendations"),
) -> None:
    """Rank issues by priority, due date, recency, and blocked status."""
    from taskforge.queries import rank_next
    from taskforge.renderer import render_ranked_table

    issues = _load_issues()
    ranked = rank_next(issues, top=top)

    if not ranked:
        console.print("[green]✅ No actionable issues found![/green]")
        return

    render_ranked_table(ranked, console)


@query_app.command(name="by-project")
def by_project() -> None:
    """Group issues by project."""
    from taskforge.queries import group_by_project
    from taskforge.renderer import render_table

    issues = _load_issues()
    groups = group_by_project(issues)

    for project, proj_issues in groups.items():
        console.print(f"\n[bold cyan]── {project} ({len(proj_issues)} issues) ──[/bold cyan]")
        render_table(proj_issues, console)


@query_app.command()
def today() -> None:
    """Show issues updated or due today."""
    from taskforge.queries import filter_today
    from taskforge.renderer import render_table

    issues = _load_issues()
    today_issues = filter_today(issues)

    if not today_issues:
        console.print("[yellow]No issues updated or due today.[/yellow]")
        return

    console.print(f"\n📅 [bold]{len(today_issues)}[/bold] issues for today:\n")
    render_table(today_issues, console)
