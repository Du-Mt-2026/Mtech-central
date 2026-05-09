import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { setProxy } from '@/lib/evolution-api'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    await db.message.deleteMany({ where: { chipId } })
    await db.contact.deleteMany({ where: { chipId } })
    await db.campaignChip.deleteMany({ where: { chipId } })
    await db.chip.delete({ where: { id: chipId } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    const body = await req.json()
    const allowedFields = [
      'name', 'phoneNumber', 'status', 'wireguardIp', 'wireguardPrivKey', 'wireguardPubKey',
      'socksPort', 'lastSeen', 'dailyLimit', 'sentToday', 'lastResetAt',
      'warmingEnabled', 'warmingStage', 'isQrPaired', 'qrPairingCode',
      'proxyMode', 'socks5Host', 'socks5Port', 'socks5User', 'socks5Pass',
    ]
    const data: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) {
        data[key] = body[key]
      }
    }
    const chip = await db.chip.update({
      where: { id: chipId },
      data,
    })

    // Apply SOCKS5 proxy to Evolution API instance if proxyMode is 'socks5' and instance exists
    if (chip.proxyMode === 'socks5' && chip.evolutionInstance) {
      try {
        await setProxy(chip.evolutionInstance, {
          enabled: !!(chip.socks5Host && chip.socks5Port),
          host: chip.socks5Host || '',
          port: String(chip.socks5Port || 0),
          username: chip.socks5User || '',
          password: chip.socks5Pass || '',
        })
      } catch (proxyErr) {
        console.error('Failed to apply proxy to Evolution instance:', proxyErr)
      }
    } else if (chip.proxyMode !== 'socks5' && chip.evolutionInstance) {
      // Disable proxy if proxyMode is not 'socks5'
      try {
        await setProxy(chip.evolutionInstance, {
          enabled: false,
          host: '',
          port: '0',
          username: '',
          password: '',
        })
      } catch (proxyErr) {
        console.error('Failed to disable proxy on Evolution instance:', proxyErr)
      }
    }

    return NextResponse.json(chip)
  } catch {
    return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
  }
}
