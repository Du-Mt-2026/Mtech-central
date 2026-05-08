import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const [chips, campaigns, messages] = await Promise.all([
      db.chip.findMany(),
      db.campaign.findMany(),
      db.message.findMany(),
    ])

    const connectedChips = chips.filter((c) => c.status === 'connected').length
    const disconnectedChips = chips.filter((c) => c.status !== 'connected').length
    const activeCampaigns = campaigns.filter((c) => c.status === 'running').length
    const totalMessages = messages.length
    const deliveredMessages = messages.filter(
      (m) => m.status === 'delivered' || m.status === 'read'
    ).length
    const deliveryRate = totalMessages > 0 ? Math.round((deliveredMessages / totalMessages) * 100) : 0

    return NextResponse.json({
      totalChips: chips.length,
      connectedChips,
      disconnectedChips,
      activeCampaigns,
      totalMessages,
      deliveryRate,
    })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json(
      {
        totalChips: 0,
        connectedChips: 0,
        disconnectedChips: 0,
        activeCampaigns: 0,
        totalMessages: 0,
        deliveryRate: 0,
      },
      { status: 500 }
    )
  }
}
