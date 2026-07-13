#!/usr/bin/env python3
"""
OctupusZap Deploy Receiver — minimal HTTP webhook receiver.

Receives GitHub push webhooks and triggers a Docker rebuild of the app.

Why this exists (P0.6):
The previous design mounted /var/run/docker.sock inside the Next.js app
container so that POST /api/deploy could spawn a docker:cli container to
rebuild. That gave the app container root-equivalent access to the host.
This receiver replaces that design: it's a tiny isolated service that owns
the docker.sock. The app container no longer has it.

Security:
- IP allowlist: only accepts requests from GitHub webhook IP ranges.
  Set ALLOW_NON_GITHUB_IPS=true in env to bypass (NOT for production).
- Secret: validates X-Deploy-Secret header using hmac.compare_digest
  (timing-safe). DEPLOY_SECRET env var must be set or endpoint returns 503.
- Hardening: runs as non-root user (UID 1001), no capabilities, no-new-privileges.

Endpoints:
- POST /api/deploy  — triggers rebuild (called by GitHub webhook)
- GET  /api/deploy  — health check (returns JSON status)

Env vars:
- DEPLOY_SECRET (required)
- GITHUB_TOKEN (optional, used for private repo tarball fallback)
- GITHUB_REPO (default: Du-Mt-26/Mtech-central)
- PROJECT_DIR (default: /opt/octupuszap)
- ALLOW_NON_GITHUB_IPS (default: false)
- PORT (default: 3001)
"""

import os
import sys
import hmac
import json
import subprocess
import threading
import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from ipaddress import ip_address, ip_network

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

DEPLOY_SECRET = os.environ.get('DEPLOY_SECRET', '').encode('utf-8')
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GITHUB_REPO = os.environ.get('GITHUB_REPO', 'Du-Mt-26/Mtech-central')
PROJECT_DIR = os.environ.get('PROJECT_DIR', '/opt/octupuszap')
ALLOW_NON_GITHUB_IPS = os.environ.get('ALLOW_NON_GITHUB_IPS', 'false').lower() == 'true'
PORT = int(os.environ.get('PORT', '3001'))
LOG_FILE = f'{PROJECT_DIR}/deploy-log.txt'

# GitHub webhook IP ranges (as of 2024)
GITHUB_WEBHOOK_RANGES = [
    '192.30.252.0/22',
    '185.199.108.0/22',
    '140.82.112.0/16',
    '143.55.64.0/20',
    '20.201.28.151/32',
    '20.220.46.146/32',
]

# ──────────────────────────────────────────────────────────────────────────
# Security checks
# ──────────────────────────────────────────────────────────────────────────

def is_github_ip(ip_str: str) -> bool:
    if not ip_str:
        return False
    try:
        ip = ip_address(ip_str)
        return any(ip in ip_network(net) for net in GITHUB_WEBHOOK_RANGES)
    except ValueError:
        return False


def get_client_ip(handler: BaseHTTPRequestHandler) -> str:
    cf_ip = handler.headers.get('cf-connecting-ip')
    if cf_ip:
        return cf_ip.strip()
    xff = handler.headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    return handler.client_address[0]


def verify_secret(provided: str) -> bool:
    if not DEPLOY_SECRET:
        return False
    provided_bytes = provided.encode('utf-8') if provided else b''
    if len(provided_bytes) != len(DEPLOY_SECRET):
        return False
    return hmac.compare_digest(provided_bytes, DEPLOY_SECRET)

# ──────────────────────────────────────────────────────────────────────────
# Deploy logic
# ──────────────────────────────────────────────────────────────────────────

def log(message: str) -> None:
    """Append to deploy-log.txt and stdout."""
    timestamp = datetime.datetime.now().isoformat()
    line = f'[{timestamp}] {message}'
    print(line, flush=True)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass  # Don't fail if log file isn't writable


