import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    // Use lightweight counts and aggregation instead of loading everything into memory
    const [
      chipCounts,
      totalChips,
      campaignCounts,
      messageCounts,
      contactsCount,
      recentMessages,
      runningCampaignsRaw,
      chipStatuses,
    ] = await Promise.all([
      // Chip status counts via groupBy (no full records loaded)
      db.chip.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // Total chips
      db.chip.count(),
      // Campaign counts via groupBy
      db.campaign.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // Message counts via groupBy (instead of loading ALL messages)
      db.message.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // Total contacts
      db.contact.count(),
      // Recent 20 messages with joins (lightweight, limited)
      db.message.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { chip: { select: { name: true, phoneNumber: true } }, contact: { select: { name: true, phone: true } } },
      }),
      // Running + paused campaigns for progress display
      db.campaign.findMany({
        where: { status: { in: ['running', 'paused'] } },
        include: {
          chips: { include: { chip: { select: { id: true, name: true } } } },
          sequenceSteps: { select: { id: true } },
          contactList: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),
      // Chip statuses for dashboard card
      db.chip.findMany({
        select: { id: true, name: true, phoneNumber: true, status: true, sentToday: true, dailyLimit: true },
      }),
    ])

    // Convert groupBy results to maps for easy lookup
    const chipStatusMap = new Map(chipCounts.map(c => [c.status, c._count.status]))
    const campaignStatusMap = new Map(campaignCounts.map(c => [c.status, c._count.status]))
    const messageStatusMap = new Map(messageCounts.map(c => [c.status, c._count.status]))

    const connectedChips = chipStatusMap.get('connected') ?? 0
    const disconnectedChips = chipStatusMap.get('disconnected') ?? 0
    const errorChips = chipStatusMap.get('error') ?? 0
    const activeCampaigns = campaignStatusMap.get('running') ?? 0
    const totalMessages = Array.from(messageStatusMap.values()).reduce((sum, count) => sum + count, 0)
    const sentMessages = messageStatusMap.get('sent') ?? 0
    const deliveredMessages = (messageStatusMap.get('delivered') ?? 0) + (messageStatusMap.get('read') ?? 0)
    const readMessages = messageStatusMap.get('read') ?? 0
    const failedMessages = messageStatusMap.get('failed') ?? 0
    const pendingMessages = (messageStatusMap.get('pending') ?? 0) + (messageStatusMap.get('sending') ?? 0)
    const deliveryRate = totalMessages > 0 ? Math.round((deliveredMessages / totalMessages) * 100) : 0
    const totalSent = sentMessages + deliveredMessages + readMessages + failedMessages

    // Calculate campaign progress using separate count queries (not loading all messages)
    const runningCampaigns: any[] = []
    for (const c of runningCampaignsRaw) {
      const [total, completed] = await Promise.all([
        db.message.count({ where: { campaignId: c.id } }),
        db.message.count({ where: { campaignId: c.id, status: { in: ['sent', 'delivered', 'read', 'failed'] } } }),
      ])
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0
      runningCampaigns.push({
        ...c,
        _progress: progress,
        _totalMessages: total,
        _completedMessages: completed,
      })
    }

    return NextResponse.json({
      totalChips,
      connectedChips,
      disconnectedChips,
      errorChips,
      totalCampaigns: Array.from(campaignStatusMap.values()).reduce((sum, count) => sum + count, 0),
      activeCampaigns,
      totalMessages,
      sentMessages,
      deliveredMessages,
      readMessages,
      failedMessages,
      pendingMessages,
      deliveryRate,
      totalContacts: contactsCount,
      totalSent,
      recentMessages,
      runningCampaigns,
      chipStatuses,
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
