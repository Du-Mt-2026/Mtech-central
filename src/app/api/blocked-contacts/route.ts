import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * List blocked contacts (active only by default).
 *
 * Query params:
 *   - includeUnblocked: if true, also shows unblocked contacts (default: false)
 *   - chipId: filter by chip (optional)
 *   - confidence: filter by confidence level (optional: "low", "medium", "high")
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const includeUnblocked = searchParams.get('includeUnblocked') === 'true'
    const chipId = searchParams.get('chipId') || undefined
    const confidence = searchParams.get('confidence') || undefined

    const where: any = {}
    if (!includeUnblocked) {
      where.unblockedAt = null // Only active blocks
    }
    if (chipId) {
      where.chipId = chipId
    }
    if (confidence) {
      where.confidence = confidence
    }

    const blockedContacts = await db.blockedContact.findMany({
      where,
      include: {
        chip: { select: { id: true, name: true, phoneNumber: true } },
        contact: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { detectedAt: 'desc' },
    })

    // Get summary stats
    const [totalActive, totalHigh, totalMedium, totalLow] = await Promise.all([
      db.blockedContact.count({ where: { unblockedAt: null } }),
      db.blockedContact.count({ where: { unblockedAt: null, confidence: 'high' } }),
      db.blockedContact.count({ where: { unblockedAt: null, confidence: 'medium' } }),
      db.blockedContact.count({ where: { unblockedAt: null, confidence: 'low' } }),
    ])

    return NextResponse.json({
      blockedContacts,
      stats: { totalActive, totalHigh, totalMedium, totalLow },
    })
  } catch (error: any) {
    console.error('[BlockedContacts] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