def trigger_rebuild(sha: str) -> None:
    """Run git pull + docker rebuild in background. Fire-and-forget."""

    def run():
        try:
            log(f'=== Deploy started for sha={sha} ===')

            # Step 1: git fetch + reset
            try:
                result = subprocess.run(
                    ['git', 'fetch', 'origin', 'main'],
                    cwd=PROJECT_DIR, capture_output=True, text=True, timeout=30,
                )
                log(f'[git fetch] rc={result.returncode} {result.stderr.strip()[:200]}')

                result = subprocess.run(
                    ['git', 'reset', '--hard', 'origin/main'],
                    cwd=PROJECT_DIR, capture_output=True, text=True, timeout=30,
                )
                log(f'[git reset] rc={result.returncode} {result.stdout.strip()[:200]}')
            except subprocess.TimeoutExpired:
                log('[git] TIMEOUT during fetch/reset')
                if not GITHUB_TOKEN:
                    return
                log('[fallback] Trying tarball download...')
                try:
                    subprocess.run(
                        f'curl -sL -H "Authorization: token {GITHUB_TOKEN}" '
                        f'"https://api.github.com/repos/{GITHUB_REPO}/tarball/main" '
                        f'| tar xz --strip-components=1',
                        cwd=PROJECT_DIR, shell=True, capture_output=True, text=True, timeout=60,
                    )
                    log('[fallback] tarball download done')
                except Exception as e:
                    log(f'[fallback] FAILED: {e}')
                    return
            except Exception as e:
                log(f'[git] ERROR: {e}')
                return

            # Step 2: docker compose build
            log('[docker] Building app image...')
            result = subprocess.run(
                ['docker', 'compose', 'build', 'app'],
                cwd=PROJECT_DIR, capture_output=True, text=True, timeout=600,
            )
            log(f'[docker build] rc={result.returncode}')
            if result.returncode != 0:
                log(f'[docker build] STDERR: {result.stderr[-1000:]}')
                return

            # Step 3: docker compose up -d app
            log('[docker] Restarting app container...')
            result = subprocess.run(
                ['docker', 'compose', 'up', '-d', 'app'],
                cwd=PROJECT_DIR, capture_output=True, text=True, timeout=60,
            )
            log(f'[docker up] rc={result.returncode} {result.stdout.strip()[:200]}')
            log(f'=== Deploy finished for sha={sha} ===')

        except Exception as e:
            log(f'[FATAL] Rebuild failed: {e}')

    threading.Thread(target=run, daemon=True).start()


# ──────────────────────────────────────────────────────────────────────────
# HTTP handler
# ──────────────────────────────────────────────────────────────────────────

class DeployHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Custom logger — goes to stdout (visible in docker logs)
        print(f'[{self.address_string()}] {format % args}', flush=True)

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        """Health check."""
        self._send_json(200, {
            'status': 'deploy-receiver-ready',
            'service': 'octupuszap-deploy-receiver',
        })

    def do_POST(self):
        """Receive webhook from GitHub."""
        # 1. Fail-closed: DEPLOY_SECRET must be configured
        if not DEPLOY_SECRET:
            log('ERROR: DEPLOY_SECRET not configured')
            self._send_json(503, {'error': 'DEPLOY_SECRET not configured'})
            return

        # 2. IP allowlist
        client_ip = get_client_ip(self)
        if not ALLOW_NON_GITHUB_IPS and not is_github_ip(client_ip):
            log(f'REJECTED: IP {client_ip} not in GitHub ranges')
            self._send_json(403, {'error': 'Forbidden — request not from GitHub', 'ip': client_ip})
            return

        # 3. Verify secret
        provided_secret = self.headers.get('X-Deploy-Secret', '')
        if not verify_secret(provided_secret):
            log(f'REJECTED: invalid or missing X-Deploy-Secret from {client_ip}')
            self._send_json(401, {'error': 'Unauthorized'})
            return

        # 4. Read body
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'
            data = json.loads(body_bytes.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}

        sha = data.get('sha', 'main')
        ref = data.get('ref', 'refs/heads/main')

        # Only deploy on main branch
        if ref and not ref.endswith('/main'):
            log(f'Skipping push to {ref} (only main is deployed)')
            self._send_json(200, {'message': f'Skipped push to {ref}', 'deployed': False})
            return

        log(f'Deploy triggered for sha={sha} from {client_ip}')

        # 5. Trigger rebuild in background
        trigger_rebuild(sha)

        # 6. Respond immediately (rebuild continues in background)
        self._send_json(200, {
            'message': 'Deploy triggered successfully — code update + rebuild starting',
            'sha': sha,
            'method': 'git',
        })


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main():
    if not DEPLOY_SECRET:
        print('[DeployReceiver] FATAL: DEPLOY_SECRET env var not set.', file=sys.stderr)
        print('[DeployReceiver] Endpoint will return 503 for all POST requests.', file=sys.stderr)

    print(f'[DeployReceiver] Starting on port {PORT}', flush=True)
    print(f'[DeployReceiver] PROJECT_DIR={PROJECT_DIR}', flush=True)
    print(f'[DeployReceiver] GITHUB_REPO={GITHUB_REPO}', flush=True)
    print(f'[DeployReceiver] ALLOW_NON_GITHUB_IPS={ALLOW_NON_GITHUB_IPS}', flush=True)
    print(f'[DeployReceiver] DEPLOY_SECRET={"configured" if DEPLOY_SECRET else "MISSING"}', flush=True)

    server = HTTPServer(('0.0.0.0', PORT), DeployHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[DeployReceiver] Shutting down...', flush=True)
        server.shutdown()


if __name__ == '__main__':
    main()
