import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { setProxy, resolveChipProxy, getGlobalProxy, deleteInstance, disconnectInstance, getInstanceName } from '@/lib/evolution-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    // Find chip first to get the Evolution instance name
    const chip = await db.chip.findUnique({ where: { id: chipId } })

    if (chip) {
      const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

      // Disconnect and delete instance from Evolution API
      try {
        await disconnectInstance(instanceName)
      } catch (err) {
        console.log('[Chip DELETE] Disconnect failed (may already be disconnected):', err)
      }

      try {
        await deleteInstance(instanceName)
      } catch (err) {
        console.log('[Chip DELETE] Delete instance failed (may not exist):', err)
      }

      // Remove WireGuard peer from KVM8 server
      if (chip.wireguardPubKey && chip.wireguardIp) {
        removeWireGuardPeer(chip.wireguardPubKey, chip.wireguardIp).catch(err => {
          console.error('[Chip DELETE] Background WireGuard peer remove failed:', err)
        })
      }
    }

    // Delete related records and chip from database
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

    // Apply proxy to Evolution API instance — auto-detect from WireGuard IP or global proxy
    if (chip.evolutionInstance) {
      const globalProxy = await getGlobalProxy()
      const proxyConfig = resolveChipProxy(chip, globalProxy)
      if (proxyConfig) {
        try {
          await setProxy(chip.evolutionInstance, proxyConfig)
        } catch (proxyErr) {
          console.error('Failed to apply proxy to Evolution instance:', proxyErr)
        }
      } else {
        // No proxy detected — disable if previously set
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
    }

    return NextResponse.json(chip)
  } catch {
    return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
  }
}
