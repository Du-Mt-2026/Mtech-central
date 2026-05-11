import { NextResponse } from 'next/server'

const GO_SERVICE_URL = process.env.VERIFIER_SERVICE_URL || 'http://localhost:3002'

export async function GET() {
  try {
    const res = await fetch(`${GO_SERVICE_URL}/api/qr`)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: data.error || 'Erro ao obter QR Code' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Verifier QR error:', error)
    return NextResponse.json(
      { error: 'Erro interno ao obter QR Code' },
      { status: 500 }
    )
  }
}
