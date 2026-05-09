import { NextResponse } from 'next/server'
import { fetchInstances, getConnectionState, getInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'

export async function GET() {
  try {
    // Fetch all Evolution API instances
    const instances = await fetchInstances()

    // Create a map of instance name -> connection status
    const instanceMap = new Map<string, any>()
    for (const inst of instances) {
      instanceMap.set(inst.name, inst)
    }

    // Fetch all chips from our database
    const chips = await db.chip.findMany()

    // Update chip statuses based on Evolution API
    const updatedChips = []
    for (const chip of chips) {
      const instanceName = getInstanceName(chip.id, chip.name)
      const evoInstance = instanceMap.get(instanceName)

      const evoStatus = evoInstance?.connectionStatus || 'close'
      const newStatus = evoStatus === 'open' ? 'connected' : evoStatus === 'connecting' ? 'connecting' : 'disconnected'

      // Update chip in database if status changed
      if (chip.status !== newStatus) {
        await db.chip.update({
          where: { id: chip.id },
          data: {
            status: newStatus,
            lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
          },
        })
      }

      updatedChips.push({
        ...chip,
        status: newStatus,
        evoInstanceName: instanceName,
        evoStatus,
        profileName: evoInstance?.profileName || null,
        profilePicUrl: evoInstance?.profilePicUrl || null,
      })
    }

    return NextResponse.json({
      instances,
      chips: updatedChips,
      total: instances.length,
      connected: instances.filter((i: any) => i.connectionStatus === 'open').length,
    })
  } catch (error: any) {
    console.error('Instances fetch error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar instâncias' },
      { status: 500 }
    )
  }
}
