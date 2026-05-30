import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pageParam = searchParams.get('page')
    const limitParam = searchParams.get('limit')
    const isPaginated = pageParam !== null

    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10) || 50))

    const where = {}

    const [campaigns, total] = isPaginated
      ? await Promise.all([
          db.campaign.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              _count: {
                select: { messages: true, chips: true },
              },
              chips: {
                include: {
                  chip: { select: { id: true, name: true, phoneNumber: true, status: true, cooldownUntil: true, sentToday: true, dailyLimit: true, hourlySent: true, warmingPhase: true } },
                },
              },
              sequenceSteps: {
                orderBy: { stepOrder: 'asc' },
              },
              contactList: {
                select: { id: true, name: true },
              },
              vendedor: {
                select: { id: true, nome: true, treatAs: true },
              },
            },
          }),
          db.campaign.count({ where }),
        ])
      : [
          await db.campaign.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
              _count: {
                select: { messages: true, chips: true },
              },
              chips: {
                include: {
                  chip: { select: { id: true, name: true, phoneNumber: true, status: true, cooldownUntil: true, sentToday: true, dailyLimit: true, hourlySent: true, warmingPhase: true } },
                },
              },
              sequenceSteps: {
                orderBy: { stepOrder: 'asc' },
              },
              contactList: {
                select: { id: true, name: true },
              },
              vendedor: {
                select: { id: true, nome: true, treatAs: true },
              },
            },
          }),
          0,
        ]

    // Single query to get all message status counts for all campaigns (fixes N+1)
    const allStatusCounts = await db.message.groupBy({
      by: ['campaignId', 'status'],
      _count: { status: true },
    })

    // Build a lookup map: campaignId -> { status: count }
    const statusMap: Record<string, Record<string, number>> = {}
    for (const sc of allStatusCounts) {
      const cId = sc.campaignId || ''
      if (!statusMap[cId]) statusMap[cId] = {}
      statusMap[cId][sc.status] = sc._count.status
    }

    const campaignsWithCounts = campaigns.map(c => ({
      ...c,
      messageStatusCounts: statusMap[c.id] || {},
    }))

    if (isPaginated) {
      return NextResponse.json({
        data: campaignsWithCounts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    }

    return NextResponse.json(campaignsWithCounts)
  } catch (error) {
    console.error('Campaigns GET error:', error)
    return NextResponse.json({ error: 'Erro ao buscar campanhas' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, sendIntervalMin, sendIntervalMax, chipIds, contactListId, steps, antiBanEnabled, warmingMode, scheduledAt, vendedorId } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Load campaign defaults from AntiBanSettings
    const settings = await db.antiBanSettings.findFirst()
    // Use campaign-specific defaults if configured, otherwise fall back to the
    // AntiBan interval (which is the safety floor). Never create a campaign
    // that sends FASTER than what the AntiBan UI says.
    const defaultSendIntervalMin = settings?.defaultSendIntervalMin ?? settings?.messageIntervalMin ?? 59
    const defaultSendIntervalMax = settings?.defaultSendIntervalMax ?? settings?.messageIntervalMax ?? 148
    const defaultAntiBanEnabled = settings?.defaultAntiBanEnabled ?? true
    const defaultWarmingMode = settings?.defaultWarmingMode ?? 'normal'

    const campaign = await db.campaign.create({
      data: {
        name,
        sendIntervalMin: sendIntervalMin || defaultSendIntervalMin,
        sendIntervalMax: sendIntervalMax || defaultSendIntervalMax,
        contactListId: contactListId || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        vendedorId: vendedorId || null,
        status: 'draft',
        antiBanEnabled: antiBanEnabled !== undefined ? antiBanEnabled : defaultAntiBanEnabled,
        warmingMode: warmingMode || defaultWarmingMode,
        chips: {
          create: (chipIds || []).map((chipId: string) => ({
            chipId,
          })),
        },
        sequenceSteps: {
          create: (steps || []).map((step: { stepOrder: number; content: string; delayMinutes: number; delayUnit?: string; mediaUrl?: string; mediatype?: string; variations?: string }) => ({
            stepOrder: step.stepOrder,
            content: step.content,
            delayMinutes: step.delayMinutes ?? 0,
            delayUnit: step.delayUnit ?? 'minutes',
            mediaUrl: step.mediaUrl || null,
            mediatype: step.mediatype || null,
            variations: step.variations || '[]',
          })),
        },
      },
      include: {
        _count: {
          select: { messages: true, chips: true },
        },
        chips: {
          include: {
            chip: { select: { id: true, name: true, phoneNumber: true, status: true, cooldownUntil: true, sentToday: true, dailyLimit: true, hourlySent: true, warmingPhase: true } },
          },
        },
        sequenceSteps: {
          orderBy: { stepOrder: 'asc' },
        },
        contactList: {
          select: { id: true, name: true },
        },
        vendedor: {
          select: { id: true, nome: true, treatAs: true },
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
