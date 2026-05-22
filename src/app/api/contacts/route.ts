import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/phone-utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const contactListId = searchParams.get('contactListId')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: Record<string, unknown> = {}
    if (contactListId) where.contactListId = contactListId
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
      ]
    }

    const [contacts, total] = await Promise.all([
      db.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          contactList: { select: { id: true, name: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.contact.count({ where }),
    ])

    return NextResponse.json({ contacts, total, page, limit })
  } catch (error) {
    console.error('Contacts GET error:', error)
    return NextResponse.json({ contacts: [], total: 0, page: 1, limit: 50 }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { contacts, contactListId } = body

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json({ error: 'Contacts array is required' }, { status: 400 })
    }

    const created: any[] = []
    const errors: any[] = []

    for (const c of contacts) {
      try {
        if (!c.name || !c.phone) {
          errors.push({ contact: c, error: 'Name and phone are required' })
          continue
        }
        const contact = await db.contact.create({
          data: {
            name: c.name,
            phone: normalizePhone(c.phone),
            contactListId: contactListId || null,
          },
        })
        created.push(contact)
      } catch (err: any) {
        errors.push({ contact: c, error: err.message || 'Error creating contact' })
      }
    }

    return NextResponse.json({
      created: created.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 10),
      contacts: created,
    }, { status: 201 })
  } catch (error) {
    console.error('Contacts POST error:', error)
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

    await db.message.deleteMany({ where: { contactId: id } })
    await db.contact.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
