"""TaskForge Web API — FastAPI application wrapping core logic."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from taskforge.api.routes_system import router as system_router
from taskforge.api.routes_issues import router as issues_router
from taskforge.api.routes_queries import router as queries_router
from taskforge.api.routes_render import router as render_router
from taskforge.api.routes_ai import router as ai_router
from taskforge.api.routes_advisor import router as advisor_router

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    from taskforge.config import get_settings
    from taskforge.logging_config import configure_logging

    settings = get_settings()
    configure_logging(
        level=settings.log_level,
        log_file=settings.log_file,
        json_format=settings.log_json,
    )
    app = FastAPI(
        title="TaskForge",
        description="Local-first Jira assistant — Web UI API",
        version="1.0.0",
    )

    # CORS for local dev (Vite dev server on different port)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount API routers
    app.include_router(system_router, prefix="/api", tags=["system"])
    app.include_router(issues_router, prefix="/api", tags=["issues"])
    app.include_router(queries_router, prefix="/api", tags=["query"])
    app.include_router(render_router, prefix="/api", tags=["render"])
    app.include_router(ai_router, prefix="/api", tags=["ai"])
    app.include_router(advisor_router, prefix="/api", tags=["advisor"])

    # Serve static frontend build if it exists
    gui_dist = Path(__file__).resolve().parent.parent.parent.parent / "gui" / "dist"
    if gui_dist.is_dir():
        # Serve index.html for all non-API routes (SPA fallback)
        from starlette.responses import FileResponse

        @app.get("/app/{rest_of_path:path}")
        async def spa_fallback(rest_of_path: str):
            return FileResponse(gui_dist / "index.html")

        app.mount("/", StaticFiles(directory=str(gui_dist), html=True), name="static")
        logger.info("Serving frontend from %s", gui_dist)
    else:
        @app.get("/")
        async def root():
            return {
                "message": "TaskForge API is running. Frontend not built.",
                "hint": "Run 'cd gui && npm install && npm run build' to build the frontend.",
                "docs": "/docs",
            }

    return app
