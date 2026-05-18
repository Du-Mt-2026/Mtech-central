import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startCampaign } from '@/lib/sending-engine'

/**
 * POST /api/campaigns/[campaignId]/execute
 * Starts a campaign by creating pending messages and setting status to running.
 * Actual message sending is handled by the Vercel Cron calling /api/campaigns/process-all
 * which uses the sending-engine.ts (serverless-safe, 1 message per invocation).
 * 
 * This route does NOT run a blocking while-loop (that would timeout on Vercel serverless).
 * It simply starts the campaign and lets the cron process messages.
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

    // If already running, just return status
    if (campaign.status === 'running') {
      return NextResponse.json({ success: true, message: 'Campanha já está em execução' })
    }

    // Only draft/scheduled can be started via execute
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: `Campanha não pode ser iniciada no status ${campaign.status}` }, { status: 400 })
    }

    // Use the centralized startCampaign from sending-engine.ts
    const { messageCount } = await startCampaign(campaignId)

    return NextResponse.json({
      success: true,
      message: `Campanha iniciada com ${messageCount} mensagens pendentes`,
      totalMessages: messageCount,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
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
