import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createInstance,
  connectInstance,
  setWebhook,
  setProxy,
  findInstanceByName,
  getInstanceName,
  resolveChipProxy,
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

    // Check if instance already exists
    let existing = await findInstanceByName(instanceName)

    if (!existing) {
      const newInstance = await createInstance(instanceName)
      existing = newInstance
    }

    const effectiveInstanceName = existing.name || instanceName

    // Configure webhook
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`
    try {
      await setWebhook(effectiveInstanceName, webhookUrl, [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'SEND_MESSAGE',
        'CONNECTION_UPDATE',
      ])
    } catch (webhookErr) {
      console.error('Verifier: Failed to set webhook:', webhookErr)
    }

    // Apply SOCKS5 proxy — auto-detect from WireGuard IP or explicit config
    const proxyConfig = resolveChipProxy(chip)
    if (proxyConfig) {
      try {
        await setProxy(effectiveInstanceName, proxyConfig)
      } catch (proxyErr) {
        console.error('Verifier: Failed to set proxy:', proxyErr)
      }
    }

    // Connect to get QR Code (or detect already connected)
    const connectResult = await connectInstance(effectiveInstanceName)

    const isConnected = connectResult.state === 'open'
    const newStatus = isConnected ? 'connected' : 'connecting'

    // Update chip in DB
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: newStatus,
        evolutionInstance: effectiveInstanceName,
        qrPairingCode: connectResult.code || connectResult.pairingCode || null,
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
      qrcode: connectResult.qrcode || null,
      code: connectResult.code || connectResult.pairingCode || null,
    })
  } catch (error: any) {
    console.error('Verifier connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao conectar ao WhatsApp' },
      { status: 500 }
    )
  }
}
