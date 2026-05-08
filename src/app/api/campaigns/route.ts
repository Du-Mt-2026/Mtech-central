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
    const { name, messageVariations, sendIntervalMin, sendIntervalMax, chipIds } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const campaign = await db.campaign.create({
      data: {
        name,
        messageVariations: messageVariations || '',
        sendIntervalMin: sendIntervalMin || 30,
        sendIntervalMax: sendIntervalMax || 90,
        status: 'draft',
        chips: {
          create: (chipIds || []).map((chipId: string) => ({
            chipId,
          })),
        },
      },
      include: {
        _count: {
          select: { messages: true, chips: true },
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

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, status } = body

    if (!id || !status) {
      return NextResponse.json(
        { error: 'ID and status are required' },
        { status: 400 }
      )
    }

    const campaign = await db.campaign.update({
      where: { id },
      data: { status },
      include: {
        _count: {
          select: { messages: true, chips: true },
        },
      },
    })

    return NextResponse.json(campaign)
  } catch (error) {
    console.error('Campaigns PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    await db.campaignChip.deleteMany({ where: { campaignId: id } })
    await db.message.deleteMany({ where: { campaignId: id } })
    await db.campaign.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Campaigns DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
