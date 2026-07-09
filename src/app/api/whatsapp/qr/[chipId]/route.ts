import { NextResponse } from 'next/server'
import { getInstanceQRCode } from '@/lib/evolution-router'
import { getInstanceName as v3GetInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'
import { getQRCode } from '@/lib/qr-cache'

export async function GET(request: Request, { params }: { params: Promise<{ chipId: string }> }) {
  try {
    const { chipId } = await params

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // Build instance name
    const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)

    // PRIMEIRO: checa cache de QR code (recebido via webhook)
    const cachedQR = getQRCode(instanceName)
    if (cachedQR?.qrcode) {
      console.log(`[QR route] QR code encontrado no cache para ${instanceName}`)
      return NextResponse.json({
        qrcode: cachedQR.qrcode,
        code: cachedQR.code || null,
        state: 'close',
      })
    }

    // Se não tem no cache, busca via API
    let qrResult: { qrcode: string | null; code: string | null; pairingCode: string | null; state: string } | null = null
    let lastErr: any = null
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await getInstanceQRCode(instanceName)
        if (r.qrcode || r.state === 'open') {
          qrResult = r
          break
        }
        console.log(`[QR route] Tentativa ${attempt}/3: sem QR ainda, aguardando 2s...`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000))
      } catch (err) {
        lastErr = err
        console.warn(`[QR route] Tentativa ${attempt}/3 falhou:`, err)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000))
      }
    }
    
    if (!qrResult) {
      if (lastErr) throw lastErr
      qrResult = { qrcode: null, code: null, pairingCode: null, state: 'close' }
    }

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
