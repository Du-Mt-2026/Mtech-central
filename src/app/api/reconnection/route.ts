import { NextRequest, NextResponse } from 'next/server'
import {
  getReconnectionStats,
  getQueueEntries,
  forceReconnect,
  healthCheckDisconnectedChips,
  enqueueReconnection,
  resetQueue,
} from '@/lib/reconnection-queue'
import { db } from '@/lib/db'

/**
 * Reconnection Queue Management API
 *
 * GET  — Get queue status and entries (monitoring)
 * POST — Trigger actions (force reconnect, health check, reset)
 */
export async function GET(request: NextRequest) {
  try {
    // Load settings for reconnection config display
    const settings = await db.antiBanSettings.findFirst()
    const maxConcurrent = settings?.reconnectMaxConcurrent ?? 2
    const maxAttempts = settings?.reconnectMaxAttempts ?? 10
    const backoffSchedule = (() => { try { return settings?.reconnectBackoffMs ? JSON.parse(settings.reconnectBackoffMs) : [5000,15000,45000,120000,300000,600000] } catch { return [5000,15000,45000,120000,300000,600000] } })()
    const reconnectRateLimit = settings?.reconnectRateLimit ?? 5
    const reconnectRateWindowMin = settings?.reconnectRateWindowMin ?? 10

    const stats = getReconnectionStats()
    const entries = getQueueEntries()

    return NextResponse.json({
      stats,
      entries,
      config: {
        maxConcurrent,
        maxAttempts,
        backoffSchedule: backoffSchedule.map((ms: number) => {
          if (ms < 60000) return `${Math.round(ms/1000)}s`
          return `${Math.round(ms/60000)}min`
        }),
        rateLimit: `${reconnectRateLimit} reconnections per ${reconnectRateWindowMin} minutes`,
      },
    })
  } catch (error: any) {
    console.error('[ReconnectionAPI] Error getting stats:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao obter status da fila' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action

    switch (action) {
      // Force reconnection of a specific chip
      case 'force_reconnect': {
        const { chipId } = body
        if (!chipId) {
          return NextResponse.json(
            { error: 'chipId é obrigatório' },
            { status: 400 }
          )
        }
        const result = await forceReconnect(chipId)
        return NextResponse.json(result)
      }

      // Run health check on all disconnected chips
      case 'health_check': {
        const result = await healthCheckDisconnectedChips()
        return NextResponse.json(result)
      }

      // Queue all disconnected chips for reconnection
      case 'queue_all_disconnected': {
        // Load ban codes from settings for filtering
        const banCodesParsed = await (async () => { try { const s = await db.antiBanSettings.findFirst(); return s?.banCodes ? JSON.parse(s.banCodes) : [401,403,428,440] } catch { return [401,403,428,440] } })()
        const disconnectedChips = await db.chip.findMany({
          where: {
            status: { in: ['disconnected', 'connecting'] },
            disconnectionReasonCode: { notIn: banCodesParsed },
            evolutionInstance: { not: null },
          },
        })

        let queued = 0
        let skipped = 0
        for (const chip of disconnectedChips) {
          try {
            await enqueueReconnection(chip.id, { immediate: false })
            queued++
          } catch {
            skipped++
          }
        }

        return NextResponse.json({
          total: disconnectedChips.length,
          queued,
          skipped,
        })
      }

      // Reset the entire queue (emergency)
      case 'reset_queue': {
        resetQueue()
        return NextResponse.json({ message: 'Fila de reconexão resetada' })
      }

      default:
        return NextResponse.json(
          { error: `Ação desconhecida: ${action}. Ações válidas: force_reconnect, health_check, queue_all_disconnected, reset_queue` },
          { status: 400 }
        )
    }
  } catch (error: any) {
    console.error('[ReconnectionAPI] Error processing action:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao processar ação' },
      { status: 500 }
    )
  }
}
