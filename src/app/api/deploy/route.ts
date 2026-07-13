import { NextResponse } from 'next/server'

/**
 * POST /api/deploy (DEPRECATED — moved to deploy-receiver service)
 *
 * As of commit implementing P0.6, the deploy endpoint moved to an isolated
 * 'deploy-receiver' service (infra/deploy-receiver/) accessible via
 * https://deploy.<your-domain>/api/deploy
 *
 * This stub exists to:
 *   1. Return a clear error to GitHub webhooks still pointing here
 *   2. Tell the operator to update the webhook URL in GitHub
 *
 * Action required:
 *   - GitHub repo → Settings → Webhooks → edit your webhook
 *   - Change Payload URL from:
 *       https://octupuszap.nikki.com.br/api/deploy
 *     to:
 *       https://deploy.octupuszap.nikki.com.br/api/deploy
 *   - Keep the same X-Deploy-Secret header
 *
 * See: docs/design-docker-sock-removal.md (P0.6)
 * See: infra/deploy-receiver/README.md
 */

export async function POST() {
  console.warn('[Deploy] Deprecated endpoint hit — webhook URL must be updated to https://deploy.<domain>/api/deploy')
  return NextResponse.json(
    {
      error: 'Deploy endpoint moved',
      action_required: 'Update the GitHub webhook URL to point to the deploy-receiver service',
      new_url_hint: 'https://deploy.<your-domain>/api/deploy',
      docs: 'See docs/design-docker-sock-removal.md and infra/deploy-receiver/README.md',
    },
    { status: 410 } // 410 Gone — permanent redirect semantics
  )
}

export async function GET() {
  return NextResponse.json({
    status: 'deprecated',
    message: 'Deploy endpoint moved to deploy-receiver service (P0.6)',
    new_url_hint: 'https://deploy.<your-domain>/api/deploy',
  })
}
