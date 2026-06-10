#!/bin/bash
# Deploy Hook - downloads code from GitHub and rebuilds
# Does NOT depend on git authentication

LOG_FILE="/opt/octupuszap/deploy-log.txt"
PROJECT_DIR="/opt/octupuszap"
GITHUB_REPO="Du-Mt-26/Mtech-central"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

log "=== Deploy Hook Started ==="
cd "$PROJECT_DIR"

# Try git first (fast path)
log "Trying git pull..."
if git fetch origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null; then
  log "Git pull succeeded"
else
  log "Git pull failed, downloading from GitHub..."
  # Download latest code as tarball (public repo, no auth needed)
  curl -sL "https://github.com/${GITHUB_REPO}/archive/refs/heads/main.tar.gz" | tar xz --strip-components=1
  if [ $? -eq 0 ]; then
    log "GitHub tarball download succeeded"
  else
    log "ERROR: Failed to download code"
    exit 1
  fi
fi

# Run rebuild in a separate container so it survives app restart
log "Starting rebuild in separate container..."

# Write rebuild script
cat > "$PROJECT_DIR/.rebuild.sh" << 'REBUILD'
#!/bin/sh
set -e
echo "=== Rebuild Started at $(date) ===" >> /opt/octupuszap/deploy-log.txt
cd /opt/octupuszap
echo "Building Docker image..." >> /opt/octupuszap/deploy-log.txt
docker compose build app 2>&1 >> /opt/octupuszap/deploy-log.txt
echo "Running migrations..." >> /opt/octupuszap/deploy-log.txt
docker compose run --rm migrate 2>/dev/null >> /opt/octupuszap/deploy-log.txt || true
echo "Restarting app container..." >> /opt/octupuszap/deploy-log.txt
docker compose up -d app 2>&1 >> /opt/octupuszap/deploy-log.txt
echo "=== Rebuild Completed at $(date) ===" >> /opt/octupuszap/deploy-log.txt
REBUILD
chmod +x "$PROJECT_DIR/.rebuild.sh"

# Run in separate Docker container (survives app container restart)
docker run --rm -d \
  --name deploy-rebuild \
  -v /opt/octupuszap:/opt/octupuszap \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /opt/octupuszap \
  docker:cli sh /opt/octupuszap/.rebuild.sh 2>/dev/null || {
  # Fallback to nohup
  log "Separate container failed, using nohup fallback..."
  nohup sh "$PROJECT_DIR/.rebuild.sh" >> "$LOG_FILE" 2>&1 < /dev/null &
}

log "Deploy hook completed - rebuild running in background"
