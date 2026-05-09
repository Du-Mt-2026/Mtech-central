import { getConnectionState, fetchInstances, getInstanceName } from '@/lib/evolution-api'
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

      const instanceName = getInstanceName(chip.id, chip.name)

      try {
        const connectionState = await getConnectionState(instanceName)
        const state = connectionState.instance.state

        const newStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
        if (chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chipId },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
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

    // No chipId — return all instances and sync statuses
    const [instances, chips] = await Promise.all([
      fetchInstances().catch(() => []),
      db.chip.findMany(),
    ])

    const instanceMap = new Map(
      instances.map((inst) => [inst.name, inst.connectionStatus])
    )

    for (const chip of chips) {
      const instanceName = getInstanceName(chip.id, chip.name)
      const instanceState = instanceMap.get(instanceName)
      if (instanceState) {
        const newStatus = instanceState === 'open' ? 'connected' : 'disconnected'
        if (chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
            },
          })
        }
      }
    }

    return NextResponse.json({
      instances,
      chips: await db.chip.findMany(),
      total: instances.length,
      connected: instances.filter((i: any) => i.connectionStatus === 'open').length,
    })
  } catch (error: any) {
    console.error('Status fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
