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
    const conversation = await db.conversation.update({
      where: { chipId_remoteJid: { chipId, remoteJid } },
      data: { status },
    })
    return NextResponse.json({ success: true, conversation })
  } catch (error) {
    console.error('Conversation status update error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar status' }, { status: 500 })
  }
}
