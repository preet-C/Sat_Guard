import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SatGuard API", version="1.0.0")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "SatGuard backend running"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/tle/satellites")
def satellites_tle():
    return {
        "satellites": [
            {"name": "ISS", "norad_id": 25544},
            {"name": "Hubble", "norad_id": 20580}
        ]
    }