"""
tle_fetcher.py
--------------
Async helpers that fetch TLE data from Space-Track.org (primary) and cache it
in-memory for up to 1 hour before re-fetching.

Space-Track is the official US Space Command source. It requires a free
registered account. Set credentials in the backend .env file:
  SPACETRACK_USER=your@email.com
  SPACETRACK_PASS=yourpassword

Falls back to local fallback_tle.txt if Space-Track is unreachable.
"""

import os
import time
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# Space-Track credentials (from environment / .env loaded by FastAPI)
# ---------------------------------------------------------------------------
_ST_USER = os.getenv("SPACETRACK_USER", "")
_ST_PASS = os.getenv("SPACETRACK_PASS", "")

# Space-Track base URL
_ST_BASE = "https://www.space-track.org"
_ST_LOGIN_URL = f"{_ST_BASE}/ajaxauth/login"

# Query: active satellite payloads in LEO+ with recent epoch (~7 days).
# This closely matches CelesTrak's "active satellites" group.
_ST_SATELLITES_URL = (
    f"{_ST_BASE}/basicspacedata/query/class/gp"
    "/MEAN_MOTION/%3E11.25"
    "/ECCENTRICITY/%3C0.25"
    "/OBJECT_TYPE/PAYLOAD"
    "/EPOCH/%3Enow-7"
    "/orderby/NORAD_CAT_ID"
    "/format/3le"
)

# Debris query: objects with high mean motion and higher eccentricity (typical debris)
_ST_DEBRIS_URL = (
    f"{_ST_BASE}/basicspacedata/query/class/gp"
    "/MEAN_MOTION/%3E11.25"
    "/ECCENTRICITY/%3E0.0001"
    "/OBJECT_TYPE/DEBRIS"
    "/EPOCH/%3Enow-7"
    "/orderby/NORAD_CAT_ID"
    "/format/3le"
)

# Local fallback TLE file (used when Space-Track is unavailable)
_FALLBACK_FILE = Path(__file__).parent / "fallback_tle.txt"

# ---------------------------------------------------------------------------
# Cache structure
# Each entry: {"data": <str | None>, "fetched_at": <float | None>}
# ---------------------------------------------------------------------------
_CACHE: dict[str, dict] = {
    "satellites": {"data": None, "fetched_at": None},
    "debris":     {"data": None, "fetched_at": None},
}

CACHE_TTL_SECONDS = 3600  # 1 hour


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_stale(key: str) -> bool:
    """Return True if the cache entry is missing or older than CACHE_TTL_SECONDS."""
    entry = _CACHE[key]
    if entry["fetched_at"] is None or entry["data"] is None:
        return True
    return (time.monotonic() - entry["fetched_at"]) > CACHE_TTL_SECONDS


def _has_credentials() -> bool:
    """Return True if Space-Track credentials are configured."""
    return bool(_ST_USER and _ST_PASS)


async def _fetch_from_spacetrack(query_url: str) -> str:
    """
    Authenticate with Space-Track and fetch TLE data from the given query URL.
    Uses a single httpx session so the login cookie is reused for the data request.
    """
    async with httpx.AsyncClient(
        timeout=60.0,
        follow_redirects=True,
    ) as client:
        # Step 1: Login to get session cookie
        login_resp = await client.post(
            _ST_LOGIN_URL,
            data={"identity": _ST_USER, "password": _ST_PASS},
        )
        login_resp.raise_for_status()

        # Space-Track returns {"Login": "Failed"} on bad credentials
        if "Failed" in login_resp.text:
            raise RuntimeError(
                "Space-Track login failed — check SPACETRACK_USER and SPACETRACK_PASS in .env"
            )

        # Step 2: Fetch TLE data (session cookie is carried automatically)
        data_resp = await client.get(query_url)
        data_resp.raise_for_status()

        text = data_resp.text.strip()
        if not text:
            raise RuntimeError(f"Space-Track returned empty response for {query_url}")

        return text


async def _fetch_satellites() -> str:
    """Fetch active-satellite TLE data from Space-Track, fallback to local file."""
    if _has_credentials():
        try:
            print("[SatGuard] Fetching satellites from Space-Track...")
            text = await _fetch_from_spacetrack(_ST_SATELLITES_URL)
            print(f"[SatGuard] Satellites fetched from Space-Track ({len(text.splitlines())} lines)")
            return text
        except Exception as exc:
            print(f"[SatGuard] Space-Track fetch failed ({exc}), trying fallback...")
    else:
        print("[SatGuard] No Space-Track credentials found, trying fallback...")

    if _FALLBACK_FILE.exists():
        print("[SatGuard] Using local fallback TLE for satellites")
        return _FALLBACK_FILE.read_text(encoding="utf-8")

    raise RuntimeError(
        "No TLE data available: Space-Track credentials missing and no fallback file found."
    )


async def _fetch_debris() -> str:
    """Fetch debris TLE data from Space-Track, fallback to local file."""
    if _has_credentials():
        try:
            print("[SatGuard] Fetching debris from Space-Track...")
            text = await _fetch_from_spacetrack(_ST_DEBRIS_URL)
            print(f"[SatGuard] Debris fetched from Space-Track ({len(text.splitlines())} lines)")
            return text
        except Exception as exc:
            print(f"[SatGuard] Space-Track debris fetch failed ({exc}), trying fallback...")
    else:
        print("[SatGuard] No Space-Track credentials, trying fallback for debris...")

    if _FALLBACK_FILE.exists():
        print("[SatGuard] Using local fallback TLE for debris")
        return _FALLBACK_FILE.read_text(encoding="utf-8")

    raise RuntimeError(
        "No debris TLE data available: Space-Track credentials missing and no fallback file found."
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_satellites_tle() -> str:
    """
    Return the active-satellites TLE text.
    Fetches from Space-Track if the cache is stale (> 1 hour old).
    """
    if _is_stale("satellites"):
        text = await _fetch_satellites()
        _CACHE["satellites"]["data"] = text
        _CACHE["satellites"]["fetched_at"] = time.monotonic()
    return _CACHE["satellites"]["data"]


async def get_debris_tle() -> str:
    """
    Return the debris TLE text.
    Fetches from Space-Track if the cache is stale (> 1 hour old).
    """
    if _is_stale("debris"):
        text = await _fetch_debris()
        _CACHE["debris"]["data"] = text
        _CACHE["debris"]["fetched_at"] = time.monotonic()
    return _CACHE["debris"]["data"]


def is_cached(key: str) -> bool:
    """Return True if the given key has valid (non-stale) cached data."""
    return not _is_stale(key)
