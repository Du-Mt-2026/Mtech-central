import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const GO_SERVICE_URL = process.env.VERIFIER_SERVICE_URL || 'http://localhost:3002'

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

    // Look up the chip's proxy settings from DB
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // Format phone numbers: remove +, spaces, dashes; ensure they start with country code
    const formattedPhones = phones.map((phone: string) => {
      let p = phone.replace(/[\s\-\+\.\(\)]/g, '')
      // If it starts with 0, remove the leading 0 (common in Brazil local format)
      if (p.startsWith('0')) p = p.substring(1)
      // If it doesn't start with 55, add it (Brazil country code)
      if (!p.startsWith('55')) p = '55' + p
      return p
    }).filter((p: string) => p.length >= 10 && p.length <= 15) // basic validation

    if (formattedPhones.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum telefone válido encontrado após formatação' },
        { status: 400 }
      )
    }

    // Build the SOCKS5 proxy URL from chip settings
    let proxy = ''
    if (chip.proxyMode === 'socks5' && chip.socks5Host) {
      const auth = chip.socks5User
        ? `${encodeURIComponent(chip.socks5User)}:${encodeURIComponent(chip.socks5Pass)}@`
        : ''
      const port = chip.socks5Port || 1080
      proxy = `socks5://${auth}${chip.socks5Host}:${port}`
    }

    // First, set the proxy on the Go service if available
    if (proxy) {
      try {
        await fetch(`${GO_SERVICE_URL}/api/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proxyAddr: proxy }),
        })
      } catch {
        // Proxy setup failed, continue anyway
      }
    }

    // Call Go service check-numbers endpoint
    const res = await fetch(`${GO_SERVICE_URL}/api/check-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: formattedPhones }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || 'Erro ao verificar números' },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Verifier check error:', error)
    return NextResponse.json(
      { error: 'Erro interno ao verificar números' },
      { status: 500 }
    )
  }
}
