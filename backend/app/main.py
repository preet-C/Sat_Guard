import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.tle_fetcher import get_satellites_tle, get_debris_tle, is_cached


# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

# Comma-separated list of allowed frontend origins.
# Example: "http://localhost:5173,https://satguard.pages.dev"
FRONTEND_URLS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_URL", "http://localhost:5173").split(",")
    if origin.strip()
]

# "development" or "production" — controls docs visibility
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

_STARTUP_TIME = time.monotonic()


# ---------------------------------------------------------------------------
# Startup: pre-fetch and cache TLE data so first request is instant
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app):
    try:
        print("[SatGuard] Pre-fetching TLE data on startup...")
        await get_satellites_tle()
        await get_debris_tle()
        print("[SatGuard] TLE data pre-cached successfully")
    except Exception as e:
        print(f"[SatGuard] Startup TLE pre-cache failed (will fetch on demand): {e}")
    yield


app = FastAPI(
    title="SatGuard API",
    version="1.0.0",
    lifespan=lifespan,
    # Disable interactive docs in production (they expose the API surface)
    docs_url="/docs" if ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if ENVIRONMENT == "development" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_URLS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Existing root
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "SatGuard backend running"}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    """Quick health-check endpoint; reports whether TLE data is in cache."""
    return {
        "status": "ok",
        "version": "1.0.0",
        "uptime_seconds": round(time.monotonic() - _STARTUP_TIME),
        "satellites_cached": is_cached("satellites"),
        "debris_cached": is_cached("debris"),
    }


# ---------------------------------------------------------------------------
# TLE endpoints
# ---------------------------------------------------------------------------

@app.get("/api/tle/satellites", response_class=PlainTextResponse)
async def satellites_tle():
    """
    Return the active-satellites TLE data as plain text.
    Data is fetched from Space-Track and cached for 1 hour.
    """
    try:
        data = await get_satellites_tle()
        return PlainTextResponse(
            content=data,
            media_type="text/plain",
            headers={"Cache-Control": "public, max-age=1800"},  # 30 min browser cache
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch satellite TLE: {exc}")


@app.get("/api/tle/debris", response_class=PlainTextResponse)
async def debris_tle():
    """
    Return the debris TLE data as plain text.
    Data is fetched from Space-Track and cached for 1 hour.
    """
    try:
        data = await get_debris_tle()
        return PlainTextResponse(
            content=data,
            media_type="text/plain",
            headers={"Cache-Control": "public, max-age=1800"},  # 30 min browser cache
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch debris TLE: {exc}")