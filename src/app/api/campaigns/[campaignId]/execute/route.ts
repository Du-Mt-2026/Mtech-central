import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startCampaign, processNextMessage } from '@/lib/sending-engine'

/**
 * POST /api/campaigns/[campaignId]/execute
 * Starts a campaign by creating pending messages, setting status to running,
 * AND immediately begins processing messages within the function timeout.
 *
 * This is the PRIMARY way campaigns send messages — it doesn't rely on Vercel Cron.
 * The Cron endpoint (/api/campaigns/process-all) serves as a backup/scheduler.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    })

    if (!campaign) return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })

    // If already running, just process pending messages
    if (campaign.status === 'running') {
      // Campaign is already running — process pending messages now
      const processResult = await processMessagesInline(campaignId)
      return NextResponse.json({
        success: true,
        message: 'Campanha já está em execução — processando mensagens pendentes',
        ...processResult,
      })
    }

    // Only draft/scheduled can be started via execute
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: `Campanha não pode ser iniciada no status ${campaign.status}` }, { status: 400 })
    }

    // Use the centralized startCampaign from sending-engine.ts
    const { messageCount } = await startCampaign(campaignId)

    // IMMEDIATELY start processing messages within this function invocation
    const processResult = await processMessagesInline(campaignId)

    return NextResponse.json({
      success: true,
      message: `Campanha iniciada com ${messageCount} mensagens pendentes`,
      totalMessages: messageCount,
      ...processResult,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * Process messages for a campaign inline (within the current function invocation).
 * Uses a time-based loop — processes messages until the function is about to timeout.
 * Respects anti-ban intervals between messages.
 */
async function processMessagesInline(campaignId: string): Promise<{
  processed: number
  failed: number
  remaining: number
  lastReason?: string
}> {
  const FUNCTION_TIMEOUT_MS = 50_000 // Vercel timeout is 60s, leave 10s margin
  const startTime = Date.now()

  let processed = 0
  let failed = 0
  let remaining = 0
  let lastReason = ''

  // Process up to 10 messages per invocation (with anti-ban delays)
  for (let attempt = 0; attempt < 10; attempt++) {
    // Check if we're about to timeout
    if (Date.now() - startTime > FUNCTION_TIMEOUT_MS) {
      console.log(`[Execute] Approaching function timeout after ${processed} messages processed`)
      break
    }

    const result = await processNextMessage(campaignId)

    if (result.processed) {
      processed++
    } else {
      lastReason = result.reason || ''
    }

    remaining = result.remaining

    // If campaign is complete, stop
    if (result.completed) break

    // If hard block (ban, window, etc.), stop
    if (!result.processed && ['cooldown', 'outside_sending_window', 'chip_banned', 'whatsapp_warning_detected'].some(r => lastReason.includes(r))) {
      break
    }

    // If the delay is longer than the time remaining, stop
    const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
    if (result.delayMs > remainingTime) {
      break
    }

    // Wait the delay before the next message
    // IMPORTANT: Wait delayMs regardless of processed status!
    // When processed=false with step_delay or waiting_for_previous_step,
    // the delayMs is the time we need to wait before the next step is ready.
    if (result.delayMs > 0) {
      // Cap wait time to remaining function time to avoid timeout
      const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
      const waitTime = Math.min(result.delayMs, remainingTime - 2000) // leave 2s margin
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    // If no pending messages found and no specific reason, stop
    if (!result.processed && result.remaining === 0) break
  }

  return { processed, failed, remaining, lastReason: lastReason || undefined }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params
    const messages = await db.message.findMany({
      where: { campaignId },
      select: { status: true },
    })
    const sc: Record<string, number> = {}
    for (const m of messages) sc[m.status] = (sc[m.status] || 0) + 1
    const done = (sc.sent || 0) + (sc.delivered || 0) + (sc.read || 0) + (sc.failed || 0)
    return NextResponse.json({ total: messages.length, ...sc, progress: messages.length > 0 ? Math.round((done / messages.length) * 100) : 0 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
