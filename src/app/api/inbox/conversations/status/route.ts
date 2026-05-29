import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(request: NextRequest) {
  try {
    const { chipId, remoteJid, status } = await request.json()
    if (!chipId || !remoteJid || !status) {
      return NextResponse.json({ error: 'chipId, remoteJid e status são obrigatórios' }, { status: 400 })
    }
    const validStatuses = ['open', 'pending', 'resolved', 'snoozed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Status inválido' }, { status: 400 })
    }
    // Use upsert so it works even if the Conversation hasn't been synced yet
    const conversation = await db.conversation.upsert({
      where: { chipId_remoteJid: { chipId, remoteJid } },
      update: { status },
      create: {
        chipId,
        remoteJid,
        status,
        remotePhone: remoteJid.split('@')[0],
        lastMessagePreview: '',
      },
    })
    return NextResponse.json({ success: true, conversation })
  } catch (error) {
    console.error('Conversation status update error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar status' }, { status: 500 })
  }
}
