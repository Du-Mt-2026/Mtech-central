import { fetchInstances } from '@/lib/evolution-api'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * POST /api/whatsapp/import-instances
 * Import Evolution API instances that are not yet linked to any chip.
 * Creates new chips for each unlinked instance.
 * Body: { instanceNames?: string[] } — optional filter, imports all if empty
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { instanceNames } = body as { instanceNames?: string[] }

    // Fetch all instances from Evolution API
    const instances = await fetchInstances()

    // Get all chips that already have an evolution instance linked
    const existingChips = await db.chip.findMany()
    const existingInstanceNames = new Set(
      existingChips
        .filter(c => c.evolutionInstance)
        .map(c => c.evolutionInstance!)
    )

    // Find unlinked instances
    let unlinked = instances.filter(inst => !existingInstanceNames.has(inst.name))

    // Filter by requested names if provided
    if (instanceNames && instanceNames.length > 0) {
      unlinked = unlinked.filter(inst => instanceNames.includes(inst.name))
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
      const chipName = inst.profileName || inst.name.replace(/_/g, ' ')
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
    })
  } catch (error) {
    console.error('Error importing instances:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao importar instâncias' },
      { status: 500 }
    )
  }
}
