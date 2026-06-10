#!/bin/bash
# Deploy Hook Script — runs inside the app container
# Uses Docker socket to run the rebuild in a SEPARATE container
# so the rebuild survives when this app container is killed.
set -e

LOG_FILE="/opt/octupuszap/deploy-log.txt"
PROJECT_DIR="/opt/octupuszap"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

log "=== Deploy Hook Started ==="

# Step 1: Pull latest code
log "Pulling latest code..."
cd "$PROJECT_DIR"

# Try git first
if git fetch origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null; then
  log "Git pull succeeded"
else
  log "Git pull failed, trying GitHub tarball..."
  # Try downloading from GitHub using the token from env
  if [ -n "$GITHUB_TOKEN" ]; then
    curl -sL -H "Authorization: token $GITHUB_TOKEN" \
      "https://api.github.com/repos/Du-Mt-26/Mtech-central/tarball/main" \
      | tar xz --strip-components=1
    log "GitHub tarball download succeeded"
  else
    log "ERROR: Git pull failed and no GITHUB_TOKEN env var set"
    exit 1
  fi
fi

# Step 2: Run the rebuild in a separate Docker container
# This is the KEY: we use `docker run` to start a completely independent
# container that runs the rebuild. When `docker compose up -d app` 
# restarts this app container, the rebuild container is unaffected.
log "Starting rebuild in separate container..."

# Write the rebuild script
cat > "$PROJECT_DIR/.rebuild.sh" << 'REBUILD'
#!/bin/sh
set -e
echo "=== Rebuild Started at $(date) ===" >> /opt/octupuszap/deploy-log.txt
cd /opt/octupuszap
echo "Building Docker image..." >> /opt/octupuszap/deploy-log.txt
docker compose build app 2>&1 >> /opt/octupuszap/deploy-log.txt
echo "Restarting app container..." >> /opt/octupuszap/deploy-log.txt
docker compose up -d app 2>&1 >> /opt/octupuszap/deploy-log.txt
echo "=== Rebuild Completed at $(date) ===" >> /opt/octupuszap/deploy-log.txt
REBUILD
chmod +x "$PROJECT_DIR/.rebuild.sh"

# Run rebuild in a separate container using the docker:cli image
# --pid=host: process runs in host PID namespace (not affected by container restart)
# -v mounts: same access to project dir and docker socket
docker run --rm -d \
  --name deploy-rebuild \
  --pid=host \
  -v /opt/octupuszap:/opt/octupuszap \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /opt/octupuszap \
  docker:cli \
  sh /opt/octupuszap/.rebuild.sh 2>/dev/null || {
  # Fallback: try nohup if docker run fails
  log "Docker run failed, trying nohup fallback..."
  nohup sh "$PROJECT_DIR/.rebuild.sh" >> "$LOG_FILE" 2>&1 < /dev/null &
}

log "Deploy hook completed - rebuild running in background"
