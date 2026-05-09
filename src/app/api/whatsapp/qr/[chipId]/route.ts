import { NextResponse } from 'next/server'
import { connectInstance, getInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'

export async function GET(request: Request, { params }: { params: Promise<{ chipId: string }> }) {
  try {
    const { chipId } = await params

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    const instanceName = getInstanceName(chip.id, chip.name)

    // Fetch QR code by connecting/reconnecting
    const connectResult = await connectInstance(instanceName)

    // Update chip status
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: 'connecting',
        qrPairingCode: connectResult.code || null,
      },
    })

    return NextResponse.json({
      qrcode: connectResult.base64 || null,
      code: connectResult.code || null,
    })
  } catch (error: any) {
    console.error('QR fetch error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar QR Code' },
      { status: 500 }
    )
  }
}
