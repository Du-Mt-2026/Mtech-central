import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncLinvixClients } from '@/lib/linvix-api'

/**
 * POST /api/sync/linvix
 * 
 * Syncs clients and sales data from Linvix ERP into OctupusZap.
 * Triggered by cron-job.org every hour.
 * 
 * Security: Requires CRON_SECRET in header or query param.
 * 
 * What it does:
 * 1. Logs into Linvix ERP with stored credentials
 * 2. Fetches all active clients via AJAX DataTable endpoint
 * 3. Upserts contacts into the "Linvix - Clientes" contact list
 * 4. Creates missing vendedores
 */
export async function POST(request: NextRequest) {
  // Security: Verify CRON_SECRET
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const headerSecret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '')
    const querySecret = new URL(request.url).searchParams.get('cron_secret')

    let bodyCronSecret: string | undefined
    try {
      const clonedRequest = request.clone()
      const body = await clonedRequest.json()
      bodyCronSecret = body.cron_secret
    } catch { /* no body or invalid JSON */ }

    const providedSecret = headerSecret || querySecret || bodyCronSecret

    if (providedSecret !== cronSecret) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid or missing cron secret' },
        { status: 401 }
      )
    }
  }

  try {
    // Check if Linvix credentials are configured
    if (!process.env.LINVIX_USER || !process.env.LINVIX_PASS) {
      return NextResponse.json({
        error: 'Linvix credentials not configured',
        hint: 'Set LINVIX_URL, LINVIX_USER, and LINVIX_PASS environment variables',
      }, { status: 400 })
    }

    const result = await syncLinvixClients(db)

    return NextResponse.json({
      success: true,
      message: `Synced ${result.synced} of ${result.total} clients from Linvix ERP`,
      ...result,
    })
  } catch (error: any) {
    console.error('[LinvixSync] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao sincronizar com Linvix' },
      { status: 500 }
    )
  }
}

// Also support GET for cron-job.org
export async function GET(request: NextRequest) {
  return POST(request)
}
