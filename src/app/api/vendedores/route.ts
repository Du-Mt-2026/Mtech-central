import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/vendedores — List all vendedores
export async function GET() {
  try {
    const vendedores = await db.vendedor.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      include: {
        _count: { select: { chips: true, campaigns: true } },
      },
    })
    return NextResponse.json(vendedores)
  } catch (error) {
    console.error('Error fetching vendedores:', error)
    return NextResponse.json({ error: 'Erro ao buscar vendedores' }, { status: 500 })
  }
}

// POST /api/vendedores — Create a new vendedor
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nome, empresa, cargo, genero, treatAs, whatsapp, ativo } = body

    if (!nome?.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    // Auto-derive treatAs from genero if not provided
    let derivedTreatAs = treatAs
    if (!derivedTreatAs && genero) {
      derivedTreatAs = genero === 'feminino' ? 'a' : genero === 'masculino' ? 'o' : 'o(a)'
    }

    const vendedor = await db.vendedor.create({
      data: {
        nome: nome.trim(),
        empresa: empresa?.trim() || null,
        cargo: cargo?.trim() || null,
        genero: genero || null,
        treatAs: derivedTreatAs || null,
        whatsapp: whatsapp?.trim() || null,
        ativo: ativo !== undefined ? ativo : true,
      },
    })

    return NextResponse.json(vendedor, { status: 201 })
  } catch (error) {
    console.error('Error creating vendedor:', error)
    return NextResponse.json({ error: 'Erro ao criar vendedor' }, { status: 500 })
  }
}
