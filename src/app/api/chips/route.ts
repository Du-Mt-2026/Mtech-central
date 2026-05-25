import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateWireGuardIp,
  generateSocksPort,
  generateWireGuardKeys,
} from '@/lib/wireguard'
import { addWireGuardPeer } from '@/lib/wireguard-peer-api'
import { deleteInstance, disconnectInstance, getInstanceName, fetchOctupusZapInstances, INSTANCE_PREFIX, isOctupusZapInstance } from '@/lib/evolution-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'

/**
 * One-time cleanup: delete old chips from the v2 era that don't have the OctupusZap_ prefix.
 * These chips no longer have instances in any Evolution server and should be removed.
 * Runs in the background on each GET request until all old chips are gone.
 */
async function cleanupOldChips() {
  try {
    // Find chips that have an evolutionInstance but NOT with OctupusZap_ prefix
    const oldChips = await db.chip.findMany({
      where: {
        evolutionInstance: { not: null },
        NOT: {
          evolutionInstance: { startsWith: INSTANCE_PREFIX },
        },
      },
      select: { id: true, evolutionInstance: true },
    })

    if (oldChips.length === 0) return

    console.log(`[Chips Cleanup] Found ${oldChips.length} old chips without ${INSTANCE_PREFIX} prefix, deleting...`)

    for (const chip of oldChips) {
      // Delete related records first (same as DELETE handler)
      await db.message.deleteMany({ where: { chipId: chip.id } }).catch(() => {})
      await db.contact.deleteMany({ where: { chipId: chip.id } }).catch(() => {})
      await db.campaignChip.deleteMany({ where: { chipId: chip.id } }).catch(() => {})
      await db.inboxMessage.deleteMany({ where: { chipId: chip.id } }).catch(() => {})
      await db.chip.delete({ where: { id: chip.id } }).catch(() => {})
      console.log(`[Chips Cleanup] Deleted old chip: ${chip.evolutionInstance} (${chip.id})`)
    }

    console.log(`[Chips Cleanup] Finished deleting ${oldChips.length} old chips`)
  } catch (error) {
    console.error('[Chips Cleanup] Error:', error)
  }
}

