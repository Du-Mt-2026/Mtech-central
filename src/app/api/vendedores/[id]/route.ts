import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/vendedores/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const vendedor = await db.vendedor.findUnique({
      where: { id },
      include: { chips: true, campaigns: true },
    })
    if (!vendedor) {
      return NextResponse.json({ error: 'Vendedor não encontrado' }, { status: 404 })
    }
    return NextResponse.json(vendedor)
  } catch (error) {
    console.error('Error fetching vendedor:', error)
    return NextResponse.json({ error: 'Erro ao buscar vendedor' }, { status: 500 })
  }
}

// PATCH /api/vendedores/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { nome, empresa, cargo, genero, treatAs, whatsapp, ativo } = body

    const existing = await db.vendedor.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Vendedor não encontrado' }, { status: 404 })
    }

    // Auto-derive treatAs from genero if changed
    let derivedTreatAs = treatAs
    if (genero && genero !== existing.genero && !treatAs) {
      derivedTreatAs = genero === 'feminino' ? 'a' : genero === 'masculino' ? 'o' : 'o(a)'
    }

    const updated = await db.vendedor.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome: nome.trim() }),
        ...(empresa !== undefined && { empresa: empresa?.trim() || null }),
        ...(cargo !== undefined && { cargo: cargo?.trim() || null }),
        ...(genero !== undefined && { genero: genero || null }),
        ...(derivedTreatAs !== undefined && { treatAs: derivedTreatAs || null }),
        ...(whatsapp !== undefined && { whatsapp: whatsapp?.trim() || null }),
        ...(ativo !== undefined && { ativo }),
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating vendedor:', error)
    return NextResponse.json({ error: 'Erro ao atualizar vendedor' }, { status: 500 })
  }
}

// DELETE /api/vendedores/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.vendedor.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Vendedor não encontrado' }, { status: 404 })
    }

    await db.vendedor.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting vendedor:', error)
    return NextResponse.json({ error: 'Erro ao remover vendedor' }, { status: 500 })
  }
}
