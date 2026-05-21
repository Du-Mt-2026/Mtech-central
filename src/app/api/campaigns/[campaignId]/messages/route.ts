import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const messages = await db.message.findMany({
      where: { campaignId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        stepOrder: true,
        content: true,
        mediaUrl: true,
        mediatype: true,
        contactPhone: true,
        chipId: true,
        sentAt: true,
        error: true,
        contactId: true,
      },
    })
    return NextResponse.json(messages)
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar mensagens' }, { status: 500 })
  }
}
