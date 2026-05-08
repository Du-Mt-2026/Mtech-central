import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const steps = await db.sequenceStep.findMany({
      where: { campaignId },
      orderBy: { stepOrder: 'asc' },
    })
    return NextResponse.json(steps)
  } catch (error) {
    console.error('Steps GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const body = await req.json()
    const { steps } = body

    if (!steps || !Array.isArray(steps)) {
      return NextResponse.json({ error: 'Steps array is required' }, { status: 400 })
    }

    // Delete existing steps and recreate
    await db.sequenceStep.deleteMany({ where: { campaignId } })

    const created = await db.sequenceStep.createMany({
      data: steps.map((step: { stepOrder: number; content: string; delayMinutes: number }, index: number) => ({
        campaignId,
        stepOrder: step.stepOrder ?? index + 1,
        content: step.content,
        delayMinutes: step.delayMinutes ?? 0,
      })),
    })

    const newSteps = await db.sequenceStep.findMany({
      where: { campaignId },
      orderBy: { stepOrder: 'asc' },
    })

    return NextResponse.json(newSteps, { status: 201 })
  } catch (error) {
    console.error('Steps POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
