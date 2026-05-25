import { fetchAllInstances, setWebhook as routerSetWebhook } from '@/lib/evolution-router'
import { INSTANCE_PREFIX } from '@/lib/evolution-api'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * POST /api/whatsapp/import-instances
 * Import Evolution Go (v3) instances that are not yet linked to any chip.
 * Only imports instances with the OctupusZap_ prefix.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { instanceNames } = body as { instanceNames?: string[] }

    // Fetch instances from Evolution Go (v3) API
    const instances = await fetchAllInstances()

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
      const phoneNumber = inst.ownerJid?.replace('@s.whatsapp.net', '') || ''

      // Check if a chip with the same phone number already exists
      if (phoneNumber) {
        const existingByPhone = existingChips.find(c => c.phoneNumber === phoneNumber)
        if (existingByPhone) {
          // Link existing chip to this instance
          const newStatus = inst.connected || inst.connectionStatus === 'open' ? 'connected' : 'disconnected'
          await db.chip.update({
            where: { id: existingByPhone.id },
            data: {
              evolutionInstance: inst.name,
              evolutionApiVersion: 'v3',
              status: newStatus,
              profileName: inst.profileName || existingByPhone.profileName,
              profilePicUrl: inst.profilePicUrl || existingByPhone.profilePicUrl,
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
      const newStatus = inst.connected || inst.connectionStatus === 'open' ? 'connected' : 'disconnected'

      try {
        const chip = await db.chip.create({
          data: {
            name: chipName,
            phoneNumber: phoneNumber || inst.name,
            evolutionInstance: inst.name,
            evolutionApiVersion: 'v3',
            status: newStatus,
            profileName: inst.profileName,
            profilePicUrl: inst.profilePicUrl,
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

    // Configure webhooks for all imported instances (non-blocking)
    if (imported.length > 0) {
      configureWebhooksForImported(imported).catch(err => {
        console.error('[Import] Background webhook configuration failed:', err)
      })
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

/**
 * Configure webhooks for all imported instances in the background.
 */
async function configureWebhooksForImported(imported: Array<{ instanceName: string }>) {
  const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`
  for (const item of imported) {
    try {
      await routerSetWebhook(item.instanceName, 'v3', webhookUrl)
      console.log(`[Import] Webhook configured for ${item.instanceName}`)
    } catch (err) {
      console.error(`[Import] Failed to configure webhook for ${item.instanceName}:`, err)
    }
  }
}
