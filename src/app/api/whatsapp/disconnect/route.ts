import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { disconnectInstance, deleteInstance } from '@/lib/evolution-router'
import { getInstanceName } from '@/lib/evolution-api'

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

    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Try to disconnect
    try {
      await disconnectInstance(instanceName)
    } catch (err) {
      console.log('Disconnect failed, trying delete:', err)
      try {
        await deleteInstance(instanceName)
      } catch (deleteErr) {
        console.log('Delete also failed:', deleteErr)
      }
    }

    // Update chip status
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: 'disconnected',
        isQrPaired: false,
        qrPairingCode: null,
      },
    })

    return NextResponse.json({ success: true, message: 'Chip desconectado' })
  } catch (error: any) {
    console.error('Disconnect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao desconectar' },
      { status: 500 }
    )
  }
}
