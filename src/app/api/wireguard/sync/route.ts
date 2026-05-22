import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addWireGuardPeer } from '@/lib/wireguard-peer-api'

/**
 * POST /api/wireguard/sync
 * One-time sync: add all existing chip peers to the WireGuard server.
 */
export async function POST() {
  try {
    const chips = await db.chip.findMany({
      where: {
        wireguardIp: { not: '' },
        wireguardPubKey: { notIn: ['', 'null'] },
      },
      select: {
        id: true,
        name: true,
        wireguardIp: true,
        wireguardPubKey: true,
      },
    })

    let added = 0
    let failed = 0
    const results: Array<{ name: string; ip: string; success: boolean; message?: string }> = []

    for (const chip of chips) {
      const result = await addWireGuardPeer(chip.wireguardPubKey!, chip.wireguardIp!)
      if (result.success) {
        added++
        results.push({ name: chip.name, ip: chip.wireguardIp!, success: true, message: result.message })
      } else {
        failed++
        results.push({ name: chip.name, ip: chip.wireguardIp!, success: false, message: result.error })
      }
    }

    return NextResponse.json({
      success: true,
      total: chips.length,
      added,
      failed,
      results,
    })
  } catch (error: any) {
    console.error('WireGuard sync error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Erro ao sincronizar peers',
    }, { status: 500 })
  }
}
