import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { evolutionFetch, getInstanceName } from '@/lib/evolution-api'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phones, chipId } = body

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json(
        { error: 'Lista de telefones é obrigatória' },
        { status: 400 }
      )
    }

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    // Look up the chip's proxy settings and Evolution instance from DB
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // Determine the Evolution instance name
    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Format phone numbers: remove +, spaces, dashes; ensure they start with country code
    const formattedPhones = phones.map((phone: string) => {
      let p = phone.replace(/[\s\-\+\.\(\)]/g, '')
      if (p.startsWith('0')) p = p.substring(1)
      if (!p.startsWith('55')) p = '55' + p
      return p
    }).filter((p: string) => p.length >= 10 && p.length <= 15)

    if (formattedPhones.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum telefone válido encontrado após formatação' },
        { status: 400 }
      )
    }

    // Call Evolution API's whatsappNumbers endpoint to check which numbers exist
    // POST /chat/whatsappNumbers/{instanceName}
    // Body: { numbers: ["5511999999999", "5511888888888"] }
    const res = await evolutionFetch(`/chat/whatsappNumbers/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: formattedPhones }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || data.message || 'Erro ao verificar números na Evolution API' },
        { status: res.status }
      )
    }

    // Evolution API returns an array of results like:
    // [{ exists: true, jid: "55119...@s.whatsapp.net", name: "João" }, ...]
    // Or: [{ number: "55119...", exists: false }, ...]
    // Normalize to the format the frontend expects
    let results: Array<{ number: string; exists: boolean; jid?: string; name?: string; error?: string }>

    if (Array.isArray(data)) {
      results = data.map((item: any, idx: number) => ({
        number: item.number || formattedPhones[idx] || '',
        exists: item.exists === true,
        jid: item.jid || '',
        name: item.name || '',
        error: item.error || (!item.exists ? 'not_on_whatsapp' : ''),
      }))
    } else if (data.results && Array.isArray(data.results)) {
      results = data.results.map((item: any, idx: number) => ({
        number: item.number || formattedPhones[idx] || '',
        exists: item.exists === true,
        jid: item.jid || '',
        name: item.name || '',
        error: item.error || (!item.exists ? 'not_on_whatsapp' : ''),
      }))
    } else {
      // Fallback: return all as unable to verify
      results = formattedPhones.map(phone => ({
        number: phone,
        exists: false,
        jid: '',
        name: '',
        error: 'unknown_response_format',
      }))
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Verifier check error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao verificar números' },
      { status: 500 }
    )
  }
}
