import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { contactIds } = await req.json()

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json({ error: 'contactIds must be a non-empty array' }, { status: 400 })
    }

    const result = await db.contact.deleteMany({
      where: { id: { in: contactIds } },
    })

    return NextResponse.json({ deleted: result.count })
  } catch (error) {
    console.error('Bulk delete error:', error)
    return NextResponse.json({ error: 'Erro ao excluir contatos' }, { status: 500 })
  }
}
