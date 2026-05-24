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
  toEvolutionGoProxy,
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

    // Build webhook URL
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`

    // Resolve proxy config
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    // Check if instance already exists
    let existing = await findInstanceByName(instanceName)

    if (!existing) {
      // Create new instance with proxy at creation time (v3)
      const newInstance = await createInstance(instanceName, toEvolutionGoProxy(proxyConfig))
      existing = newInstance
    }

    const effectiveInstanceName = existing.name || instanceName

    // Connect with webhook (v3: webhook is configured at connect time)
    const connectResult = await connectInstance(effectiveInstanceName, webhookUrl)

    // Try to fetch QR code if not yet connected
    let qrcode = connectResult.qrcode
    let code = connectResult.code
    if (!qrcode && connectResult.state !== 'open') {
      try {
        const qrResult = await getInstanceQRCode(effectiveInstanceName)
        qrcode = qrResult.qrcode
        code = qrResult.code
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
