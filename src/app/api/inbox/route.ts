import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const instanceName = searchParams.get('instanceName') || undefined
    const search = searchParams.get('search') || undefined

    const where: Record<string, unknown> = {}
    if (instanceName) where.instanceName = instanceName
    if (search) {
      where.OR = [
        { messageContent: { contains: search, mode: 'insensitive' } },
        { pushName: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [messages, total] = await Promise.all([
      db.inboxMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.inboxMessage.count({ where }),
    ])

    return NextResponse.json({
      messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('Inbox GET error:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar mensagens da caixa de entrada' },
      { status: 500 }
    )
  }
}
