import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/keys/[id] — Get a single key
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const key = await db.messageKey.findUnique({ where: { id } })
    if (!key) {
      return NextResponse.json({ error: 'Chave não encontrada' }, { status: 404 })
    }
    return NextResponse.json(key)
  } catch (error) {
    console.error('Error fetching key:', error)
    return NextResponse.json({ error: 'Erro ao buscar chave' }, { status: 500 })
  }
}

// PATCH /api/keys/[id] — Update a key
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, label, category, variations, resolutionType, timeSlots } = body

    const existing = await db.messageKey.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Chave não encontrada' }, { status: 404 })
    }

    // If name is being changed, check for duplicates
    if (name && name !== existing.name) {
      const nameClean = name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
      const duplicate = await db.messageKey.findUnique({ where: { name: nameClean } })
      if (duplicate && duplicate.id !== id) {
        return NextResponse.json(
          { error: `Já existe uma chave com o nome "${nameClean}"` },
          { status: 409 }
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) {
      updateData.name = name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
    }
    if (label !== undefined) updateData.label = label.trim()
    if (category !== undefined) updateData.category = category.trim() || 'geral'
    if (variations !== undefined) {
      const cleanVariations = variations
        .filter((v: string) => v.trim())
        .map((v: string) => v.trim())
      if (cleanVariations.length === 0) {
        return NextResponse.json(
          { error: 'Adicione pelo menos uma variação' },
          { status: 400 }
        )
      }
      updateData.variations = JSON.stringify(cleanVariations)
    }
    if (resolutionType !== undefined) {
      updateData.resolutionType = resolutionType === 'time_based' ? 'time_based' : 'random'
    }
    if (timeSlots !== undefined) {
      if (Array.isArray(timeSlots) && timeSlots.length > 0) {
        for (const slot of timeSlots) {
          if (!slot.key || !slot.start || !slot.end) {
            return NextResponse.json(
              { error: 'Cada período precisa de chave, horário de início e fim' },
              { status: 400 }
            )
          }
          const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/
          if (!timeRegex.test(slot.start) || !timeRegex.test(slot.end)) {
            return NextResponse.json(
              { error: `Horário inválido: ${slot.start} - ${slot.end}. Use formato HH:MM` },
              { status: 400 }
            )
          }
        }
        updateData.timeSlots = JSON.stringify(timeSlots)
      } else {
        updateData.timeSlots = null
      }
    }

    const updated = await db.messageKey.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating key:', error)
    return NextResponse.json({ error: 'Erro ao atualizar chave' }, { status: 500 })
  }
}

// DELETE /api/keys/[id] — Delete a key
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.messageKey.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Chave não encontrada' }, { status: 404 })
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { error: 'Chaves padrão do sistema não podem ser removidas' },
        { status: 403 }
      )
    }

    await db.messageKey.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting key:', error)
    return NextResponse.json({ error: 'Erro ao remover chave' }, { status: 500 })
  }
}
