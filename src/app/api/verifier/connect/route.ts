import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const GO_SERVICE_URL = process.env.VERIFIER_SERVICE_URL || 'http://localhost:3002'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chipId } = body

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    // Look up the chip's proxy settings from DB
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
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

    // Call Go service force-reconnect to generate QR code
    const res = await fetch(`${GO_SERVICE_URL}/api/force-reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || 'Erro ao conectar ao serviço WhatsApp' },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Verifier connect error:', error)
    return NextResponse.json(
      { error: 'Erro interno ao conectar ao WhatsApp' },
      { status: 500 }
    )
  }
}
