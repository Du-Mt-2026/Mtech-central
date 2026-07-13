import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncLinvixClients } from '@/lib/linvix-api'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getAuditContext, auditLog } from '@/lib/audit-helper'

export const maxDuration = 300 // 5 minutes for Vercel Pro

/**
 * POST /api/sync/linvix
 *
 * Syncs clients and sales data from Linvix ERP into OctupusZap.
 * Triggered by cron-job.org every hour.
 *
 * SECURITY (P0.3): Fail-closed CRON_SECRET verification — refuses if unset in prod.
 * SECURITY (P1.6): Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * What it does:
 * 1. Logs into Linvix ERP with stored credentials (AJAX endpoint)
 * 2. Fetches all active clients via AJAX DataTable endpoint
 * 3. Bulk upserts contacts into the "Linvix - Clientes" contact list
 * 4. Creates missing vendedores
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()

  const authError = await verifyCronAuth(request)
  if (authError) return authError

  const ctx = await getAuditContext(request)

  try {
    // Check if Linvix credentials are configured
    if (!process.env.LINVIX_USER || !process.env.LINVIX_PASS) {
      return NextResponse.json({
        error: 'Linvix credentials not configured',
        hint: 'Set LINVIX_URL, LINVIX_USER, and LINVIX_PASS environment variables',
      }, { status: 400 })
    }

    const result = await syncLinvixClients(db)

    const durationMs = Date.now() - startTime
    console.debug(`[LinvixSync] Completed in ${durationMs}ms — synced: ${result.synced}, skipped: ${result.skipped}, errors: ${result.errors.length}`)

    await auditLog(ctx, {
      action: 'LINVIX_SYNC_COMPLETED',
      category: 'sync',
      targetType: 'contact_list',
      details: {
        synced: result.synced,
        skipped: result.skipped,
        errors: result.errors.length,
        total: result.total,
        durationMs,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Synced ${result.synced} of ${result.total} clients from Linvix ERP`,
      durationMs,
      ...result,
    })
  } catch (error: any) {
    console.error('[LinvixSync] Unhandled error:', error)
    await auditLog(ctx, {
      action: 'LINVIX_SYNC_FAILED',
      category: 'sync',
      targetType: 'contact_list',
      details: { error: error.message?.substring(0, 200) },
    })
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
