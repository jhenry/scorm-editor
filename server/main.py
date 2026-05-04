from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


REPO_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_ROOT = REPO_ROOT / "uploads"
ASSET_DIR = UPLOAD_ROOT / "assets"
ASSET_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(filename: str) -> str:
    # keep simple, conservative
    keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
    cleaned = "".join(ch if ch in keep else "_" for ch in (filename or "file"))
    return cleaned or "file"


app = FastAPI(title="SCORM Editor Dev Backend")

# If you serve the UI from a different origin (different host/port), enable CORS.
# If you serve the UI from this same FastAPI app (recommended for dev), you can remove this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"] ,
    allow_headers=["*"],
)


@app.post("/api/assets")
async def upload_asset(file: UploadFile = File(...)):
    """Accept an uploaded asset and persist it under uploads/assets.

    Returns JSON in the form {"url": "/assets/<name>", "relPath": "assets/<name>"}.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    safe = _safe_name(file.filename)
    # collision-resistant prefix
    out_name = f"{secrets.token_hex(8)}-{safe}"
    out_path = ASSET_DIR / out_name

    # stream to disk
    with out_path.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    return {
        "url": f"/assets/{out_name}",
        "relPath": f"assets/{out_name}",
        "filename": out_name,
        "contentType": file.content_type,
    }


# Serve uploaded assets
app.mount("/assets", StaticFiles(directory=str(ASSET_DIR)), name="assets")


# Serve the editor UI (repo root) for dev.
# API routes are defined above, so /api/* will take precedence.
app.mount("/", StaticFiles(directory=str(REPO_ROOT), html=True), name="ui")
