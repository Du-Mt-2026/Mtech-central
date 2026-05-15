import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { testConnection, getConnectionState, getInstanceName, fetchOctupusZapInstances } from '@/lib/evolution-api'

export async function GET() {
  try {
    // 1) Test if Evolution API is reachable at all
    const evolutionTest = await testConnection()

    if (!evolutionTest.success) {
      return NextResponse.json({
        goService: { status: 'unreachable', error: evolutionTest.error },
        connection: { connected: false, status: 'unreachable' },
        serviceAvailable: false,
      }, { status: 503 })
    }

    // 2) Find the first connected OctupusZap instance to use as verifier
    const instances = await fetchOctupusZapInstances()
    const connectedInstance = instances.find(
      (inst: any) => inst.connectionStatus === 'open'
    )

    if (!connectedInstance) {
      return NextResponse.json({
        goService: { status: 'ok', source: 'evolution-api' },
        connection: {
          connected: false,
          status: 'no_connected_instance',
          phoneNumber: '',
          pairingCode: '',
          qrExpired: false,
        },
        serviceAvailable: true,
        instanceCount: instances.length,
      })
    }

    // 3) Get detailed connection state of the connected instance
    let detailedState = 'open'
    let phoneNumber = ''
    try {
      const stateRes = await getConnectionState(connectedInstance.name)
      detailedState = stateRes.instance?.state || 'open'
      phoneNumber = connectedInstance.ownerJid?.replace('@s.whatsapp.net', '') || ''
    } catch {
      // state check failed, but we know from fetchInstances it's open
    }

    // 4) Also update the chip status in DB
    try {
      const chip = await db.chip.findFirst({
        where: { evolutionInstance: connectedInstance.name },
      })
      if (chip && chip.status !== 'connected') {
        await db.chip.update({
          where: { id: chip.id },
          data: {
            status: 'connected',
            lastSeen: new Date(),
            isQrPaired: true,
          },
        })
      }
    } catch {
      // DB update not critical
    }

    const isConnected = detailedState === 'open'

    return NextResponse.json({
      goService: { status: 'ok', source: 'evolution-api' },
      connection: {
        connected: isConnected,
        status: isConnected ? 'connected' : 'disconnected',
        phoneNumber,
        instanceName: connectedInstance.name,
        pairingCode: '',
        qrExpired: false,
      },
      serviceAvailable: true,
      instanceCount: instances.length,
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
