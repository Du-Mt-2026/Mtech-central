import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const { contactIds } = await req.json() // Array of contact IDs in desired order

    if (!Array.isArray(contactIds)) {
      return NextResponse.json({ error: 'contactIds must be an array' }, { status: 400 })
    }

    // Update positions in batch
    const updates = contactIds.map((contactId: string, index: number) =>
      db.contact.update({
        where: { id: contactId },
        data: { position: index },
      })
    )

    await db.$transaction(updates)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Reorder error:', error)
    return NextResponse.json({ error: 'Erro ao reordenar contatos' }, { status: 500 })
  }
}
