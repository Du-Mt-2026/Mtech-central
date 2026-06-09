// Deploy Webhook API — Receives GitHub Actions push notifications
// and triggers the deploy script on the server.
//
// This route is used instead of the adnanh/webhook on port 9000
// because port 9000 is not accessible from the internet.
// This route goes through Traefik on port 443 (HTTPS).
//
// POST /api/deploy
// Headers: X-Deploy-Secret: <secret>
// Body: {"ref":"main","sha":"<commit-sha>"}

import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '117a8794222043e42eb5e4982bffb28739774596695f6ad3525897e2138fd913'
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || '/opt/octupuszap/deploy-hook.sh'

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

    // Run deploy script in background
    // We use spawn with detached:true so the deploy process survives
    // when this app gets killed during rebuild
    try {
      const child = spawn(DEPLOY_SCRIPT, [], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
    } catch (error: any) {
      console.error('[Deploy] Failed to start deploy script:', error.message)
      return NextResponse.json({ error: 'Failed to start deploy' }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Deploy triggered successfully',
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
