import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { disconnectInstance, getInstanceName, deleteInstance } from '@/lib/evolution-api'

export async function POST() {
  try {
    // Find the currently connected chip used for verification
    const chip = await db.chip.findFirst({
      where: {
        status: 'connected',
        evolutionInstance: { not: '' },
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (!chip) {
      // No connected chip, nothing to disconnect
      return NextResponse.json({ success: true, message: 'Nenhum chip conectado para desconectar' })
    }

    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Try to disconnect via Evolution API
    try {
      await disconnectInstance(instanceName)
    } catch (err) {
      console.log('Verifier disconnect failed, trying delete:', err)
      try {
        await deleteInstance(instanceName)
      } catch (deleteErr) {
        console.log('Verifier delete also failed:', deleteErr)
      }
    }

    // Update chip status in DB
    await db.chip.update({
      where: { id: chip.id },
      data: {
        status: 'disconnected',
        isQrPaired: false,
        qrPairingCode: null,
      },
    })

    return NextResponse.json({ success: true, message: 'WhatsApp desconectado' })
  } catch (error: any) {
    console.error('Verifier disconnect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao desconectar' },
      { status: 500 }
    )
  }
}
