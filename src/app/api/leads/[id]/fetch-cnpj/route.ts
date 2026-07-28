import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractCnpjFromWebsite, validateCnpj, formatCnpj } from '@/lib/places-client'

/**
 * Busca CNPJ do website do lead e salva no banco.
 *
 * POST /api/leads/[id]/fetch-cnpj
 *   - Faz scraping do website (se existir)
 *   - Extrai CNPJ via regex
 *   - Valida via algoritmo oficial
 *   - Salva no banco
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const lead = await db.lead.findUnique({
      where: { id: (await params).id },
      select: { id: true, name: true, website: true, cnpj: true },
    })

    if (!lead) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
    }

    if (lead.cnpj) {
      return NextResponse.json({
        cnpj: lead.cnpj,
        cnpjFormatted: formatCnpj(lead.cnpj),
        valid: validateCnpj(lead.cnpj),
        source: 'cached',
      })
    }

    if (!lead.website) {
      return NextResponse.json(
        { error: 'Lead não possui website — não é possível buscar CNPJ automaticamente' },
        { status: 400 }
      )
    }

    const cnpj = await extractCnpjFromWebsite(lead.website)

    if (!cnpj) {
      return NextResponse.json({
        cnpj: null,
        message: 'CNPJ não encontrado no website. Tente informar manualmente.',
        website: lead.website,
      })
    }

    const valid = validateCnpj(cnpj)

    // Salvar no banco
    await db.lead.update({
      where: { id: lead.id },
      data: { cnpj },
    })

    return NextResponse.json({
      cnpj,
      cnpjFormatted: formatCnpj(cnpj),
      valid,
      source: 'website',
      website: lead.website,
    })
  } catch (err: any) {
    console.error('[Leads][fetch-cnpj] Error:', err)
    return NextResponse.json(
      { error: 'Erro interno', detail: err.message },
      { status: 500 }
    )
  }
}

/**
 * PATCH — atualizar CNPJ manualmente (input do usuário).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { cnpj } = await req.json()
    if (!cnpj || !validateCnpj(cnpj)) {
      return NextResponse.json(
        { error: 'CNPJ inválido' },
        { status: 400 }
      )
    }

    const clean = cnpj.replace(/\D/g, '')
    await db.lead.update({
      where: { id: (await params).id },
      data: { cnpj: clean },
    })

    return NextResponse.json({
      cnpj: clean,
      cnpjFormatted: formatCnpj(clean),
      valid: true,
      source: 'manual',
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Erro interno', detail: err.message },
      { status: 500 }
    )
  }
}
