import { NextResponse } from 'next/server'

/**
 * POST /api/deploy (REMOVED — manual deploy only)
 *
 * As of P0.6 (commit 18c7fd6), this endpoint no longer triggers deploys.
 * The app container no longer has /var/run/docker.sock mounted, so it
 * cannot trigger Docker rebuilds even if this endpoint was called.
 *
 * Deploy is done manually via SSH. See: docs/manual-deploy.md
 *
 * History (for context):
 * - Original: mounted docker.sock in app container, allowed POST to trigger rebuild
 * - P0.6 attempt 1: created isolated deploy-receiver service (commit 18c7fd6)
 * - P0.6 attempt 2: removed deploy-receiver after discovering the webhook tool
 *   on port 9000 (separate root process) was the actual (broken) deploy mechanism
 * - Final: removed both. Manual SSH deploy only. Simpler and more honest.
 *
 * If you need to deploy, SSH to the server and run:
 *   cd /opt/octupuszap
 *   git pull origin main
 *   docker compose build app
 *   docker compose up -d app
 */

export async function POST() {
  return NextResponse.json(
    {
      error: 'Deploy endpoint removed',
      reason: 'Manual deploy only — see docs/manual-deploy.md',
      command: 'ssh server && cd /opt/octupuszap && git pull && docker compose build app && docker compose up -d app',
    },
    { status: 410 } // 410 Gone
  )
}

export async function GET() {
  return NextResponse.json({
    status: 'removed',
    message: 'Deploy is manual. See docs/manual-deploy.md',
  })
}
