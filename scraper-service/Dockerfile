# =============================================================
# OctopusZap Scraper — Dockerfile
# =============================================================
# Python microservice wrapping gmaps_scraper.py + FastAPI.
# Listens on port 5000. Internal Docker network only (not exposed
# to the public internet — the Next.js app calls it internally).
# =============================================================

FROM python:3.11-slim

# Avoid Python writing .pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Install Playwright browsers to a system-wide path so they're
    # accessible to the non-root `scraper` user at runtime.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System deps required by Playwright Chromium
# https://playwright.dev/python/docs/browsers#install-system-dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright runtime libs
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libatspi2.0-0 \
    libwayland-client0 \
    # Fonts (Latin + some CJK fallback)
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-dejavu-core \
    # Misc
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install -r requirements.txt

# Install Playwright Chromium browser to /ms-playwright (system-wide)
# The ENV PLAYWRIGHT_BROWSERS_PATH above tells playwright where to install.
RUN playwright install chromium && \
    chmod -R a+rX /ms-playwright

# Copy app code
COPY app.py gmaps_scraper.py ./

# Run as non-root (Playwright is fine with this since browsers are in /ms-playwright)
RUN useradd -m -u 1001 scraper
USER scraper

EXPOSE 5000

# Healthcheck: hit the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:5000/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
