import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const chipId = searchParams.get('chipId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (campaignId) where.campaignId = campaignId
    if (chipId) where.chipId = chipId
    if (status) where.status = status

    const messages = await db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        chip: { select: { name: true, phoneNumber: true } },
        campaign: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
      },
      take: 200,
    })

    return NextResponse.json(messages)
  } catch (error) {
    console.error('Messages GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
