import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createInstance, connectInstance, getInstanceQRCode, findInstanceByName, getInstanceName, resolveChipProxy, getGlobalProxy, toEvolutionGoProxy, setWebhook } from '@/lib/evolution-api'

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

    const instanceName = getInstanceName(chip.id, chip.name)

    // Check if instance already exists in Evolution Go
    let existing = await findInstanceByName(instanceName)

    // Build webhook URL for this instance
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`

    // Resolve proxy config for this chip
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    if (!existing) {
      // Create new instance in Evolution Go
      // In v3: proxy is set at creation time, webhook is set at connect time
      const newInstance = await createInstance(instanceName, toEvolutionGoProxy(proxyConfig))
      existing = newInstance
    } else {
      // Instance exists — update webhook and proxy if needed
      // In v3: webhook is configured via connect, proxy at creation
      // If proxy changed, we'd need to recreate the instance
      // For now, just ensure webhook is set
      try {
        await setWebhook(existing.name || instanceName, webhookUrl)
      } catch (webhookErr) {
        console.error('Failed to set webhook:', webhookErr)
      }
    }

    const effectiveInstanceName = existing.name || instanceName

    // Connect to get QR Code (or detect already connected)
    // In v3: connect also sets the webhook
    const connectResult = await connectInstance(effectiveInstanceName, webhookUrl)

    // If not connected yet, try to fetch QR code separately
    // (In v3, QR code comes via webhook or via GET /instance/qr)
    let qrcode = connectResult.qrcode
    let code = connectResult.code
    if (!qrcode && connectResult.state !== 'open') {
      try {
        const qrResult = await getInstanceQRCode(effectiveInstanceName)
        qrcode = qrResult.qrcode
        code = qrResult.code
      } catch {
        // QR code not available yet — will be provided via webhook
      }
    }

    // If already connected, update status and return
    const isConnected = connectResult.state === 'open'
    const newStatus = isConnected ? 'connected' : 'connecting'

    // Update chip in database — including the evolutionInstance link
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

    return NextResponse.json({
      instanceName: effectiveInstanceName,
      qrcode: qrcode || null,
      code: code || null,
      state: connectResult.state,
      status: isConnected ? 'open' : existing.connectionStatus,
    })
  } catch (error: any) {
    console.error('WhatsApp connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao conectar WhatsApp' },
      { status: 500 }
    )
  }
}
