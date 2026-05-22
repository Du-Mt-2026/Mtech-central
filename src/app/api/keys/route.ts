import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/keys — List all message keys
export async function GET() {
  try {
    const keys = await db.messageKey.findMany({
      orderBy: [{ category: 'asc' }, { label: 'asc' }],
    })
    return NextResponse.json(keys)
  } catch (error) {
    console.error('Error fetching keys:', error)
    return NextResponse.json({ error: 'Erro ao buscar chaves' }, { status: 500 })
  }
}

// POST /api/keys — Create a new message key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, label, category, variations } = body

    if (!name?.trim() || !label?.trim() || !variations?.length) {
      return NextResponse.json(
        { error: 'Nome, rótulo e variações são obrigatórios' },
        { status: 400 }
      )
    }

    // Validate name format (uppercase, underscores, no spaces)
    const nameClean = name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
    if (!nameClean) {
      return NextResponse.json(
        { error: 'Nome da chave deve conter apenas letras, números e underscores' },
        { status: 400 }
      )
    }

    // Check for duplicate name
    const existing = await db.messageKey.findUnique({ where: { name: nameClean } })
    if (existing) {
      return NextResponse.json(
        { error: `Já existe uma chave com o nome "${nameClean}"` },
        { status: 409 }
      )
    }

    // Validate variations array
    const cleanVariations = variations
      .filter((v: string) => v.trim())
      .map((v: string) => v.trim())

    if (cleanVariations.length === 0) {
      return NextResponse.json(
        { error: 'Adicione pelo menos uma variação' },
        { status: 400 }
      )
    }

    const key = await db.messageKey.create({
      data: {
        name: nameClean,
        label: label.trim(),
        category: category?.trim() || 'geral',
        variations: JSON.stringify(cleanVariations),
      },
    })

    return NextResponse.json(key, { status: 201 })
  } catch (error) {
    console.error('Error creating key:', error)
    return NextResponse.json({ error: 'Erro ao criar chave' }, { status: 500 })
  }
}
