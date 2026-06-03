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

    // ============================================
    // BIDIRECTIONAL SYNC: Evolution API ↔ OctupusZap
    // ============================================
    if (apiReachable) {
      // --- Direction 1: Evolution → OctupusZap (auto-import new instances) ---
      // Auto-import OctupusZap_ instances that exist in Evolution API but NOT in our DB.
      // This handles the case where someone creates an instance directly in the
      // Evolution API dashboard — it should automatically appear in OctupusZap.
      const dbInstanceNames = new Set(
        chips.filter(c => c.evolutionInstance).map(c => c.evolutionInstance)
      )
      const evoOctupusInstances = [...instanceMap.values()].filter(
        (inst: any) => inst.name && inst.name.startsWith('OctupusZap_')
      )

      for (const evoInst of evoOctupusInstances) {
        if (!dbInstanceNames.has(evoInst.name)) {
          // This OctupusZap instance exists in Evolution but NOT in our DB — auto-import!
          console.log(`[Chips Sync] Auto-importing instance "${evoInst.name}" from Evolution API (not in DB)`)

          // Extract phone number from ownerJid (e.g., "554891742716:7@s.whatsapp.net" → "554891742716")
          const jid = evoInst.ownerJid || ''
          const phoneFromJid = jid.split('@')[0].split(':')[0] || ''

          // Generate a readable name from instance name
          // e.g., "OctupusZap_Artur_d4x0u0j8" → "Artur"
          // e.g., "OctupusZap_Chip_Claro_01_d4x0u0j8" → "Chip Claro 01"
          const namePart = evoInst.name.replace('OctupusZap_', '').replace(/_[a-z0-9]{8}$/, '')
          const displayName = namePart.replace(/_/g, ' ') || evoInst.name

          try {
            const existingChipsForGen = await db.chip.findMany({
              select: { wireguardIp: true, socksPort: true },
            })
            const usedIps = existingChipsForGen.map((c) => c.wireguardIp).filter(Boolean) as string[]
            const usedPorts = existingChipsForGen.map((c) => c.socksPort).filter(Boolean) as number[]
            const wireguardIp = generateWireGuardIp(usedIps)
            const socksPort = generateSocksPort(usedPorts)
            const { privateKey, publicKey } = generateWireGuardKeys()

            const newChip = await db.chip.create({
              data: {
                name: displayName,
                phoneNumber: phoneFromJid || `auto-${Date.now()}`,
                wireguardIp,
                wireguardPrivKey: privateKey,
                wireguardPubKey: publicKey,
                socksPort,
                evolutionInstance: evoInst.name,
                status: evoInst.connected ? 'connected' : 'disconnected',
                isQrPaired: evoInst.connected,
                profileName: evoInst.profileName || null,
                lastSeen: evoInst.connected ? new Date() : undefined,
              },
            })

            // Add WireGuard peer on the server
            if (publicKey && wireguardIp) {
              addWireGuardPeer(publicKey, wireguardIp).catch(err => {
                console.error('[Chips Sync] WireGuard peer add failed for auto-imported chip:', err)
              })
            }

            // Add to chips list for the response
            chips.push(newChip as any)
            dbInstanceNames.add(evoInst.name)

            console.log(`[Chips Sync] Auto-imported chip "${displayName}" (instance: ${evoInst.name})`)
          } catch (importErr) {
            console.error(`[Chips Sync] Failed to auto-import instance "${evoInst.name}":`, importErr)
          }
        }
      }

      // --- Direction 2: Evolution → OctupusZap (mark orphaned chips) ---
      // Mark chips whose instances no longer exist in Evolution API.
      // This handles the case where someone deletes an instance directly in the
      // Evolution API dashboard — the chip should show as disconnected.
      const orphanedChips: { id: string; name: string }[] = []
      for (const chip of chips) {
        if (chip.evolutionInstance && !instanceMap.has(chip.evolutionInstance)) {
          if (v3IsOctupusZap(chip.evolutionInstance)) {
            orphanedChips.push({ id: chip.id, name: chip.name })
          }
        }
      }
      if (orphanedChips.length > 0) {
        console.log(`[Chips Sync] Marking ${orphanedChips.length} orphaned chips as disconnected (instance deleted from Evolution API)...`)
        for (const { id, name } of orphanedChips) {
          await db.chip.update({
            where: { id },
            data: {
              status: 'disconnected',
              isQrPaired: false,
            },
          }).catch(() => {})
        }
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

      // ============================================
      // BIDIRECTIONAL SYNC: Delete instance from Evolution API
      // ============================================
      // When a chip is deleted from OctupusZap, the corresponding instance
      // in Evolution API MUST also be deleted. We try multiple times to
      // ensure the instance is cleaned up — no silent failures.
      if (instanceName && v3IsOctupusZap(instanceName)) {
        // First, disconnect the instance
        try {
          await routerDisconnectInstance(instanceName)
          console.log(`[Chips DELETE] Disconnected instance "${instanceName}" from Evolution API`)
        } catch (err) {
          console.log(`[Chips DELETE] Disconnect failed for "${instanceName}" (may already be disconnected):`, err instanceof Error ? err.message : err)
        }

        // Then, delete the instance with retry
        let deleted = false
        for (let attempt = 1; attempt <= 3 && !deleted; attempt++) {
          try {
            await routerDeleteInstance(instanceName)
            deleted = true
            console.log(`[Chips DELETE] Deleted instance "${instanceName}" from Evolution API (attempt ${attempt})`)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.warn(`[Chips DELETE] Delete attempt ${attempt}/3 failed for "${instanceName}": ${errMsg}`)
            if (attempt < 3) {
              // Wait before retrying
              await new Promise(r => setTimeout(r, 2000))
            }
          }
        }

        if (!deleted) {
          console.error(`[Chips DELETE] ⚠️ FAILED to delete instance "${instanceName}" from Evolution API after 3 attempts! Instance may be orphaned.`)
        }
      }

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
