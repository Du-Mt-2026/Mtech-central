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
        chipId: true,
        sentAt: true,
        error: true,
        contactId: true,
        contact: {
          select: { id: true, name: true, phone: true },
        },
      },
    })
    // Flatten contact info for easier consumption
    const result = messages.map(m => ({
      id: m.id,
      status: m.status,
      stepOrder: m.stepOrder,
      content: m.content,
      mediaUrl: m.mediaUrl,
      mediatype: m.mediatype,
      chipId: m.chipId,
      sentAt: m.sentAt,
      error: m.error,
      contactId: m.contactId,
      contactPhone: m.contact?.phone || '',
      contactName: m.contact?.name || '',
    }))
    return NextResponse.json(result)
  } catch (error) {
    console.error('Messages API error:', error)
    return NextResponse.json({ error: 'Erro ao buscar mensagens' }, { status: 500 })
  }
}
