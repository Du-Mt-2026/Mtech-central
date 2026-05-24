import { getConnectionState, fetchOctupusZapInstances, getInstanceName, INSTANCE_PREFIX } from '@/lib/evolution-api'
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

      const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

      try {
        const connectionState = await getConnectionState(instanceName)
        const state = connectionState.instance?.state || connectionState.state || 'close'

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
        })
      } catch (error) {
        return NextResponse.json({
          chipId: chip.id,
          instanceName,
          state: 'unknown',
          chipStatus: chip.status,
        })
      }
    }

    // No chipId — return all OctupusZap instances and sync statuses in real-time
    const [instances, chips] = await Promise.all([
      fetchOctupusZapInstances().catch(() => []),
      db.chip.findMany(),
    ])

    const instanceMap = new Map<string, any>(
      instances.map((inst: any) => [inst.name, inst] as [string, any])
    )

    // Sync chips that belong to OctupusZap
    for (const chip of chips) {
      if (chip.evolutionInstance && !chip.evolutionInstance.startsWith(INSTANCE_PREFIX)) {
        continue
      }
      const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)
      const evoInstance = instanceMap.get(instanceName)

      if (evoInstance) {
        // Instance exists in Evolution Go — use real-time status
        const newStatus = evoInstance.connected ? 'connected' : 'disconnected'
        if (chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
              evolutionInstance: instanceName,
              ...(newStatus === 'connected' ? { isQrPaired: true } : {}),
            },
          })
        }
      } else if (chip.evolutionInstance) {
        // Instance no longer exists in Evolution Go — mark as disconnected
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
      connected: instances.filter((i: any) => i.connected).length,
      prefix: INSTANCE_PREFIX,
    })
  } catch (error: any) {
    console.error('Status fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
