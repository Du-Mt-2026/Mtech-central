import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const queries = await db.searchQuery.findMany({
      orderBy: { lastRunAt: 'desc' },
      take: 50,
      include: {
        _count: { select: { leads: true } },
      },
    })
    return NextResponse.json(queries)
  } catch (error) {
    console.error('SearchQueries GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 })

    // Deleta leads associados primeiro ( cascade seria melhor, mas vamos fazer explícito)
    await db.lead.deleteMany({ where: { searchQueryId: id } })
    await db.searchQuery.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('SearchQuery DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
