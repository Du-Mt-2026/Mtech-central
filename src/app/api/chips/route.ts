import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateWireGuardIp,
  generateSocksPort,
  generateWireGuardKeys,
} from '@/lib/wireguard'
import { addWireGuardPeer } from '@/lib/wireguard-peer-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'
import {
  fetchAllInstances,
  deleteInstance as routerDeleteInstance,
  disconnectInstance as routerDisconnectInstance,
  INSTANCE_PREFIX,
  isOctupusZapInstance,
} from '@/lib/evolution-router'

import { getInstanceName as v3GetInstanceName, isOctupusZapInstance as v3IsOctupusZap } from '@/lib/evolution-api'

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

    // Fetch ALL chips from DB
    let chips = await db.chip.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        vendedor: {
          select: { id: true, nome: true },
        },
      },
    })

    // Fetch real-time status from Evolution Go (v3) API
    const instanceMap = new Map<string, any>()
    let apiReachable = false
    try {
      const instances = await fetchAllInstances()
      for (const inst of instances) {
        instanceMap.set(inst.name, inst)
      }
      apiReachable = instances.length > 0
    } catch {
      // API unavailable — return DB data as-is
    }

    // Sync cleanup: mark chips whose instances no longer exist as "instance_not_found"
    // instead of auto-deleting them. This prevents accidental data loss when the
    // Evolution API has a temporary error or someone deletes an instance manually.
    // The user can manually delete chips from the UI when they're sure it's safe.
    if (apiReachable) {
      const orphanedChips: { id: string; name: string }[] = []
      for (const chip of chips) {
        if (chip.evolutionInstance && !instanceMap.has(chip.evolutionInstance)) {
          // Only auto-mark OctupusZap-managed instances (with prefix)
          if (v3IsOctupusZap(chip.evolutionInstance)) {
            orphanedChips.push({ id: chip.id, name: chip.name })
          }
        }
      }
      if (orphanedChips.length > 0) {
        console.log(`[Chips Cleanup] Marking ${orphanedChips.length} orphaned chips as instance_not_found...`)
        for (const { id, name } of orphanedChips) {
          await db.chip.update({
            where: { id },
            data: {
              status: 'disconnected',
              isQrPaired: false,
            },
          }).catch(() => {})
        }
        console.log(`[Chips Cleanup] Marked ${orphanedChips.length} orphaned chips as disconnected (instance_not_found) — they will NOT be deleted automatically`)
      }
    }

    // Merge real-time status into chips
    const mergedChips = chips.map(chip => {
      const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)
      const evoInstance = instanceMap.get(instanceName)
      let realTimeStatus = chip.status
      let realTimeConnected = false
      let realTimeJid: string | null = null
      let realTimeProfileName: string | null = chip.profileName
      let realTimeProfilePicUrl: string | null = chip.profilePicUrl

      if (evoInstance) {
        realTimeConnected = evoInstance.connected || false
        realTimeStatus = realTimeConnected ? 'connected' : 'disconnected'
        realTimeJid = evoInstance.ownerJid || null
        realTimeProfileName = evoInstance.profileName || chip.profileName
        realTimeProfilePicUrl = evoInstance.profilePicUrl || chip.profilePicUrl
      } else if (chip.evolutionInstance && v3IsOctupusZap(chip.evolutionInstance)) {
        // Instance no longer exists in API
        realTimeStatus = 'disconnected'
      }

      // Update DB in background if status changed (non-blocking)
      if (realTimeStatus !== chip.status || (evoInstance && (realTimeProfileName !== chip.profileName))) {
        db.chip.update({
          where: { id: chip.id },
          data: {
            ...(realTimeStatus !== chip.status ? {
              status: realTimeStatus,
              lastSeen: realTimeStatus === 'connected' ? new Date() : chip.lastSeen,
              isQrPaired: realTimeStatus === 'connected',
            } : {}),
            ...(realTimeProfileName !== chip.profileName ? { profileName: realTimeProfileName } : {}),
            ...(realTimeProfilePicUrl !== chip.profilePicUrl ? { profilePicUrl: realTimeProfilePicUrl } : {}),
          },
        }).catch(() => {}) // Silently ignore DB update errors
      }

      return {
        ...chip,
        status: realTimeStatus,
        profileName: realTimeProfileName,
        profilePicUrl: realTimeProfilePicUrl,
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
      const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)

      // Disconnect and delete instance
      try { await routerDisconnectInstance(instanceName) } catch { /* may already be disconnected */ }
      try { await routerDeleteInstance(instanceName) } catch { /* may not exist */ }

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
