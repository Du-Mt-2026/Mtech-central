import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { connectInstance, getInstanceName } from '@/lib/evolution-api'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId')

    if (!chipId) {
      return NextResponse.json(
        { error: 'chipId é obrigatório (query param)' },
        { status: 400 }
      )
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Connect/reconnect to get fresh QR code
    const connectResult = await connectInstance(instanceName)

    const isConnected = connectResult.state === 'open'

    if (isConnected) {
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: 'connected',
          isQrPaired: true,
          lastSeen: new Date(),
        },
      })

      return NextResponse.json({
        qrCode: null,
        connected: true,
        status: 'connected',
      })
    }

    // Update chip status
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: 'connecting',
        qrPairingCode: connectResult.code || connectResult.pairingCode || null,
      },
    })

    // Return QR code — the Evolution API returns base64 in connectResult.qrcode
    return NextResponse.json({
      qrCode: connectResult.qrcode || null,
      code: connectResult.code || connectResult.pairingCode || null,
      connected: false,
      status: 'connecting',
    })
  } catch (error: any) {
    console.error('Verifier QR error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao obter QR Code' },
      { status: 500 }
    )
  }
}