export async function GET() {
  try {
    // Reset daily counters for all chips if a new day has started
    const now = new Date()
    const timezone = 'America/Sao_Paulo'
    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      timeZone: timezone,
    })
    const nowDateStr = formatter.format(now)

    const allChips = await db.chip.findMany({
      select: { id: true, lastResetAt: true, lastHourlyResetAt: true, hourlySent: true, sentToday: true },
    })

    for (const chip of allChips) {
      const lastReset = new Date(chip.lastResetAt)
      const lastDateStr = formatter.format(lastReset)

      // Daily reset
      if (nowDateStr !== lastDateStr) {
        await db.chip.update({
          where: { id: chip.id },
          data: {
            sentToday: 0,
            verifiedToday: 0,
            lastResetAt: now,
            lastVerifiedResetAt: now,
            hourlySent: 0,
            lastHourlyResetAt: now,
          },
        })
      } else {
        // Same day — check hourly reset
        const lastHourlyReset = new Date(chip.lastHourlyResetAt ?? chip.lastResetAt)
        const hoursSinceReset = (now.getTime() - lastHourlyReset.getTime()) / (1000 * 60 * 60)
        if (hoursSinceReset >= 1 && chip.hourlySent > 0) {
          await db.chip.update({
            where: { id: chip.id },
            data: { hourlySent: 0, lastHourlyResetAt: now },
          })
        }
      }
    }

    // Fetch chips from DB — only OctupusZap_ prefixed or new (no instance yet)
    const chips = await db.chip.findMany({
      where: {
        OR: [
          { evolutionInstance: { startsWith: INSTANCE_PREFIX } },
          { evolutionInstance: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        vendedor: {
          select: { id: true, nome: true },
        },
      },
    })

    // Background cleanup: delete old chips (without OctupusZap_ prefix) from the database
    // These are remnants from the v2 era that no longer have instances in any Evolution server
    cleanupOldChips().catch(() => {})

    // Fetch real-time status from Evolution Go
    // This merges Evolution Go instance data with our DB chips
    let instanceMap = new Map<string, any>()
    try {
      const instances = await fetchOctupusZapInstances()
      for (const inst of instances) {
        instanceMap.set(inst.name, inst)
      }
    } catch {
      // Evolution Go unavailable — return DB data as-is
    }

    // Merge real-time Evolution Go status into chips
    const mergedChips = chips.map(chip => {
      const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)
      const evoInstance = instanceMap.get(instanceName)

      // If chip has an evolutionInstance but it doesn't exist in Evolution Go → disconnected
      let realTimeStatus = chip.status
      let realTimeConnected = false
      let realTimeJid: string | null = null
      let realTimeProfileName: string | null = chip.profileName

      if (evoInstance) {
        realTimeConnected = evoInstance.connected || false
        realTimeStatus = realTimeConnected ? 'connected' : 'disconnected'
        realTimeJid = evoInstance.jid || evoInstance.ownerJid || null
        realTimeProfileName = evoInstance.profileName || chip.profileName
      } else if (chip.evolutionInstance && isOctupusZapInstance(chip.evolutionInstance)) {
        // Instance doesn't exist in Evolution Go anymore
        realTimeStatus = 'disconnected'
      }

      // Update DB in background if status changed (non-blocking)
      if (realTimeStatus !== chip.status || (evoInstance && realTimeProfileName !== chip.profileName)) {
        db.chip.update({
          where: { id: chip.id },
          data: {
            ...(realTimeStatus !== chip.status ? {
              status: realTimeStatus,
              lastSeen: realTimeStatus === 'connected' ? new Date() : chip.lastSeen,
              isQrPaired: realTimeStatus === 'connected',
            } : {}),
            ...(realTimeProfileName !== chip.profileName ? { profileName: realTimeProfileName } : {}),
            ...(realTimeJid && realTimeConnected ? { profilePicUrl: realTimeJid } : {}),
          },
        }).catch(() => {}) // Silently ignore DB update errors
      }

      return {
        ...chip,
        status: realTimeStatus,
        profileName: realTimeProfileName,
        _evoConnected: realTimeConnected,
        _evoInstanceExists: !!evoInstance,
      }
    })

    return NextResponse.json(mergedChips)
  } catch (error) {
    console.error('Chips GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, phoneNumber } = body

    if (!name || !phoneNumber) {
      return NextResponse.json(
        { error: 'Name and phone number are required' },
        { status: 400 }
      )
    }

    // Check for duplicate phone
    const existing = await db.chip.findUnique({ where: { phoneNumber } })
    if (existing) {
      return NextResponse.json(
        { error: 'Já existe um chip com este número' },
        { status: 409 }
      )
    }

    // Get used IPs and ports
    const existingChips = await db.chip.findMany({
      select: { wireguardIp: true, socksPort: true },
    })
    const usedIps = existingChips.map((c) => c.wireguardIp).filter(Boolean) as string[]
    const usedPorts = existingChips.map((c) => c.socksPort).filter(Boolean) as number[]

    // Generate WireGuard config
    const wireguardIp = generateWireGuardIp(usedIps)
    const socksPort = generateSocksPort(usedPorts)
    const { privateKey, publicKey } = generateWireGuardKeys()

    const chip = await db.chip.create({
      data: {
        name,
        phoneNumber,
        wireguardIp,
        wireguardPrivKey: privateKey,
        wireguardPubKey: publicKey,
        socksPort,
        status: 'disconnected',
      },
    })

    // Auto-add WireGuard peer on the KVM8 server
    if (publicKey && wireguardIp) {
      addWireGuardPeer(publicKey, wireguardIp).catch(err => {
        console.error('[Chips POST] Background WireGuard peer add failed:', err)
      })
    }

    return NextResponse.json(chip, { status: 201 })
  } catch (error) {
    console.error('Chips POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    // Find chip first to clean up Evolution API instance and WireGuard peer
    const chip = await db.chip.findUnique({ where: { id } })

    if (chip) {
      const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

      // Disconnect and delete instance from Evolution Go
      try { await disconnectInstance(instanceName) } catch { /* may already be disconnected */ }
      try { await deleteInstance(instanceName) } catch { /* may not exist */ }

      // Remove WireGuard peer from KVM8 server
      if (chip.wireguardPubKey && chip.wireguardIp) {
        removeWireGuardPeer(chip.wireguardPubKey, chip.wireguardIp).catch(err => {
          console.error('[Chips DELETE] Background WireGuard peer remove failed:', err)
        })
      }
    }

    // Delete related records and chip from database
    await db.message.deleteMany({ where: { chipId: id } })
    await db.contact.deleteMany({ where: { chipId: id } })
    await db.campaignChip.deleteMany({ where: { chipId: id } })
    await db.chip.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Chips DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
