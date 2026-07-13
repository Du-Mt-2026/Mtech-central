# OctupusZap Deploy Receiver

Minimal HTTP webhook receiver for triggering Docker rebuilds.

## Why this exists

The previous design mounted `/var/run/docker.sock` inside the Next.js app container so that `POST /api/deploy` could spawn a `docker:cli` container to rebuild. That gave the app container root-equivalent access to the host.

This receiver replaces that design: it's a tiny isolated service that owns the docker.sock. The app container no longer has it.

See: `docs/design-docker-sock-removal.md` for the full design rationale.

## Security

- **IP allowlist**: only accepts requests from GitHub webhook IP ranges. Set `ALLOW_NON_GITHUB_IPS=true` to bypass (NOT for production).
- **Secret**: validates `X-Deploy-Secret` header using `hmac.compare_digest` (timing-safe). `DEPLOY_SECRET` env var must be set.
- **Hardening**: runs as non-root user (UID 1001), `cap_drop: [ALL]`, `no-new-privileges:true`.
- **Isolation**: only joined to the `traefik` external network — NOT the `internal` network where the app + db live.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/deploy` | Triggers rebuild (called by GitHub webhook) |
| GET | `/api/deploy` | Health check (returns JSON status) |

## Environment variables

| Var | Required | Default | Description |
|---|---|---|---|
| `DEPLOY_SECRET` | ✅ | — | Must match the GitHub webhook secret |
| `GITHUB_TOKEN` | ❌ | — | Used for private repo tarball fallback |
| `GITHUB_REPO` | ❌ | `Du-Mt-26/Mtech-central` | Repo to clone from |
| `PROJECT_DIR` | ❌ | `/opt/octupuszap` | Where the repo lives on host |
| `ALLOW_NON_GITHUB_IPS` | ❌ | `false` | Bypass IP allowlist (NOT for production) |
| `PORT` | ❌ | `3001` | HTTP listen port |

## How it works

1. GitHub webhook sends `POST /api/deploy` with `X-Deploy-Secret` header
2. Receiver validates IP (must be from GitHub ranges) + secret (timing-safe compare)
3. If valid: spawns background thread that runs:
   - `git fetch origin main && git reset --hard origin/main` in `PROJECT_DIR`
   - `docker compose build app` (rebuild the app image)
   - `docker compose up -d app` (restart the app container)
4. Responds `200 OK` immediately (rebuild continues in background)
5. Logs to `/opt/octupuszap/deploy-log.txt` and stdout (`docker compose logs deploy-receiver`)

## Rollback procedure

If the receiver breaks and you need to deploy manually:

```bash
ssh user@server
cd /opt/octupuszap
git pull origin main
docker compose build app
docker compose up -d app
```

To restore the old design (app with docker.sock), revert this commit and restart:
```bash
git revert <commit-hash>
docker compose up -d --build app
```
