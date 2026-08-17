"""
app.py — FastAPI microservice that wraps gmaps_scraper.py.

Endpoints:
    GET  /health        -> {ok, service, time, version}
    POST /scrape        -> {leads: [...], count, query, city, uf, elapsed_ms}

Run:
    uvicorn app:app --host 0.0.0.0 --port 5000
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from gmaps_scraper import scrape_google_maps

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scraper-service")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="OctopusZap Scraper",
    description="Microservice that scrapes Google Maps via Playwright",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ScrapeRequest(BaseModel):
    query: str = Field(..., description="Business type or name (e.g. 'restaurantes' or 'informatica Palhoça')")
    city: str = Field("", description="City name (e.g. 'Curitiba'). Empty = use raw query only.")
    uf: str = Field("", description="2-letter state code (e.g. 'PR'). Empty = use raw query only.")
    max_results: int = Field(60, ge=1, le=200)
    headless: bool = True
    max_scrolls: int = Field(25, ge=1, le=100)
    lang: str = "pt-BR"
    debug: bool = Field(False, description="Enable card+RPC dump to /tmp/scraper_debug/ for this request")


class ScrapeResponse(BaseModel):
    leads: List[Dict[str, Any]]
    count: int
    query: str
    city: str
    uf: str
    elapsed_ms: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "scraper",
        "version": "1.0.0",
        "time": int(time.time()),
    }


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape(req: ScrapeRequest) -> ScrapeResponse:
    """
    Trigger a Google Maps scrape for the given query/city/uf.

    Returns the list of normalized leads. The Next.js app is responsible
    for upserting them into Prisma — this service only returns JSON.
    """
    logger.info(
        f"scrape request: query={req.query!r} city={req.city!r} uf={req.uf!r} "
        f"max={req.max_results} headless={req.headless} debug={req.debug}"
    )
    t0 = time.time()
    try:
        # Playwright's sync API cannot run inside FastAPI's asyncio loop.
        # Offload to a worker thread — keeps the scraper code unchanged.
        leads = await asyncio.to_thread(
            scrape_google_maps,
            query=req.query,
            city=req.city,
            uf=req.uf,
            max_results=req.max_results,
            headless=req.headless,
            max_scrolls=req.max_scrolls,
            lang=req.lang,
            debug=req.debug,
        )
    except Exception as e:
        logger.exception("scrape failed")
        raise HTTPException(status_code=500, detail=f"scrape failed: {e}")

    elapsed = int((time.time() - t0) * 1000)
    logger.info(
        f"scrape ok: returned {len(leads)} leads in {elapsed}ms"
    )
    return ScrapeResponse(
        leads=leads,
        count=len(leads),
        query=req.query,
        city=req.city,
        uf=req.uf,
        elapsed_ms=elapsed,
    )


@app.get("/")
async def root() -> Dict[str, str]:
    return {"service": "octupuszap-scraper", "see": "/docs", "health": "/health"}


# ---------------------------------------------------------------------------
# Run with: python app.py  (or uvicorn app:app)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "5000"))
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
