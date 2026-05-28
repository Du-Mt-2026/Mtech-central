import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Unblock a previously blocked contact.
 * This allows the user to override a false positive detection.
 * The system won't auto-re-block this contact again.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const reason = body.reason || 'Desbloqueado manualmente'

    const blocked = await db.blockedContact.findUnique({ where: { id } })

    if (!blocked) {
      return NextResponse.json({ error: 'Contato bloqueado não encontrado' }, { status: 404 })
    }

    if (blocked.unblockedAt) {
      return NextResponse.json({ error: 'Contato já foi desbloqueado' }, { status: 400 })
    }

    await db.blockedContact.update({
      where: { id },
      data: {
        unblockedAt: new Date(),
        unblockReason: reason,
      },
    })

    console.log(`[BlockedContacts] Unblocked ${blocked.contactPhone} from chip ${blocked.chipId} — reason: ${reason}`)

    return NextResponse.json({ ok: true, message: `Contato ${blocked.contactPhone} desbloqueado` })
  } catch (error: any) {
    console.error('[BlockedContacts] Unblock error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
