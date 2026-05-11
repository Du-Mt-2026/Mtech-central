import { NextResponse } from 'next/server'

const GO_SERVICE_URL = process.env.VERIFIER_SERVICE_URL || 'http://localhost:3002'

export async function GET() {
  try {
    const [healthRes, connectionRes] = await Promise.allSettled([
      fetch(`${GO_SERVICE_URL}/api/health`),
      fetch(`${GO_SERVICE_URL}/api/status`),
    ])

    const health = healthRes.status === 'fulfilled' && healthRes.value.ok
      ? await healthRes.value.json()
      : { status: 'unreachable' }

    const connection = connectionRes.status === 'fulfilled' && connectionRes.value.ok
      ? await connectionRes.value.json()
      : { connected: false, status: 'unreachable' }

    // Normalize the connection status from Go service format
    const isConnected = connection.connected === true || connection.status === 'connected'

    return NextResponse.json({
      goService: health,
      connection: {
        connected: isConnected,
        status: connection.status || 'unknown',
        phoneNumber: connection.phoneNumber || '',
        pairingCode: connection.pairingCode || '',
        qrExpired: connection.qrExpired || false,
      },
      serviceAvailable: healthRes.status === 'fulfilled' && healthRes.value.ok,
    })
  } catch (error) {
    console.error('Verifier status error:', error)
    return NextResponse.json({
      goService: { status: 'unreachable' },
      connection: { connected: false },
      serviceAvailable: false,
    }, { status: 503 })
  }
}
