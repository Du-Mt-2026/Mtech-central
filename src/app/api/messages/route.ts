import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const chipId = searchParams.get('chipId')
    const status = searchParams.get('status')
    const pageParam = searchParams.get('page')
    const limitParam = searchParams.get('limit')
    const isPaginated = pageParam !== null

    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10) || 50))

    const where: Record<string, unknown> = {}
    if (campaignId) where.campaignId = campaignId
    if (chipId) where.chipId = chipId
    if (status) where.status = status

    if (isPaginated) {
      const [messages, total] = await Promise.all([
        db.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            chip: { select: { name: true, phoneNumber: true } },
            campaign: { select: { name: true } },
            contact: { select: { name: true, phone: true } },
          },
        }),
        db.message.count({ where }),
      ])

      return NextResponse.json({
        data: messages,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    }

    // Backward-compatible: plain array (with existing take: 200 cap)
    const messages = await db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        chip: { select: { name: true, phoneNumber: true } },
        campaign: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
      },
      take: 5000,
    })

    return NextResponse.json({ data: messages, total: await db.message.count({ where }) })
  } catch (error) {
    console.error('Messages GET error:', error)
    return NextResponse.json({ error: 'Erro ao buscar mensagens' }, { status: 500 })
  }
}
