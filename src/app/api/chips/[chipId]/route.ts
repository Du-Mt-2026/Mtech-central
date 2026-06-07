import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  deleteInstance as routerDeleteInstance,
  disconnectInstance as routerDisconnectInstance,
  connectInstance as routerConnectInstance,
  resolveChipProxy,
  getGlobalProxy,
} from '@/lib/evolution-router'
import { setProxy, getInstanceName as v3GetInstanceName } from '@/lib/evolution-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    // Find chip first to get the Evolution instance name
    const chip = await db.chip.findUnique({ where: { id: chipId } })

    if (chip) {
      const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)

      // Disconnect and delete instance from Evolution Go (v3)
      try {
        await routerDisconnectInstance(instanceName)
      } catch (err) {
        console.log('[Chip DELETE] Disconnect failed (may already be disconnected):', err)
      }

      try {
        await routerDeleteInstance(instanceName)
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

// Fields that affect proxy resolution — changing any of these triggers a proxy update
const PROXY_RELATED_FIELDS = [
  'wireguardIp', 'wireguardPrivKey', 'wireguardPubKey',
  'socksPort', 'proxyMode',
  'socks5Host', 'socks5Port', 'socks5User', 'socks5Pass',
  'evolutionInstance',
]

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    const body = await req.json()
    const allowedFields = [
      'name', 'phoneNumber', 'status', 'wireguardIp', 'wireguardPrivKey', 'wireguardPubKey',
      'socksPort', 'lastSeen', 'dailyLimit', 'sentToday', 'lastResetAt',
      'warmingEnabled', 'warmingStage', 'warmingPhase', 'warmingStartedAt', 'prewarmStartedAt', 'isQrPaired', 'qrPairingCode',
      'proxyMode', 'socks5Host', 'socks5Port', 'socks5User', 'socks5Pass',
      'cooldownUntil', 'evolutionInstance',
    ]
    const data: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) {
        data[key] = body[key]
      }
    }

    // Check if proxy-related fields changed BEFORE updating
    // This prevents unnecessary disconnects when editing non-proxy fields (name, dailyLimit, etc.)
    const oldChip = await db.chip.findUnique({ where: { id: chipId } })
    const proxyFieldsChanged = PROXY_RELATED_FIELDS.some(field => {
      if (!(field in body)) return false
      const oldVal = String(oldChip?.[field as keyof typeof oldChip] ?? '')
      const newVal = String(body[field] ?? '')
      return oldVal !== newVal
    })

    // Also support explicit "applyProxy" flag to force proxy application
    // (useful when you want to re-apply the same proxy config)
    const forceApplyProxy = body.applyProxy === true

    const chip = await db.chip.update({
      where: { id: chipId },
      data,
    })

    // Only apply proxy to Evolution API instance when proxy-related fields changed
    // or when explicitly requested via applyProxy flag.
    // CRITICAL: Setting proxy on Evolution Go DISCONNECTS the WhatsApp client.
    // We must NOT call setProxy() on every PATCH — only when proxy config actually changes.
    // After applying proxy, we MUST reconnect the instance automatically.
    if (chip.evolutionInstance && (proxyFieldsChanged || forceApplyProxy)) {
      console.log(`[Chip PATCH] Proxy-related fields changed (or applyProxy=true). Reconfiguring proxy...`)
      const globalProxy = await getGlobalProxy()
      const proxyConfig = resolveChipProxy(chip, globalProxy)
      if (proxyConfig) {
        try {
          await setProxy(chip.evolutionInstance, proxyConfig)
          console.log(`[Chip PATCH] Proxy applied to ${chip.evolutionInstance}, reconnecting...`)

          // After setting proxy, Evolution Go disconnects the client.
          // We must reconnect it through the proxy immediately.
          try {
            // Build webhook URL for reconnection
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
            const webhookUrl = `${appUrl}/api/whatsapp/webhook`
            await routerConnectInstance(chip.evolutionInstance, webhookUrl)
            console.log(`[Chip PATCH] Reconnected ${chip.evolutionInstance} through proxy`)
          } catch (reconnectErr) {
            console.warn(`[Chip PATCH] Reconnection after proxy failed for ${chip.evolutionInstance}:`, reconnectErr)
          }
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
          console.log(`[Chip PATCH] Proxy removed from ${chip.evolutionInstance}, reconnecting...`)

          // Reconnect without proxy
          try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
            const webhookUrl = `${appUrl}/api/whatsapp/webhook`
            await routerConnectInstance(chip.evolutionInstance, webhookUrl)
            console.log(`[Chip PATCH] Reconnected ${chip.evolutionInstance} without proxy`)
          } catch (reconnectErr) {
            console.warn(`[Chip PATCH] Reconnection after proxy removal failed:`, reconnectErr)
          }
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
