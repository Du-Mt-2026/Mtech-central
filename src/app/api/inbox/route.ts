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

    // Get all connected chips
    const chips = await db.chip.findMany({
      where: {
        status: { in: ['connected', 'connecting', 'disconnected', 'banned'] },
      },
      orderBy: [
        { status: 'asc' }, // connected first
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

    // For each chip, get conversation count and unread count
    const chipsWithStats = await Promise.all(
      chips.map(async (chip) => {
        const [conversationCount, unreadCount, lastMessageAt] = await Promise.all([
          // Count distinct conversations (remoteJid)
          db.inboxMessage.groupBy({
            by: ['remoteJid'],
            where: { chipId: chip.id, isGroup: false },
            _count: true,
          }).then(r => r.length),

          // Count unread messages
          db.inboxMessage.count({
            where: { chipId: chip.id, isRead: false, fromMe: false, isGroup: false },
          }),

          // Last message timestamp
          db.inboxMessage.findFirst({
            where: { chipId: chip.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }).then(r => r?.createdAt || null),
        ])

        return {
          ...chip,
          conversationCount,
          unreadCount,
          lastMessageAt,
        }
      })
    )

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
