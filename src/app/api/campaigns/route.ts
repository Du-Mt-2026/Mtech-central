import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const campaigns = await db.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true, chips: true },
        },
        chips: {
          include: {
            chip: { select: { id: true, name: true, phoneNumber: true, status: true } },
          },
        },
        sequenceSteps: {
          orderBy: { stepOrder: 'asc' },
        },
        contactList: {
          select: { id: true, name: true },
        },
      },
    })
    return NextResponse.json(campaigns)
  } catch (error) {
    console.error('Campaigns GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, sendIntervalMin, sendIntervalMax, chipIds, contactListId, steps, antiBanEnabled, warmingMode, scheduledAt, messageVariations } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const campaign = await db.campaign.create({
      data: {
        name,
        messageVariations: messageVariations || '[]',
        sendIntervalMin: sendIntervalMin || 30,
        sendIntervalMax: sendIntervalMax || 90,
        contactListId: contactListId || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: 'draft',
        antiBanEnabled: antiBanEnabled !== undefined ? antiBanEnabled : true,
        warmingMode: warmingMode || 'normal',
        chips: {
          create: (chipIds || []).map((chipId: string) => ({
            chipId,
          })),
        },
        sequenceSteps: {
          create: (steps || []).map((step: { stepOrder: number; content: string; delayMinutes: number; mediaUrl?: string; mediatype?: string }) => ({
            stepOrder: step.stepOrder,
            content: step.content,
            delayMinutes: step.delayMinutes ?? 0,
            mediaUrl: step.mediaUrl || null,
            mediatype: step.mediatype || null,
          })),
        },
      },
      include: {
        _count: {
          select: { messages: true, chips: true },
        },
        chips: {
          include: {
            chip: { select: { id: true, name: true, phoneNumber: true, status: true } },
          },
        },
        sequenceSteps: {
          orderBy: { stepOrder: 'asc' },
        },
        contactList: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    console.error('Campaigns POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
