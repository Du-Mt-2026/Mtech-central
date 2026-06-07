import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/setup/seed-default-keys — Create default message keys (BOM_DIA, BOA_TARDE, BOA_NOITE, SAUDACAO)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { secret } = body

    // Security: Require AUTH_SECRET
    if (!process.env.AUTH_SECRET || secret !== process.env.AUTH_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const results: string[] = []

    // Default keys to create
    const defaultKeys = [
      {
        name: 'BOM_DIA',
        label: 'Saudação - Bom dia',
        category: 'saudacao',
        variations: JSON.stringify([
          'Bom dia!',
          'Bom dia, tudo bem?',
          'Oi, bom dia!',
          'Olá, bom dia!',
          'Bom dia! Como vai?',
        ]),
        resolutionType: 'random',
        timeSlots: null,
        isDefault: true,
      },
      {
        name: 'BOA_TARDE',
        label: 'Saudação - Boa tarde',
        category: 'saudacao',
        variations: JSON.stringify([
          'Boa tarde!',
          'Boa tarde, tudo bem?',
          'Oi, boa tarde!',
          'Olá, boa tarde!',
          'Boa tarde! Como vai?',
        ]),
        resolutionType: 'random',
        timeSlots: null,
        isDefault: true,
      },
      {
        name: 'BOA_NOITE',
        label: 'Saudação - Boa noite',
        category: 'saudacao',
        variations: JSON.stringify([
          'Boa noite!',
          'Boa noite, tudo bem?',
          'Oi, boa noite!',
          'Olá, boa noite!',
          'Boa noite! Como vai?',
        ]),
        resolutionType: 'random',
        timeSlots: null,
        isDefault: true,
      },
      {
        name: 'SAUDACAO',
        label: 'Saudação Automática',
        category: 'saudacao',
        variations: JSON.stringify([
          '{{BOM_DIA}}',
          '{{BOA_TARDE}}',
          '{{BOA_NOITE}}',
        ]),
        resolutionType: 'time_based',
        timeSlots: JSON.stringify([
          { key: 'BOM_DIA', start: '06:01', end: '12:00' },
          { key: 'BOA_TARDE', start: '12:01', end: '19:00' },
          { key: 'BOA_NOITE', start: '19:01', end: '06:00' },
        ]),
        isDefault: true,
      },
    ]

    for (const keyData of defaultKeys) {
      const existing = await db.messageKey.findUnique({ where: { name: keyData.name } })
      if (existing) {
        // Update existing default key to ensure it has the correct configuration
        await db.messageKey.update({
          where: { name: keyData.name },
          data: {
            label: keyData.label,
            category: keyData.category,
            variations: keyData.variations,
            resolutionType: keyData.resolutionType,
            timeSlots: keyData.timeSlots,
            isDefault: true,
          },
        })
        results.push(`Atualizada: ${keyData.name}`)
      } else {
        await db.messageKey.create({ data: keyData })
        results.push(`Criada: ${keyData.name}`)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Error seeding default keys:', error)
    return NextResponse.json({ error: 'Erro ao criar chaves padrão' }, { status: 500 })
  }
}
