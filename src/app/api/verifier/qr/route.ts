import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  getInstanceQRCode,
  getConnectionState,
  getInstanceName,
} from '@/lib/evolution-api'

/**
 * GET /api/verifier/qr?chipId=xxx
 *
 * CRITICAL FIX: This endpoint is called every 3 seconds by the frontend polling.
 * It MUST NOT call connectInstance() — that would:
 *   1) Call POST /instance/connect WITHOUT a webhook URL, overwriting the webhook
 *      configured during the initial connect, causing the "Connected" webhook event
 *      to never be delivered after QR scan.
 *   2) Disrupt the WhatsApp session establishment by creating a new WebSocket
 *      on every poll, invalidating the QR code and/or the session being established.
 *
 * Instead, this endpoint:
 *   1) First checks /instance/status to see if the instance is already connected
 *   2) If connected, updates DB and returns connected status
 *   3) If not connected, fetches QR code via GET /instance/qr (non-disruptive)
 *   4) Returns the QR code for the frontend to display
 */
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

    // Step 1: Check real connection status via /instance/status (non-disruptive)
    try {
      const stateResult = await getConnectionState(instanceName)
      const isConnected = stateResult.state === 'open'

      if (isConnected) {
        // Instance is connected — update DB and return
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
    } catch {
      // Status check failed — fall through to QR fetch
    }

    // Step 2: Not connected — fetch QR code via GET /instance/qr (non-disruptive)
    // This does NOT call POST /instance/connect, so it won't disrupt the session
    // or overwrite the webhook URL.
    try {
      const qrResult = await getInstanceQRCode(instanceName)

      // QR fetch might return state='open' if session was just established
      if (qrResult.state === 'open') {
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

      // Update chip status to connecting
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: 'connecting',
          qrPairingCode: qrResult.code || qrResult.pairingCode || null,
        },
      })

      // Return QR code for the frontend to display
      return NextResponse.json({
        qrCode: qrResult.qrcode || null,
        code: qrResult.code || qrResult.pairingCode || null,
        connected: false,
        status: 'connecting',
      })
    } catch (qrError: any) {
      // QR code not available yet — instance might still be connecting
      // Return connecting status without erroring (frontend will retry on next poll)
      return NextResponse.json({
        qrCode: null,
        code: null,
        connected: false,
        status: 'connecting',
      })
    }
  } catch (error: any) {
    console.error('Verifier QR error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao obter QR Code' },
      { status: 500 }
    )
  }
}
