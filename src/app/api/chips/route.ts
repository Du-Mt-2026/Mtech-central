import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateWireGuardIp,
  generateSocksPort,
  generateWireGuardKeys,
} from '@/lib/wireguard'
import { addWireGuardPeer } from '@/lib/wireguard-peer-api'
import { deleteInstance, disconnectInstance, getInstanceName } from '@/lib/evolution-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'

export async function GET() {
  try {
    // Reset daily counters for all chips if a new day has started
    // This ensures sentToday/verifiedToday/hourlySent are reset at midnight
    // even when no campaign is actively sending messages
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
        console.log(`[Chips GET] Reset daily counters for chip ${chip.id} (was ${chip.sentToday})`)
      } else {
        // Same day — check hourly reset
        const lastHourlyReset = new Date(chip.lastHourlyResetAt ?? chip.lastResetAt)
        const hoursSinceReset = (now.getTime() - lastHourlyReset.getTime()) / (1000 * 60 * 60)
        if (hoursSinceReset >= 1 && chip.hourlySent > 0) {
          await db.chip.update({
            where: { id: chip.id },
            data: { hourlySent: 0, lastHourlyResetAt: now },
          })
          console.log(`[Chips GET] Reset hourly counter for chip ${chip.id} (was ${chip.hourlySent})`)
        }
      }
    }

    const chips = await db.chip.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        vendedor: {
          select: { id: true, nome: true },
        },
      },
    })
    return NextResponse.json(chips)
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

      // Disconnect and delete instance from Evolution API
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
