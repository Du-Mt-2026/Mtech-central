import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createInstance,
  connectInstance as routerConnectInstance,
  disconnectInstance as routerDisconnectInstance,
  deleteInstance as routerDeleteInstance,
  getGlobalProxy,
  findInstanceByName,
} from '@/lib/evolution-router'
import { getInstanceName as v3GetInstanceName, findInstanceByName as v3FindInstanceByName, toEvolutionGoProxy as v3ToEvolutionGoProxy, resolveChipProxy, getInstanceQRCode, getConnectionState as v3GetConnectionState } from '@/lib/evolution-api'

export async function POST(request: Request) {
  try {
    const { chipId } = await request.json()

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // Build instance name
    const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)

    // Build webhook URL for this instance
    // IMPORTANT: Use NEXT_PUBLIC_APP_URL (stable production URL) over VERCEL_URL (deployment-specific)
    // VERCEL_URL changes on every deploy, which breaks existing webhooks in Evolution Go
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
    const webhookUrl = `${appUrl}/api/whatsapp/webhook`

    // ===== Evolution Go Connection Flow =====
    // Resolve proxy config for this chip
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    // Check if instance already exists
    let existing = await v3FindInstanceByName(instanceName)

    // ===== BUG FIX: Stale session detection =====
    // If the chip is marked as disconnected in our DB but the Evolution API
    // instance still has an active WhatsApp session (Connected+LoggedIn), the
    // user clicked "Conectar WhatsApp" expecting to see a QR code. Simply
    // disconnecting is NOT enough — Evolution Go preserves the session and
    // auto-reconnects, skipping the QR code again.
    //
    // Fix: Delete the instance entirely and recreate it from scratch.
    // This forces Evolution Go to generate a brand new session and QR code.
    if (existing && chip.status !== 'connected') {
      try {
        const realState = await v3GetConnectionState(existing.name || instanceName)
        if (realState.state === 'open') {
          console.log(`[Connect] Chip "${chip.name}" is "${chip.status}" in DB but Evolution instance is connected. Deleting and recreating instance for fresh QR code.`)
          try {
            await routerDisconnectInstance(existing.name || instanceName)
          } catch { /* may fail if already disconnected */ }
          try {
            await routerDeleteInstance(existing.name || instanceName)
          } catch { /* may fail if already deleted */ }
          // Wait for deletion to take effect
          await new Promise(r => setTimeout(r, 2000))
          // Clear the existing reference so the code below creates a fresh instance
          existing = null
        }
      } catch {
        // Status check failed — proceed with normal connect flow
      }
    }

    if (!existing) {
      // Create new instance in Evolution Go
      const newInstance = await createInstance(instanceName, proxyConfig ? v3ToEvolutionGoProxy(proxyConfig) : undefined)
      const effectiveInstanceName = newInstance.name || instanceName

      // Connect via router
      const connectResult = await routerConnectInstance(effectiveInstanceName, webhookUrl)

      // Evolution Go: QR code comes via webhook, not in connect response.
      // Try to fetch QR code immediately as fallback.
      let qrcode: string | null = connectResult.qrcode
      let code: string | null = connectResult.code || connectResult.pairingCode || null
      let effectiveState: string = connectResult.state || 'close'
      if (!qrcode && effectiveState !== 'open') {
        try {
          // Wait a moment for Evolution Go to generate the QR code
          await new Promise(r => setTimeout(r, 1500))
          const qrResult = await getInstanceQRCode(effectiveInstanceName)
          qrcode = qrResult.qrcode ?? null
          code = code ?? qrResult.code ?? null
          // If QR fetch returns 'open' (session already logged in), update state
          if (qrResult.state === 'open') {
            effectiveState = 'open'
          }
        } catch {
          // QR code not available yet — will be delivered via webhook
        }
      }

      const isConnected = effectiveState === 'open'
      const newStatus = isConnected ? 'connected' : 'connecting'

      // Update chip in database
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: newStatus,
          evolutionInstance: effectiveInstanceName,
          qrPairingCode: code,
          lastSeen: isConnected ? new Date() : chip.lastSeen,
          ...(isConnected ? { isQrPaired: true } : {}),
        },
      })

      return NextResponse.json({
        instanceName: effectiveInstanceName,
        qrcode: qrcode || null,
        code: code || null,
        state: effectiveState,
      })
    }

    // Instance exists — connect directly via router
    // NOTE: Do NOT call setWebhook() before routerConnectInstance()!
    // setWebhook() calls POST /instance/connect internally, which triggers
    // a premature reconnection using the stored session, causing the QR code
    // to be skipped. routerConnectInstance() already passes the webhookUrl
    // to its own /instance/connect call, so setWebhook() is redundant.
    const effectiveInstanceName = existing.name || instanceName

    // Connect via router
    const connectResult = await routerConnectInstance(effectiveInstanceName, webhookUrl)

    // Evolution Go: QR code comes via webhook, not in connect response.
    // Try to fetch QR code immediately as fallback.
    let qrcode: string | null = connectResult.qrcode
    let code: string | null = connectResult.code || connectResult.pairingCode || null
    let effectiveState: string = connectResult.state || 'close'
    if (!qrcode && effectiveState !== 'open') {
      try {
        // Wait a moment for Evolution Go to generate the QR code
        await new Promise(r => setTimeout(r, 1500))
        const qrResult = await getInstanceQRCode(effectiveInstanceName)
        qrcode = qrResult.qrcode ?? null
        code = code ?? qrResult.code ?? null
        // If QR fetch returns 'open' (session already logged in), update state
        if (qrResult.state === 'open') {
          effectiveState = 'open'
        }
      } catch {
        // QR code not available yet — will be delivered via webhook
      }
    }

    const isConnected = effectiveState === 'open'
    const newStatus = isConnected ? 'connected' : 'connecting'

    // Update chip in database
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: newStatus,
        evolutionInstance: effectiveInstanceName,
        qrPairingCode: code,
        lastSeen: isConnected ? new Date() : chip.lastSeen,
        ...(isConnected ? { isQrPaired: true } : {}),
      },
    })

    return NextResponse.json({
      instanceName: effectiveInstanceName,
      qrcode: qrcode || null,
      code: code || null,
      state: effectiveState,
    })
  } catch (error: any) {
    console.error('WhatsApp connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao conectar WhatsApp' },
      { status: 500 }
    )
  }
}
