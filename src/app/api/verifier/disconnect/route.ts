import { NextResponse } from 'next/server'

const GO_SERVICE_URL = 'http://localhost:3002'

export async function POST() {
  try {
    const res = await fetch(`${GO_SERVICE_URL}/api/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || 'Erro ao desconectar' },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Verifier disconnect error:', error)
    return NextResponse.json(
      { error: 'Erro interno ao desconectar' },
      { status: 500 }
    )
  }
}
