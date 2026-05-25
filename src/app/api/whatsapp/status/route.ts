import { getConnectionState, fetchAllInstances, getApiVersion } from '@/lib/evolution-router'
import { getInstanceName as v3GetInstanceName, INSTANCE_PREFIX } from '@/lib/evolution-api'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId')

    if (chipId) {
      const chip = await db.chip.findUnique({ where: { id: chipId } })
      if (!chip) {
        return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
      }

      const apiVersion = getApiVersion(chip)

      // Build instance name based on API version
      let instanceName: string
      if (apiVersion === 'v2') {
        instanceName = chip.evolutionInstance || chip.name.replace(/[^a-zA-Z0-9]/g, '_')
      } else {
        instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)
      }

      try {
        const connectionState = await getConnectionState(instanceName, apiVersion)
        const state = connectionState.state || 'close'

        const newStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
        if (chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chipId },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
              evolutionInstance: instanceName,
              ...(newStatus === 'connected' ? { isQrPaired: true } : {}),
            },
          })
        }

        return NextResponse.json({
          chipId: chip.id,
          instanceName,
          state,
          chipStatus: newStatus,
          apiVersion,
        })
      } catch (error) {
        return NextResponse.json({
          chipId: chip.id,
          instanceName,
          state: 'unknown',
          chipStatus: chip.status,
          apiVersion,
        })
      }
    }

    // No chipId — return all instances from BOTH v2 and v3 and sync statuses in real-time
    const [instances, chips] = await Promise.all([
      fetchAllInstances().catch(() => []),
      db.chip.findMany(),
    ])

    const instanceMap = new Map<string, any>(
      instances.map((inst: any) => [inst.name, inst] as [string, any])
    )

    // Sync chips status based on real-time data from both APIs
    for (const chip of chips) {
      const chipApiVersion = getApiVersion(chip)

      // Skip chips that are clearly on v2 and don't have OctupusZap_ prefix
      if (chipApiVersion === 'v3' && chip.evolutionInstance && !chip.evolutionInstance.startsWith(INSTANCE_PREFIX)) {
        continue
      }

      let instanceName: string
      if (chipApiVersion === 'v2') {
        instanceName = chip.evolutionInstance || chip.name.replace(/[^a-zA-Z0-9]/g, '_')
      } else {
        instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)
      }

      const evoInstance = instanceMap.get(instanceName)

      if (evoInstance) {
        // Instance exists — use real-time status
        const newStatus = evoInstance.connected || evoInstance.connectionStatus === 'open' ? 'connected' : 'disconnected'
        if (chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
              evolutionInstance: instanceName,
              evolutionApiVersion: evoInstance.apiVersion || chipApiVersion,
              ...(newStatus === 'connected' ? { isQrPaired: true } : {}),
            },
          })
        }
      } else if (chip.evolutionInstance && chip.evolutionInstance.startsWith(INSTANCE_PREFIX)) {
        // v3 instance no longer exists — mark as disconnected
        if (chip.status !== 'disconnected') {
          await db.chip.update({
            where: { id: chip.id },
            data: { status: 'disconnected', isQrPaired: false },
          })
        }
      }
    }

    return NextResponse.json({
      instances,
      chips: await db.chip.findMany(),
      total: instances.length,
      connected: instances.filter((i: any) => i.connected || i.connectionStatus === 'open').length,
      prefix: INSTANCE_PREFIX,
    })
  } catch (error: any) {
    console.error('Status fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
