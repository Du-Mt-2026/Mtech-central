import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  deleteInstance as routerDeleteInstance,
  disconnectInstance as routerDisconnectInstance,
  connectInstance as routerConnectInstance,
  resolveChipProxy,
  getGlobalProxy,
} from '@/lib/evolution-router'
import { setProxy, getConnectionState, getInstanceName as v3GetInstanceName } from '@/lib/evolution-api'
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

/**
 * Safely apply proxy to an Evolution Go instance with automatic reconnection
 * and fallback to no-proxy if reconnection through the proxy fails.
 *
 * Flow:
 *   1. setProxy() → Evolution Go disconnects the WhatsApp client
 *   2. routerConnectInstance() → reconnects through the proxy
 *   3. Wait 5 seconds, verify connection state
 *   4. If still disconnected → proxy is likely unreachable
 *      → Remove proxy → Reconnect without proxy (fallback)
 *      → This ensures the chip NEVER stays permanently disconnected
 */
async function applyProxyWithFallback(
  instanceName: string,
  proxyConfig: { host: string; port: string; username: string; password: string; protocol?: string }
): Promise<{ success: boolean; withProxy: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
  const webhookUrl = `${appUrl}/api/whatsapp/webhook`

  // Step 1: Apply proxy (this DISCONNECTS the WhatsApp client)
  try {
    await setProxy(instanceName, proxyConfig)
    console.log(`[Proxy Fallback] Proxy applied to ${instanceName}`)
  } catch (proxyErr: any) {
    console.error(`[Proxy Fallback] Failed to set proxy for ${instanceName}:`, proxyErr?.message)
    return { success: false, withProxy: false, error: `setProxy failed: ${proxyErr?.message}` }
  }

  // Step 2: Reconnect through the proxy
  try {
    await routerConnectInstance(instanceName, webhookUrl)
    console.log(`[Proxy Fallback] Reconnect call succeeded for ${instanceName}`)
  } catch (reconnectErr: any) {
    console.warn(`[Proxy Fallback] Reconnection after proxy failed for ${instanceName}:`, reconnectErr?.message)
  }

  // Step 3: Wait and verify connection
  await new Promise(r => setTimeout(r, 5000))

  try {
    const stateResult = await getConnectionState(instanceName)
    const state = stateResult?.state || 'close'

    if (state === 'open') {
      console.log(`[Proxy Fallback] ${instanceName} reconnected through proxy successfully!`)
      return { success: true, withProxy: true }
    }

    console.warn(`[Proxy Fallback] ${instanceName} is ${state} after proxy reconnect. Proxy may be unreachable.`)

    // Step 4: FALLBACK — remove proxy and reconnect without it
    console.log(`[Proxy Fallback] Removing proxy from ${instanceName} and reconnecting without proxy...`)

    try {
      await setProxy(instanceName, {
        enabled: false,
        host: '',
        port: '0',
        username: '',
        password: '',
      })
    } catch (removeErr) {
      console.warn(`[Proxy Fallback] Failed to remove proxy from ${instanceName}:`, removeErr)
    }

    try {
      await routerConnectInstance(instanceName, webhookUrl)
      console.log(`[Proxy Fallback] Reconnected ${instanceName} WITHOUT proxy (fallback)`)
    } catch (fallbackErr: any) {
      console.error(`[Proxy Fallback] Fallback reconnection also failed for ${instanceName}:`, fallbackErr?.message)
      return { success: false, withProxy: false, error: `Both proxy and fallback reconnect failed` }
    }

    // Verify fallback reconnection
    await new Promise(r => setTimeout(r, 3000))
    try {
      const fallbackState = await getConnectionState(instanceName)
      if (fallbackState?.state === 'open') {
        console.log(`[Proxy Fallback] ${instanceName} reconnected without proxy (fallback successful)`)
        return { success: true, withProxy: false }
      }
    } catch {
      // Can't verify — hope for the best
    }

    return { success: false, withProxy: false, error: 'Proxy reconnect failed, fallback also not confirmed' }
  } catch (verifyErr: any) {
    console.error(`[Proxy Fallback] Verification error for ${instanceName}:`, verifyErr?.message)
    return { success: false, withProxy: false, error: `Verification failed: ${verifyErr?.message}` }
  }
}

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
        // Apply proxy with fallback safety — chip will NEVER stay permanently disconnected
        const result = await applyProxyWithFallback(chip.evolutionInstance, proxyConfig)
        if (result.success && result.withProxy) {
          console.log(`[Chip PATCH] Proxy applied and ${chip.evolutionInstance} reconnected through proxy`)
        } else if (result.success && !result.withProxy) {
          console.warn(`[Chip PATCH] Proxy was unreachable — ${chip.evolutionInstance} reconnected WITHOUT proxy (fallback)`)
        } else {
          console.error(`[Chip PATCH] Proxy application failed for ${chip.evolutionInstance}: ${result.error}`)
        }
      } else {
        // No proxy detected — disable if previously set
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
        const webhookUrl = `${appUrl}/api/whatsapp/webhook`
        try {
          await setProxy(chip.evolutionInstance, {
            enabled: false,
            host: '',
            port: '0',
            username: '',
            password: '',
          })
          console.log(`[Chip PATCH] Proxy removed from ${chip.evolutionInstance}`)

          try {
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
