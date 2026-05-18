import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateWireGuardIp,
  generateSocksPort,
  generateWireGuardKeys,
} from '@/lib/wireguard'
import { addWireGuardPeer } from '@/lib/wireguard-peer-api'

export async function GET() {
  try {
    const chips = await db.chip.findMany({
      orderBy: { createdAt: 'desc' },
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

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

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
