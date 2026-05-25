import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createInstance,
  connectInstance as routerConnectInstance,
  setWebhook,
  getGlobalProxy,
  findInstanceByName,
} from '@/lib/evolution-router'
import { getInstanceName as v3GetInstanceName, findInstanceByName as v3FindInstanceByName, toEvolutionGoProxy as v3ToEvolutionGoProxy, resolveChipProxy, getInstanceQRCode } from '@/lib/evolution-api'

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
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`

    // ===== Evolution Go Connection Flow =====
    // Resolve proxy config for this chip
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    // Check if instance already exists
    let existing = await v3FindInstanceByName(instanceName)

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

    // Instance exists — update webhook
    try {
      await setWebhook(existing.name || instanceName, webhookUrl)
    } catch (webhookErr) {
      console.error('Failed to set webhook:', webhookErr)
    }

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
