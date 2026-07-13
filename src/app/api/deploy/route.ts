// Deploy Webhook API — Receives GitHub Actions push notifications
// and triggers the deploy script on the server.
//
// Strategy:
// 1. Download latest code from GitHub as tarball (no git auth needed on server)
// 2. Run docker rebuild in a SEPARATE container (survives app restart)
//
// POST /api/deploy
// Headers: X-Deploy-Secret: <secret>
// Body: {"ref":"main","sha":"<commit-sha>"}
//
// SECURITY: DEPLOY_SECRET MUST be set in environment variables. No hardcoded fallback.
// If not set, the endpoint returns 503 Service Unavailable.
//
// SECURITY (P1.2): IP allowlist — only accepts requests from GitHub webhook IPs.
// Behind Cloudflare/Traefik, checks cf-connecting-ip and x-forwarded-for headers.
// Set ALLOW_NON_GITHUB_IPS=true in .env to bypass (NOT recommended for production).
//
// SECURITY (P1.6): Uses crypto.timingSafeEqual for secret comparison.

import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { timingSafeEqual } from 'crypto'
import { isGitHubWebhookIp } from '@/lib/cron-auth'
import { getAuditContext, auditLog } from '@/lib/audit-helper'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const GITHUB_REPO = process.env.GITHUB_REPO || 'Du-Mt-26/Mtech-central'
const PROJECT_DIR = '/opt/octupuszap'

export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: No hardcoded fallback. If DEPLOY_SECRET is not set, refuse all deploys.
    if (!DEPLOY_SECRET) {
      console.error('[Deploy] DEPLOY_SECRET environment variable is not set — deploy endpoint disabled')
      return NextResponse.json(
        { error: 'Deploy endpoint disabled — DEPLOY_SECRET not configured' },
        { status: 503 }
      )
    }

    // SECURITY (P1.2): IP allowlist — only accept requests from GitHub webhook IPs
    // unless explicitly bypassed via ALLOW_NON_GITHUB_IPS=true
    const allowBypass = process.env.ALLOW_NON_GITHUB_IPS === 'true'
    if (!allowBypass && !isGitHubWebhookIp(request)) {
      console.warn('[Deploy] Rejected — request not from GitHub webhook IP')
      return NextResponse.json(
        { error: 'Forbidden — request not from GitHub' },
        { status: 403 }
      )
    }

    // SECURITY (P1.6): Verify deploy secret using crypto.timingSafeEqual
    const secret = request.headers.get('X-Deploy-Secret')
    if (!secret) {
      console.warn('[Deploy] Missing X-Deploy-Secret header')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const secretBuffer = Buffer.from(DEPLOY_SECRET, 'utf8')
    const providedBuffer = Buffer.from(secret, 'utf8')

    if (secretBuffer.length !== providedBuffer.length) {
      console.warn('[Deploy] Invalid X-Deploy-Secret header (wrong length)')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!timingSafeEqual(secretBuffer, providedBuffer)) {
      console.warn('[Deploy] Invalid X-Deploy-Secret header')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any = {}
    try { body = await request.json() } catch { /* optional */ }

    const sha = body.sha || 'main'
    console.log(`[Deploy] Triggered for sha: ${sha}`)

    // STEP 1: Try git pull first (fast, works if git credentials are configured)
    let gitUpdated = false
    try {
      execSync(`cd ${PROJECT_DIR} && git fetch origin main 2>&1 && git reset --hard origin/main 2>&1`, {
        timeout: 30000,
        stdio: 'pipe',
      })
      gitUpdated = true
      console.log('[Deploy] Git pull succeeded')
    } catch (error: any) {
      console.warn('[Deploy] Git pull failed:', error.message?.substring(0, 200))
    }

    // STEP 2: If git failed, try downloading from GitHub API as tarball
    if (!gitUpdated && GITHUB_TOKEN) {
      try {
        execSync(
          `cd ${PROJECT_DIR} && curl -sL -H "Authorization: token ${GITHUB_TOKEN}" ` +
          `"https://api.github.com/repos/${GITHUB_REPO}/tarball/main" ` +
          `| tar xz --strip-components=1 2>&1`,
          { timeout: 60000, stdio: 'pipe' }
        )
        gitUpdated = true
        console.log('[Deploy] GitHub tarball download succeeded')
      } catch (error: any) {
        console.error('[Deploy] GitHub tarball download failed:', error.message?.substring(0, 200))
      }
    }

    if (!gitUpdated) {
      return NextResponse.json({ error: 'Failed to update code - no git auth and no GITHUB_TOKEN env var' }, { status: 500 })
    }

    // STEP 3: Write a rebuild script that will run in a separate container
    const deployScript = `#!/bin/sh
set -e
echo "=== Deploy Rebuild Started at $(date) ===" >> ${PROJECT_DIR}/deploy-log.txt
cd ${PROJECT_DIR}
echo "Building Docker image..." >> ${PROJECT_DIR}/deploy-log.txt
docker compose build app 2>&1 >> ${PROJECT_DIR}/deploy-log.txt
echo "Restarting app container..." >> ${PROJECT_DIR}/deploy-log.txt
docker compose up -d app 2>&1 >> ${PROJECT_DIR}/deploy-log.txt
echo "=== Deploy Completed at $(date) ===" >> ${PROJECT_DIR}/deploy-log.txt
`
    writeFileSync(`${PROJECT_DIR}/.rebuild.sh`, deployScript)
    execSync(`chmod +x ${PROJECT_DIR}/.rebuild.sh`, { stdio: 'ignore' })

    // STEP 4: Run the rebuild in a separate Docker container via the socket
    // This container is independent of the app container, so it survives restart
    try {
      execSync(
        `docker run --rm -d ` +
        `--name deploy-rebuild ` +
        `-v ${PROJECT_DIR}:${PROJECT_DIR} ` +
        `-v /var/run/docker.sock:/var/run/docker.sock ` +
        `-w ${PROJECT_DIR} ` +
        `docker:cli sh ${PROJECT_DIR}/.rebuild.sh`,
        { timeout: 10000, stdio: 'pipe' }
      )
      console.log('[Deploy] Rebuild started in separate container')
    } catch (error: any) {
      // Fallback: try nohup
      console.warn('[Deploy] Separate container failed, trying nohup:', error.message?.substring(0, 200))
      try {
        execSync(
          `nohup sh ${PROJECT_DIR}/.rebuild.sh > ${PROJECT_DIR}/deploy-log.txt 2>&1 < /dev/null &`,
          { timeout: 5000, stdio: 'ignore' }
        )
        console.log('[Deploy] Rebuild started via nohup fallback')
      } catch (e2: any) {
        console.error('[Deploy] All rebuild methods failed')
      }
    }

    // Audit log before returning response
    const ctx = await getAuditContext(request)
    await auditLog(ctx, {
      action: 'DEPLOY_TRIGGERED',
      category: 'deploy',
      targetType: 'system',
      details: {
        sha,
        method: gitUpdated ? 'git' : 'tarball',
      },
    })

    return NextResponse.json({
      message: 'Deploy triggered successfully — code updated, rebuild starting',
      sha,
      method: gitUpdated ? 'git' : 'tarball',
    })
  } catch (error: any) {
    console.error('[Deploy] Error:', error.message)
    return NextResponse.json(
      { error: 'Deploy failed', detail: error.message },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ status: 'deploy-endpoint-ready' })
}
