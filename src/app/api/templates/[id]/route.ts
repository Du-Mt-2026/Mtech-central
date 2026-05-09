import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, content, category } = body

    // Check template exists
    const existing = await db.messageTemplate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }

    // Build update data — only allow name, content, category
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (content !== undefined) updateData.content = content
    if (category !== undefined) updateData.category = category

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 })
    }

    const updated = await db.messageTemplate.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('Template PATCH error:', error)
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um template com esse nome' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro ao atualizar template' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check template exists
    const existing = await db.messageTemplate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }

    await db.messageTemplate.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Template DELETE error:', error)
    return NextResponse.json({ error: 'Erro ao remover template' }, { status: 500 })
  }
}
