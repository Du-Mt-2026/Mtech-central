import { NextResponse } from 'next/server'
import { fetchAllInstances, getApiVersion } from '@/lib/evolution-router'
import { getInstanceName as v3GetInstanceName, INSTANCE_PREFIX } from '@/lib/evolution-api'
import { db } from '@/lib/db'

export async function GET() {
  try {
    // Fetch instances from BOTH v2 and v3 APIs
    const instances = await fetchAllInstances()

    // Create a map of instance name -> instance data
    const instanceMap = new Map<string, any>()
    for (const inst of instances) {
      instanceMap.set(inst.name, inst)
    }

    // Fetch all chips from our database
    const chips = await db.chip.findMany()

    // Update chip statuses based on real-time data from both APIs
    const updatedChips: any[] = []
    for (const chip of chips) {
      const chipApiVersion = getApiVersion(chip)

      // Build instance name based on API version
      let instanceName: string
      if (chipApiVersion === 'v2') {
        instanceName = chip.evolutionInstance || chip.name.replace(/[^a-zA-Z0-9]/g, '_')
      } else {
        instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)
      }

      const evoInstance = instanceMap.get(instanceName)

      let evoStatus = 'close'
      let newStatus = 'disconnected'

      if (evoInstance) {
        evoStatus = evoInstance.connected || evoInstance.connectionStatus === 'open' ? 'open' : 'close'
        newStatus = evoInstance.connected || evoInstance.connectionStatus === 'open' ? 'connected' : 'disconnected'
      } else if (chip.evolutionInstance && chip.evolutionInstance.startsWith(INSTANCE_PREFIX)) {
        // v3 instance no longer exists
        evoStatus = 'close'
        newStatus = 'disconnected'
      }

      // Update chip in database if status changed
      if (chip.status !== newStatus || !chip.evolutionInstance) {
        await db.chip.update({
          where: { id: chip.id },
          data: {
            status: newStatus,
            lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
            evolutionInstance: instanceName,
            evolutionApiVersion: evoInstance?.apiVersion || chipApiVersion,
            ...(newStatus === 'connected' ? { isQrPaired: true } : {}),
          },
        })
      }

      updatedChips.push({
        ...chip,
        status: newStatus,
        evoInstanceName: instanceName,
        evoStatus,
        apiVersion: evoInstance?.apiVersion || chipApiVersion,
        profileName: evoInstance?.profileName || chip.profileName,
        profilePicUrl: evoInstance?.profilePicUrl || chip.profilePicUrl,
      })
    }

    return NextResponse.json({
      instances,
      chips: updatedChips,
      total: instances.length,
      connected: instances.filter((i: any) => i.connected || i.connectionStatus === 'open').length,
      prefix: INSTANCE_PREFIX,
    })
  } catch (error: any) {
    console.error('Instances fetch error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar instâncias' },
      { status: 500 }
    )
  }
}
