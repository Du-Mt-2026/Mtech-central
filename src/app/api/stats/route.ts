import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const [chips, campaigns, messages, contacts, recentMessages] = await Promise.all([
      db.chip.findMany(),
      db.campaign.findMany({ include: { chips: { include: { chip: true } }, sequenceSteps: true, contactList: true } }),
      db.message.findMany({ include: { chip: true, contact: true } }),
      db.contact.findMany(),
      db.message.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { chip: true, contact: true },
      }),
    ])

    const connectedChips = chips.filter((c) => c.status === 'connected').length
    const disconnectedChips = chips.filter((c) => c.status === 'disconnected').length
    const errorChips = chips.filter((c) => c.status === 'error').length
    const activeCampaigns = campaigns.filter((c) => c.status === 'running').length
    const totalMessages = messages.length
    const sentMessages = messages.filter((m) => m.status === 'sent').length
    const deliveredMessages = messages.filter(
      (m) => m.status === 'delivered' || m.status === 'read'
    ).length
    const readMessages = messages.filter((m) => m.status === 'read').length
    const failedMessages = messages.filter((m) => m.status === 'failed').length
    const pendingMessages = messages.filter((m) => m.status === 'pending').length
    const deliveryRate = totalMessages > 0 ? Math.round((deliveredMessages / totalMessages) * 100) : 0
    const totalSent = sentMessages + deliveredMessages + readMessages + failedMessages

    return NextResponse.json({
      totalChips: chips.length,
      connectedChips,
      disconnectedChips,
      errorChips,
      totalCampaigns: campaigns.length,
      activeCampaigns,
      totalMessages,
      sentMessages,
      deliveredMessages,
      readMessages,
      failedMessages,
      pendingMessages,
      deliveryRate,
      totalContacts: contacts.length,
      totalSent,
      recentMessages,
      runningCampaigns: campaigns.filter((c) => c.status === 'running'),
      chipStatuses: chips.map((c) => ({ id: c.id, name: c.name, phoneNumber: c.phoneNumber, status: c.status, sentToday: c.sentToday, dailyLimit: c.dailyLimit })),
    })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json(
      {
        totalChips: 0,
        connectedChips: 0,
        disconnectedChips: 0,
        errorChips: 0,
        totalCampaigns: 0,
        activeCampaigns: 0,
        totalMessages: 0,
        sentMessages: 0,
        deliveredMessages: 0,
        readMessages: 0,
        failedMessages: 0,
        pendingMessages: 0,
        deliveryRate: 0,
        totalContacts: 0,
        totalSent: 0,
        recentMessages: [],
        runningCampaigns: [],
        chipStatuses: [],
      },
      { status: 500 }
    )
  }
}
