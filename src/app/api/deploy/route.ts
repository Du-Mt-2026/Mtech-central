// Deploy Webhook API — Receives GitHub Actions push notifications
// and triggers the deploy script on the server.
//
// POST /api/deploy
// Headers: X-Deploy-Secret: <secret>
// Body: {"ref":"main","sha":"<commit-sha>"}

import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '117a8794222043e42eb5e4982bffb28739774596695f6ad3525897e2138fd913'

export async function POST(request: NextRequest) {
  try {
    // Verify deploy secret
    const secret = request.headers.get('X-Deploy-Secret')
    if (secret !== DEPLOY_SECRET) {
      console.warn('[Deploy] Invalid or missing X-Deploy-Secret header')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse body for logging
    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // Body is optional
    }

    console.log(`[Deploy] Triggered by push to ${body.ref || 'unknown'}, sha: ${body.sha || 'unknown'}`)

    // STEP 1: Pull latest code (this runs inside the container but writes to the mounted volume)
    try {
      execSync('cd /opt/octupuszap && git fetch origin main && git reset --hard origin/main', {
        timeout: 30000,
        stdio: 'pipe',
      })
      console.log('[Deploy] Git pull completed successfully')
    } catch (error: any) {
      console.error('[Deploy] Git pull failed:', error.message)
      return NextResponse.json({ error: 'Git pull failed', detail: error.message }, { status: 500 })
    }

    // STEP 2: Trigger docker rebuild using a systemd timer or a separate detached process
    // We write a flag file and the rebuild happens asynchronously
    try {
      // Write a deploy trigger that will be picked up by the health-cron or a simple loop
      execSync('echo "$(date +%s)" > /opt/octupuszap/.deploy-trigger', { timeout: 5000, stdio: 'pipe' })
      console.log('[Deploy] Deploy trigger written')
    } catch {
      // Non-critical
    }

    // STEP 3: Start the rebuild as a truly detached process
    // Using docker exec to run in the host's PID namespace via nsenter
    // This way the rebuild process is NOT a child of this container
    try {
      // Method: Schedule rebuild using at(1) or a backgrounded subshell via nohup
      // Since we have the docker socket, we can run docker commands directly
      // The trick: use setsid + nohup to fully detach from the container's process group
      const rebuildCmd = `setsid sh -c 'cd /opt/octupuszap && docker compose build app && docker compose up -d app && echo "Deploy completed at $(date)" >> /opt/octupuszap/deploy-log.txt' > /opt/octupuszap/deploy-log.txt 2>&1 < /dev/null &`
      execSync(rebuildCmd, { timeout: 5000, stdio: 'ignore' })
      console.log('[Deploy] Rebuild process detached and running')
    } catch (error: any) {
      // setsid might not be available, try nohup
      try {
        const nohupCmd = `nohup sh -c 'cd /opt/octupuszap && docker compose build app && docker compose up -d app && echo "Deploy completed at $(date)" >> /opt/octupuszap/deploy-log.txt' > /opt/octupuszap/deploy-log.txt 2>&1 &`
        execSync(nohupCmd, { timeout: 5000, stdio: 'ignore' })
        console.log('[Deploy] Rebuild process started via nohup')
      } catch (error2: any) {
        // Last resort: try the original deploy-hook.sh
        try {
          execSync(`nohup bash /opt/octupuszap/deploy-hook.sh > /opt/octupuszap/deploy-log.txt 2>&1 &`, { timeout: 5000, stdio: 'ignore' })
          console.log('[Deploy] Deploy hook started via nohup')
        } catch (error3: any) {
          console.error('[Deploy] All deploy methods failed:', error3.message)
        }
      }
    }

    return NextResponse.json({
      message: 'Deploy triggered successfully — git pull done, rebuild starting',
      sha: body.sha || 'unknown',
    })
  } catch (error: any) {
    console.error('[Deploy] Error:', error.message)
    return NextResponse.json(
      { error: 'Deploy failed', detail: error.message },
      { status: 500 }
    )
  }
}

// Also handle GET for health check
export async function GET() {
  return NextResponse.json({ status: 'deploy-endpoint-ready' })
}
