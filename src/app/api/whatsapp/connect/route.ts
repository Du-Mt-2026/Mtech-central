import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createInstance, connectInstance, setWebhook, setProxy, findInstanceByName, getInstanceName, resolveChipProxy, getGlobalProxy } from '@/lib/evolution-api'

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

    // Check if instance already exists in Evolution API
    let existing = await findInstanceByName(instanceName)

    if (!existing) {
      // Create new instance in Evolution API
      // Note: createInstance now normalizes the response so .name works correctly
      const newInstance = await createInstance(instanceName)
      existing = newInstance
    }

    // Use the instance name consistently — prefer existing.name (from fetchInstances) 
    // or fall back to our generated instanceName
    const effectiveInstanceName = existing.name || instanceName

    // Always ensure webhook is configured (for both new and existing instances)
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`
    try {
      await setWebhook(effectiveInstanceName, webhookUrl, [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'SEND_MESSAGE',
        'CONNECTION_UPDATE',
      ])
    } catch (webhookErr) {
      console.error('Failed to set webhook:', webhookErr)
    }

    // Apply SOCKS5 proxy — priority: chip config > WireGuard auto-detect > global proxy
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)
    if (proxyConfig) {
      try {
        await setProxy(effectiveInstanceName, proxyConfig)
        console.log(`Proxy applied to ${effectiveInstanceName}: ${proxyConfig.host}:${proxyConfig.port}`)
      } catch (proxyErr) {
        console.error('Failed to set proxy on instance:', proxyErr)
      }
    }

    // Connect to get QR Code (or detect already connected)
    const connectResult = await connectInstance(effectiveInstanceName)

    // If already connected, update status and return
    const isConnected = connectResult.state === 'open'
    const newStatus = isConnected ? 'connected' : 'connecting'

    // Update chip in database — including the evolutionInstance link
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

    return NextResponse.json({
      instanceName: effectiveInstanceName,
      qrcode: connectResult.qrcode || null,
      code: connectResult.code || null,
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
