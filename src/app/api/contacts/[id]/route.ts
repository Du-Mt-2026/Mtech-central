import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const contact = await db.contact.findUnique({
      where: { id },
      include: {
        contactList: { select: { id: true, name: true } },
        chip: { select: { id: true, name: true } },
      },
    })

    if (!contact) {
      return NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 })
    }

    return NextResponse.json(contact)
  } catch (error) {
    console.error('Contact GET by ID error:', error)
    return NextResponse.json({ error: 'Erro ao buscar contato' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, phone } = body

    // Check contact exists
    const existing = await db.contact.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 })
    }

    // Build update data — only allow name and phone
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (phone !== undefined) updateData.phone = phone

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 })
    }

    const updated = await db.contact.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('Contact PATCH error:', error)
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Telefone já existe em outro contato' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro ao atualizar contato' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check contact exists
    const existing = await db.contact.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 })
    }

    // Delete associated messages first
    await db.message.deleteMany({ where: { contactId: id } })
    await db.contact.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact DELETE error:', error)
    return NextResponse.json({ error: 'Erro ao remover contato' }, { status: 500 })
  }
}
