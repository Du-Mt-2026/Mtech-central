import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { testConnection, fetchOctupusZapInstances } from '@/lib/evolution-api'

const DAILY_VERIFY_LIMIT = 300

export async function GET() {
  try {
    // Get all chips with verification stats
    const chips = await db.chip.findMany({
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        status: true,
        evolutionInstance: true,
        verifiedToday: true,
        lastVerifiedResetAt: true,
        proxyMode: true,
        socks5Host: true,
        socks5Port: true,
        socks5User: true,
        socks5Pass: true,
        wireguardIp: true,
        socksPort: true,
      },
      orderBy: { name: 'asc' },
    })

    // Reset daily counters if needed
    const now = new Date()
    const updatedChips = await Promise.all(
      chips.map(async (chip) => {
        const lastReset = new Date(chip.lastVerifiedResetAt)
        const isDifferentDay = now.getFullYear() !== lastReset.getFullYear() ||
          now.getMonth() !== lastReset.getMonth() ||
          now.getDate() !== lastReset.getDate()

        if (isDifferentDay && chip.verifiedToday > 0) {
          await db.chip.update({
            where: { id: chip.id },
            data: { verifiedToday: 0, lastVerifiedResetAt: now },
          })
          return { ...chip, verifiedToday: 0 }
        }
        return chip
      })
    )

    // Check which chips are actually connected via Evolution API
    let connectedInstances: Set<string> = new Set()
    try {
      const evolutionTest = await testConnection()
      if (evolutionTest.success) {
        const instances = await fetchOctupusZapInstances()
        for (const inst of instances) {
          if (inst.connectionStatus === 'open') {
            connectedInstances.add(inst.name)
          }
        }
      }
    } catch {
      // Can't reach Evolution API
    }

    // Enrich chip data with connection and quota info
    const enrichedChips = updatedChips.map(chip => {
      const instanceName = chip.evolutionInstance
      const isConnected = instanceName ? connectedInstances.has(instanceName) : chip.status === 'connected'
      const quotaRemaining = DAILY_VERIFY_LIMIT - chip.verifiedToday
      const quotaPercentage = (chip.verifiedToday / DAILY_VERIFY_LIMIT) * 100

      return {
        ...chip,
        isConnected,
        dailyLimit: DAILY_VERIFY_LIMIT,
        quotaRemaining,
        quotaPercentage: Math.min(quotaPercentage, 100),
        quotaExhausted: chip.verifiedToday >= DAILY_VERIFY_LIMIT,
      }
    })

    return NextResponse.json({ chips: enrichedChips, dailyLimit: DAILY_VERIFY_LIMIT })
  } catch (error: any) {
    console.error('Chip status error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar status dos chips' },
      { status: 500 }
    )
  }
}
