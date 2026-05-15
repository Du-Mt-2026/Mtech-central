import { fetchOctupusZapInstances, INSTANCE_PREFIX } from '@/lib/evolution-api'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * POST /api/whatsapp/import-instances
 * Import OctupusZap Evolution API instances that are not yet linked to any chip.
 * Only imports instances with the OctupusZap_ prefix.
 * Body: { instanceNames?: string[] } — optional filter, imports all unlinked if empty
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { instanceNames } = body as { instanceNames?: string[] }

    // Fetch only OctupusZap instances from Evolution API
    const instances = await fetchOctupusZapInstances()

    // Get all chips that already have an evolution instance linked
    const existingChips = await db.chip.findMany()
    const existingInstanceNames = new Set(
      existingChips
        .filter(c => c.evolutionInstance)
        .map(c => c.evolutionInstance!)
    )

    // Find unlinked instances (already filtered by prefix)
    let unlinked = instances.filter(inst => !existingInstanceNames.has(inst.name))

    // Filter by requested names if provided
    if (instanceNames && instanceNames.length > 0) {
      // Only allow importing names that have the OctupusZap prefix
      const safeNames = instanceNames.filter(n => n.startsWith(INSTANCE_PREFIX))
      unlinked = unlinked.filter(inst => safeNames.includes(inst.name))
    }

    const imported: Array<{ id: string; name: string; instanceName: string; status: string }> = []
    const skipped: string[] = []

    for (const inst of unlinked) {
      // Determine phone number
      const phoneNumber = inst.number || inst.ownerJid?.replace('@s.whatsapp.net', '') || ''

      // Check if a chip with the same phone number already exists
      if (phoneNumber) {
        const existingByPhone = existingChips.find(c => c.phoneNumber === phoneNumber)
        if (existingByPhone) {
          // Link existing chip to this instance
          const newStatus = inst.connectionStatus === 'open' ? 'connected' : inst.connectionStatus === 'close' ? 'disconnected' : 'connecting'
          await db.chip.update({
            where: { id: existingByPhone.id },
            data: {
              evolutionInstance: inst.name,
              status: newStatus,
              profileName: inst.profileName || existingByPhone.profileName,
              profilePicUrl: inst.profilePicUrl || existingByPhone.profilePicUrl,
              disconnectionReasonCode: inst.disconnectionReasonCode ?? null,
              lastSeen: newStatus === 'connected' ? new Date() : existingByPhone.lastSeen,
            },
          })
          imported.push({
            id: existingByPhone.id,
            name: existingByPhone.name,
            instanceName: inst.name,
            status: newStatus,
          })
          continue
        }
      }

      // Create a new chip for this instance
      const chipName = inst.profileName || inst.name.replace(INSTANCE_PREFIX, '').replace(/_/g, ' ')
      const newStatus = inst.connectionStatus === 'open' ? 'connected' : inst.connectionStatus === 'close' ? 'disconnected' : 'connecting'

      try {
        const chip = await db.chip.create({
          data: {
            name: chipName,
            phoneNumber: phoneNumber || inst.name,
            evolutionInstance: inst.name,
            status: newStatus,
            profileName: inst.profileName,
            profilePicUrl: inst.profilePicUrl,
            disconnectionReasonCode: inst.disconnectionReasonCode ?? null,
            lastSeen: newStatus === 'connected' ? new Date() : undefined,
          },
        })
        imported.push({
          id: chip.id,
          name: chip.name,
          instanceName: inst.name,
          status: newStatus,
        })
      } catch (createError: unknown) {
        console.error(`Failed to create chip for instance ${inst.name}:`, createError)
        skipped.push(inst.name)
      }
    }

    return NextResponse.json({
      imported,
      skipped,
      totalInstances: instances.length,
      alreadyLinked: instances.length - unlinked.length,
      newImports: imported.length,
      prefix: INSTANCE_PREFIX,
    })
  } catch (error) {
    console.error('Error importing instances:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao importar instâncias' },
      { status: 500 }
    )
  }
}
