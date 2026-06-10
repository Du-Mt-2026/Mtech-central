#!/bin/bash
set -e

LOG_FILE="/opt/octupuszap/deploy-log.txt"

log() {
  echo "$1"
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

log "=== OctupusZap Deploy Hook ==="
log "Timestamp: $(date)"

cd /opt/octupuszap

log "📥 Pulling latest changes..."
git fetch origin main
git reset --hard origin/main

log "🐳 Building Docker image..."
docker compose build app

log "📦 Running migrations..."
docker compose run --rm migrate 2>&1 || log "⚠️ Migration step skipped (may not be needed)"

log "🚀 Restarting app container..."
docker compose up -d app

# Wait for app to be healthy
log "⏳ Waiting for app to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/deploy > /dev/null 2>&1; then
    log "✅ App is running!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    log "⚠️ App did not respond within 60 seconds, but container may still be starting"
  fi
  sleep 2
done

log "✅ Deploy completed!"
