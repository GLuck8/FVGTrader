"""
FVG Trader — FastAPI backend
Run locally:  uvicorn app.main:app --reload --port 8000
Deploy:       Set env vars from .env.example, then `railway up` or `render deploy`
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.services.oanda import OandaAdapter
from app.services.scanner import LiveScanner
from app.routers.api import router

logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
    datefmt = "%H:%M:%S",
)
log = logging.getLogger("fvg")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: initialise OANDA adapter and scanner. Shutdown: clean up."""
    log.info("Starting FVG Trader backend...")
    settings = get_settings()

    oanda   = OandaAdapter()
    scanner = LiveScanner(oanda)

    app.state.oanda   = oanda
    app.state.scanner = scanner

    log.info(
        f"OANDA environment: {settings.oanda_environment} "
        f"({'PAPER/DEMO' if settings.oanda_environment == 'practice' else '⚠ LIVE'})"
    )
    log.info("Backend ready.")

    yield

    # Shutdown
    log.info("Shutting down...")
    if scanner.is_running:
        scanner.stop()
    await oanda.close()
    log.info("Clean shutdown complete.")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title       = "FVG Trader API",
        description = "Fair Value Gap strategy engine with OANDA paper/live trading",
        version     = "1.0.0",
        lifespan    = lifespan,
    )

    # CORS — allow the React frontend (Vercel) and local dev
    origins = [
        "http://localhost:5173",   # Vite dev server
        "http://localhost:3000",
        "https://*.vercel.app",    # Vercel previews
    ]
    if settings.environment == "development":
        origins.append("*")       # open in dev for convenience

    app.add_middleware(
        CORSMiddleware,
        allow_origins     = origins,
        allow_credentials = True,
        allow_methods     = ["*"],
        allow_headers     = ["*"],
    )

    # Attach router — make Request object available to all routes
    # (routes use request.app.state to access oanda/scanner)
    app.include_router(router, prefix="/api/v1")

    return app


app = create_app()
