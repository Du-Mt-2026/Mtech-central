import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { disconnectInstance, deleteInstance, getInstanceName } from '@/lib/evolution-api'

/**
 * POST /api/verifier/disconnect
 *
 * FIX: Now accepts chipId in the request body to disconnect a SPECIFIC chip.
 * Previously disconnected the first connected chip found (wrong chip if multiple connected).
 * Falls back to finding the first connected chip if no chipId is provided (backward compat).
 */
export async function POST(request: NextRequest) {
  try {
    // Try to read chipId from request body
    let chipId: string | null = null
    try {
      const body = await request.json()
      chipId = body.chipId || null
    } catch {
      // No body or invalid JSON — fall back to finding any connected chip
    }

    let chip

    if (chipId) {
      // Disconnect the specific chip requested
      chip = await db.chip.findUnique({ where: { id: chipId } })
      if (!chip) {
        return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
      }
    } else {
      // Backward compat: find the currently connected chip used for verification
      chip = await db.chip.findFirst({
        where: {
          status: 'connected',
          evolutionInstance: { not: '' },
        },
        orderBy: { updatedAt: 'desc' },
      })
    }

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
