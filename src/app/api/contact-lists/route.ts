import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const lists = await db.contactList.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { contacts: true, campaigns: true },
        },
      },
    })
    return NextResponse.json(lists)
  } catch (error) {
    console.error('ContactLists GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const list = await db.contactList.create({
      data: { name },
      include: {
        _count: { select: { contacts: true } },
      },
    })

    return NextResponse.json(list, { status: 201 })
  } catch (error) {
    console.error('ContactLists POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    await db.contact.deleteMany({ where: { contactListId: id } })
    await db.contactList.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('ContactList DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
