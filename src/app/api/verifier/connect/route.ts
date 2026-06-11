import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createInstance,
  connectInstance,
  getInstanceQRCode,
  findInstanceByName,
  getInstanceName,
  resolveChipProxy,
  getGlobalProxy,
  setProxy,
  getConnectionState as v3GetConnectionState,
  clearInstanceIdCache,
  disconnectInstance,
  deleteInstance,
} from '@/lib/evolution-api'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chipId } = body

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Build webhook URL — prefer stable NEXT_PUBLIC_APP_URL over deployment-specific VERCEL_URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
    const webhookUrl = `${appUrl}/api/whatsapp/webhook`

    // Resolve proxy config
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    // Check if instance already exists
    let existing = await findInstanceByName(instanceName)

    // ===== Stale session detection =====
    // If the chip is marked as disconnected in our DB but the Evolution API
    // instance still has a stored WhatsApp session, calling connect will
    // auto-restore the session and return state='open' with no QR code.
    // The user expects a QR code, so we must delete and recreate the instance.
    if (existing && chip.status !== 'connected') {
      const storedJid = existing.jid || existing.ownerJid || ''
      const hasStoredSession = storedJid.length > 0
      try {
        const realState = await v3GetConnectionState(existing.name || instanceName)
        const needsRecreate = realState.state === 'open' ||
          (realState.state === 'connecting' && hasStoredSession)
        if (needsRecreate) {
          console.log(`[Verifier Connect] Chip "${chip.name}" is "${chip.status}" in DB but Evolution instance has stale session (state=${realState.state}, jid=${storedJid}). Deleting and recreating for fresh QR code.`)
          try { await disconnectInstance(existing.name || instanceName) } catch { /* may fail */ }
          try { await deleteInstance(existing.name || instanceName) } catch { /* may fail */ }
          await new Promise(r => setTimeout(r, 2000))
          clearInstanceIdCache()
          existing = null
        }
      } catch {
        // Status check failed — proceed with normal connect flow
      }
    }

    if (!existing) {
      // Create instance WITH proxy if available — the proxy is accessible
      // from the Evolution Go container via iptables NAT rules on KVM8.
      // Creating with proxy from the start avoids the disconnect/reconnect cycle.
      const newInstance = await createInstance(instanceName)
      existing = newInstance
    }

    const effectiveInstanceName = existing.name || instanceName

    // Connect with webhook URL — CRITICAL: always pass webhookUrl so that
    // Evolution Go knows where to send events (Connected, Disconnected, QRCode, etc.)
    const connectResult = await connectInstance(effectiveInstanceName, webhookUrl)

    // Try to fetch QR code if not yet connected
    let qrcode = connectResult.qrcode
    let code = connectResult.code
    if (!qrcode && connectResult.state !== 'open') {
      try {
        await new Promise(r => setTimeout(r, 1500))
        const qrResult = await getInstanceQRCode(effectiveInstanceName)
        qrcode = qrResult.qrcode
        code = qrResult.code
        // If QR fetch returns 'open' (session already logged in), use that state
        if (qrResult.state === 'open') {
          connectResult.state = 'open'
        }
      } catch {
        // QR code not available yet
      }
    }

    const isConnected = connectResult.state === 'open'
    const newStatus = isConnected ? 'connected' : 'connecting'

    // Update chip in DB
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: newStatus,
        evolutionInstance: effectiveInstanceName,
        qrPairingCode: code || connectResult.pairingCode || null,
        lastSeen: isConnected ? new Date() : chip.lastSeen,
        ...(isConnected ? { isQrPaired: true } : {}),
      },
    })

    // Set proxy AFTER instance is connected (non-blocking) — only if proxy
    // wasn't already set at creation time. This handles the case where the
    // instance already existed and was reconnected.
    // CRITICAL: setProxy disconnects the client, so we reconnect after.
    if (isConnected && proxyConfig && proxyConfig.enabled) {
      setProxy(effectiveInstanceName, proxyConfig).then(() => {
        // Reconnect through the proxy
        connectInstance(effectiveInstanceName, webhookUrl).catch(err => {
          console.warn(`[Verifier] Reconnection after proxy failed for ${effectiveInstanceName}:`, err)
        })
      }).catch(err => {
        console.warn(`[Verifier] Failed to set proxy for ${effectiveInstanceName}:`, err)
      })
    }

    // Return in the format the frontend expects
    if (isConnected) {
      return NextResponse.json({
        connected: true,
        status: 'connected',
        instanceName: effectiveInstanceName,
      })
    }

    return NextResponse.json({
      connected: false,
      status: 'connecting',
      instanceName: effectiveInstanceName,
      qrcode: qrcode || null,
      code: code || connectResult.pairingCode || null,
    })
  } catch (error: any) {
    console.error('Verifier connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao conectar ao WhatsApp' },
      { status: 500 }
    )
  }
}
