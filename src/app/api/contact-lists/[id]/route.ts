import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const list = await db.contactList.findUnique({
      where: { id },
      include: {
        contacts: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { contacts: true, campaigns: true },
        },
      },
    })
    if (!list) {
      return NextResponse.json({ error: 'Lista não encontrada' }, { status: 404 })
    }
    return NextResponse.json(list)
  } catch (error) {
    console.error('ContactList GET error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    // Remove contactListId from contacts
    await db.contact.updateMany({
      where: { contactListId: id },
      data: { contactListId: null },
    })
    // Remove contactListId from campaigns
    await db.campaign.updateMany({
      where: { contactListId: id },
      data: { contactListId: null },
    })
    await db.contactList.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('ContactList DELETE error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
