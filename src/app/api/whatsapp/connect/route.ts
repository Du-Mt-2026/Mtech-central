import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createInstance,
  connectInstance as routerConnectInstance,
  getInstanceQRCode,
  setWebhook,
  getApiVersion,
  getInstanceName,
  toEvolutionGoProxy,
  resolveChipProxy,
  getGlobalProxy,
  findInstanceByName,
} from '@/lib/evolution-router'
// v3-specific helpers still needed for instance name generation and proxy
import { getInstanceName as v3GetInstanceName, findInstanceByName as v3FindInstanceByName, toEvolutionGoProxy as v3ToEvolutionGoProxy } from '@/lib/evolution-api'
import { fetchV2Instances } from '@/lib/evolution-api-v2'

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

    const apiVersion = getApiVersion(chip)

    // Build instance name based on API version
    let instanceName: string
    if (apiVersion === 'v2') {
      // v2 uses the chip name directly (no prefix) — e.g., "MTech_Bibi"
      instanceName = chip.evolutionInstance || chip.name.replace(/[^a-zA-Z0-9]/g, '_')
    } else {
      // v3 uses OctupusZap_ prefix
      instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)
    }

    // Build webhook URL for this instance
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`

    if (apiVersion === 'v2') {
      // ===== V2 (Baileys) Connection Flow =====
      // Check if instance exists in v2
      let v2Exists = false
      try {
        const v2Instances = await fetchV2Instances()
        v2Exists = v2Instances.some((i: any) => i.name === instanceName)
      } catch { /* v2 API unreachable */ }

      if (!v2Exists) {
        // Create instance in v2
        await createInstance(instanceName, 'v2')
      }

      // Connect via router (handles webhook + QR code)
      const connectResult = await routerConnectInstance(instanceName, 'v2', webhookUrl)

      const isConnected = connectResult.state === 'open'
      const newStatus = isConnected ? 'connected' : 'connecting'

      // Update chip in database
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: newStatus,
          evolutionInstance: instanceName,
          evolutionApiVersion: 'v2',
          qrPairingCode: connectResult.code || connectResult.pairingCode || null,
          lastSeen: isConnected ? new Date() : chip.lastSeen,
          ...(isConnected ? { isQrPaired: true } : {}),
        },
      })

      return NextResponse.json({
        instanceName,
        qrcode: connectResult.qrcode || null,
        code: connectResult.code || null,
        state: connectResult.state,
        apiVersion: 'v2',
      })

    } else {
      // ===== V3 (Go) Connection Flow =====
      // Resolve proxy config for this chip
      const globalProxy = await getGlobalProxy()
      const proxyConfig = resolveChipProxy(chip, globalProxy)

      // Check if instance already exists in v3
      let existing = await v3FindInstanceByName(instanceName)

      if (!existing) {
        // Create new instance in Evolution Go
        const newInstance = await createInstance(instanceName, 'v3', proxyConfig ? v3ToEvolutionGoProxy(proxyConfig) : undefined)
        // newInstance is a UnifiedInstance, use its name
        const effectiveInstanceName = newInstance.name || instanceName

        // Connect via router
        const connectResult = await routerConnectInstance(effectiveInstanceName, 'v3', webhookUrl)

        const isConnected = connectResult.state === 'open'
        const newStatus = isConnected ? 'connected' : 'connecting'

        // Update chip in database
        await db.chip.update({
          where: { id: chipId },
          data: {
            status: newStatus,
            evolutionInstance: effectiveInstanceName,
            evolutionApiVersion: 'v3',
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
          apiVersion: 'v3',
        })
      }

      // Instance exists — update webhook
      try {
        await setWebhook(existing.name || instanceName, 'v3', webhookUrl)
      } catch (webhookErr) {
        console.error('Failed to set webhook:', webhookErr)
      }

      const effectiveInstanceName = existing.name || instanceName

      // Connect via router
      const connectResult = await routerConnectInstance(effectiveInstanceName, 'v3', webhookUrl)

      const isConnected = connectResult.state === 'open'
      const newStatus = isConnected ? 'connected' : 'connecting'

      // Update chip in database
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: newStatus,
          evolutionInstance: effectiveInstanceName,
          evolutionApiVersion: 'v3',
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
        apiVersion: 'v3',
      })
    }
  } catch (error: any) {
    console.error('WhatsApp connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao conectar WhatsApp' },
      { status: 500 }
    )
  }
}
