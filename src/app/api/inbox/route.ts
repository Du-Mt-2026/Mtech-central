import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inbox
 * Returns chips with conversation summary for the inbox sidebar
 *
 * Query params:
 * - search: search by chip name, contact name, or phone
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || undefined

    // Get all chips (not just connected - show all so user can see status)
    const chips = await db.chip.findMany({
      orderBy: [
        { status: 'asc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        status: true,
        profilePicUrl: true,
        profileName: true,
        evolutionInstance: true,
      },
    })

    // Get stats for ALL chips in a single query using groupBy
    // IMPORTANT: Only count non-campaign messages (isCampaign: false)
    // Campaign messages are blast messages, not real conversations
    const conversationsPerChip = await db.inboxMessage.groupBy({
      by: ['chipId', 'remoteJid'],
      where: { chipId: { not: null }, isGroup: false, isCampaign: false },
    })
    const convCountMap = new Map<string, number>()
    for (const row of conversationsPerChip) {
      if (row.chipId) {
        convCountMap.set(row.chipId, (convCountMap.get(row.chipId) || 0) + 1)
      }
    }

    // Unread count per chip (only non-campaign messages)
    const unreadPerChip = await db.inboxMessage.groupBy({
      by: ['chipId'],
      where: { chipId: { not: null }, isRead: false, fromMe: false, isGroup: false, isCampaign: false },
      _count: { id: true },
    })
    const unreadMap = new Map<string, number>()
    for (const row of unreadPerChip) {
      if (row.chipId) {
        unreadMap.set(row.chipId, row._count.id)
      }
    }

    // Last message per chip (only non-campaign)
    const lastMsgPerChip = await db.inboxMessage.groupBy({
      by: ['chipId'],
      where: { chipId: { not: null }, isCampaign: false },
      _max: { createdAt: true },
    })
    const lastMsgMap = new Map<string, Date>()
    for (const row of lastMsgPerChip) {
      if (row.chipId && row._max.createdAt) {
        lastMsgMap.set(row.chipId, row._max.createdAt)
      }
    }

    // Build final result
    const chipsWithStats = chips.map(chip => ({
      ...chip,
      conversationCount: convCountMap.get(chip.id) || 0,
      unreadCount: unreadMap.get(chip.id) || 0,
      lastMessageAt: lastMsgMap.get(chip.id)?.toISOString() || null,
    }))

    // Filter by search if provided
    const filtered = search
      ? chipsWithStats.filter(c =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.phoneNumber.includes(search) ||
          (c.profileName || '').toLowerCase().includes(search.toLowerCase())
        )
      : chipsWithStats

    return NextResponse.json({ chips: filtered })
  } catch (error) {
    console.error('Inbox GET error:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar chips da caixa de entrada' },
      { status: 500 }
    )
  }
}
