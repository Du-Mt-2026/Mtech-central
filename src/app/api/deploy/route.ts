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

import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '117a8794222043e42eb5e4982bffb28739774596695f6ad3525897e2138fd913'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const GITHUB_REPO = process.env.GITHUB_REPO || 'Du-Mt-26/Mtech-central'
const PROJECT_DIR = '/opt/octupuszap'

export async function POST(request: NextRequest) {
  try {
    // Verify deploy secret
    const secret = request.headers.get('X-Deploy-Secret')
    if (secret !== DEPLOY_SECRET) {
      console.warn('[Deploy] Invalid or missing X-Deploy-Secret header')
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
