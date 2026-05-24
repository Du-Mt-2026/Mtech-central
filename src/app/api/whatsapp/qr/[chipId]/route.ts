import { NextResponse } from 'next/server'
import { getInstanceQRCode, getInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'

export async function GET(request: Request, { params }: { params: Promise<{ chipId: string }> }) {
  try {
    const { chipId } = await params

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // Use the linked instance name from chip, or generate from chip ID/name
    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Fetch QR code from Evolution Go
    // In v3: GET /instance/qr with instanceId header
    const qrResult = await getInstanceQRCode(instanceName)

    const isConnected = qrResult.state === 'open'

    // Update chip status
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: isConnected ? 'connected' : 'connecting',
        evolutionInstance: instanceName,
        qrPairingCode: qrResult.code || qrResult.pairingCode || null,
        ...(isConnected ? { isQrPaired: true } : {}),
      },
    })

    return NextResponse.json({
      qrcode: qrResult.qrcode || null,
      code: qrResult.code || null,
      state: qrResult.state,
    })
  } catch (error: any) {
    console.error('QR fetch error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar QR Code' },
      { status: 500 }
    )
  }
}
