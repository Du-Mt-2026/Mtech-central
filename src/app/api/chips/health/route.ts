import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Health score per chip — calculates a composite health metric based on:
 *
 *   1. Delivery rate (last 100 messages): 0-40 points
 *      - >= 80% → 40 pts, 60-79% → 30 pts, 40-59% → 20 pts, 20-39% → 10 pts, <20% → 0 pts
 *
 *   2. Read rate (last 100 messages): 0-20 points
 *      - >= 50% → 20 pts, 30-49% → 15 pts, 15-29% → 10 pts, 5-14% → 5 pts, <5% → 0 pts
 *
 *   3. Blocked contact ratio: 0-20 points
 *      - 0 blocked → 20 pts, 1-5% blocked → 15 pts, 5-10% → 10 pts, >10% → 0 pts
 *
 *   4. Connection stability: 0-20 points
 *      - Connected for >24h → 20 pts, >12h → 15 pts, >6h → 10 pts, <6h → 5 pts
 *
 * Total: 0-100 points
 *   80-100: HEALTHY (green)
 *   60-79:  WARNING (yellow) — slow down
 *   40-59:  AT_RISK (orange) — consider pausing
 *   0-39:   CRITICAL (red) — should pause
 *
 * Query params:
 *   - chipId: specific chip (optional, defaults to all connected)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId') || undefined

    const chips = await db.chip.findMany({
      where: {
        status: 'connected',
        ...(chipId ? { id: chipId } : {}),
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        lastSeen: true,
        warmingPhase: true,
        sentToday: true,
        dailyLimit: true,
        _count: {
          select: {
            blockedContacts: { where: { unblockedAt: null } },
          },
        },
      },
    })

    const healthScores: Array<{
      chipId: string
      chipName: string
      phoneNumber: string
      warmingPhase: string
      healthScore: number
      status: string
      recommendation: string
      details: {
        deliveryRate: number
        readRate: number
        deliveryScore: number
        readScore: number
        blockedContacts: number
        blockedScore: number
        connectionScore: number
        messagesAnalyzed: number
        sentToday: number
        dailyLimit: number
      }
    }> = []

    for (const chip of chips) {
      // 1. Delivery rate (last 100 messages)
      const recentMessages = await db.message.findMany({
        where: {
          chipId: chip.id,
          status: { in: ['sent', 'delivered', 'read', 'failed'] },
          sentAt: { not: null },
        },
        orderBy: { sentAt: 'desc' },
        take: 100,
        select: { status: true },
      })

      let deliveryScore = 0
      let readScore = 0
      let deliveryRate = 0
      let readRate = 0

      if (recentMessages.length >= 5) {
        const delivered = recentMessages.filter(m => m.status === 'delivered' || m.status === 'read').length
        const read = recentMessages.filter(m => m.status === 'read').length

        deliveryRate = (delivered / recentMessages.length) * 100
        readRate = (read / recentMessages.length) * 100

        // Delivery rate score (0-40)
        if (deliveryRate >= 80) deliveryScore = 40
        else if (deliveryRate >= 60) deliveryScore = 30
        else if (deliveryRate >= 40) deliveryScore = 20
        else if (deliveryRate >= 20) deliveryScore = 10
        else deliveryScore = 0

        // Read rate score (0-20)
        if (readRate >= 50) readScore = 20
        else if (readRate >= 30) readScore = 15
        else if (readRate >= 15) readScore = 10
        else if (readRate >= 5) readScore = 5
        else readScore = 0
      }

      // 2. Blocked contact ratio (0-20)
      const totalMessagesCount = await db.message.count({
        where: { chipId: chip.id, status: { in: ['sent', 'delivered', 'read'] } },
      })
      const blockedCount = chip._count.blockedContacts
      let blockedScore = 20
      if (totalMessagesCount > 0) {
        const blockedRatio = (blockedCount / Math.max(totalMessagesCount / 10, 1)) * 100
        if (blockedRatio > 10) blockedScore = 0
        else if (blockedRatio > 5) blockedScore = 10
        else if (blockedRatio >= 1) blockedScore = 15
      }

      // 3. Connection stability (0-20)
      let connectionScore = 5
      if (chip.lastSeen) {
        const hoursSinceLastSeen = (Date.now() - chip.lastSeen.getTime()) / (1000 * 60 * 60)
        if (hoursSinceLastSeen <= 1) connectionScore = 20  // Very stable
        else if (hoursSinceLastSeen <= 6) connectionScore = 15
        else if (hoursSinceLastSeen <= 12) connectionScore = 10
      }

      const totalScore = deliveryScore + readScore + blockedScore + connectionScore

      let status: string
      let recommendation: string

      if (totalScore >= 80) {
        status = 'healthy'
        recommendation = 'Chip operando normalmente'
      } else if (totalScore >= 60) {
        status = 'warning'
        recommendation = 'Delivery rate caindo — considerar desacelerar envios'
      } else if (totalScore >= 40) {
        status = 'at_risk'
        recommendation = 'Chip em risco — pausar campanhas e investigar'
      } else {
        status = 'critical'
        recommendation = 'Chip crítico — pausar imediatamente para evitar ban'
      }

      healthScores.push({
        chipId: chip.id,
        chipName: chip.name,
        phoneNumber: chip.phoneNumber,
        warmingPhase: chip.warmingPhase,
        healthScore: totalScore,
        status,
        recommendation,
        details: {
          deliveryRate: Math.round(deliveryRate * 10) / 10,
          readRate: Math.round(readRate * 10) / 10,
          deliveryScore,
          readScore,
          blockedContacts: blockedCount,
          blockedScore,
          connectionScore,
          messagesAnalyzed: recentMessages.length,
          sentToday: chip.sentToday,
          dailyLimit: chip.dailyLimit,
        },
      })
    }

    // Sort by health score (worst first)
    healthScores.sort((a, b) => a.healthScore - b.healthScore)

    return NextResponse.json({
      chips: healthScores,
      summary: {
        total: healthScores.length,
        healthy: healthScores.filter(h => h.status === 'healthy').length,
        warning: healthScores.filter(h => h.status === 'warning').length,
        atRisk: healthScores.filter(h => h.status === 'at_risk').length,
        critical: healthScores.filter(h => h.status === 'critical').length,
      },
    })
  } catch (error: any) {
    console.error('[ChipHealth] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
