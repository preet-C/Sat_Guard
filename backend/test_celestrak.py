import httpx
import sys
try:
    r = httpx.get(
        "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE",
        timeout=15,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"}
    )
    print(f"Status: {r.status_code}")
    print(f"Body length: {len(r.text)} chars")
    print(f"First 200 chars: {r.text[:200]}")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
    sys.exit(1)
