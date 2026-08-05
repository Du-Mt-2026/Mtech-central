#!/bin/bash
# ========================================
# Manual Deploy Script for OctupusZap
# ========================================
# Run this script ON THE VPS server:
#   bash manual-deploy.sh
#
# This script downloads the latest code from GitHub
# and rebuilds the Docker container.
# No git authentication needed (public repo).

set -e

PROJECT_DIR="/opt/octupuszap"
REPO="Du-Mt-26/Mtech-central"

echo "=== OctupusZap Manual Deploy ==="
echo "Server: $(hostname)"
echo "Time: $(date)"
echo ""

cd "$PROJECT_DIR" || { echo "ERROR: Directory $PROJECT_DIR not found!"; exit 1; }

# Step 1: Download latest code
echo "📥 Downloading latest code from GitHub..."
curl -sL "https://github.com/${REPO}/archive/refs/heads/main.tar.gz" | tar xz --strip-components=1
echo "✅ Code downloaded successfully"

# Step 2: Build Docker image
echo "🐳 Building Docker image (this takes ~2 minutes)..."
docker compose build app

# Step 3: Run migrations
echo "📦 Running database migrations..."
docker compose run --rm migrate 2>/dev/null || echo "⚠️ Migration step skipped"

# Step 4: Restart app
echo "🚀 Restarting app container..."
docker compose up -d app

# Step 5: Verify
echo ""
echo "⏳ Waiting for app to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/deploy > /dev/null 2>&1; then
    echo "✅ App is running!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "⚠️ App did not start within 60 seconds"
    echo "Check logs: docker compose logs app --tail=50"
  fi
  sleep 2
done

echo ""
echo "=== Deploy Complete! ==="
echo "Current commit: $(git log --oneline -1 2>/dev/null || echo 'unknown')"
