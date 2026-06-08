import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/phone-utils'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: Record<string, unknown> = { contactListId: id }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
      ]
    }

    const [contacts, total] = await Promise.all([
      db.contact.findMany({
        where,
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.contact.count({ where }),
    ])

    // Build available variables from the column mapping stored on the ContactList
    // columnMapping = {"Nome": "nome", "WhatsApp": "whatsapp", "Empresa": "empresa", "Vendedora": "vendedora"}
    const listInfo = await db.contactList.findUnique({ where: { id }, select: { columns: true } })
    let columnMapping: Record<string, string> = {}
    try { columnMapping = JSON.parse(listInfo?.columns || '{}') } catch { /* ignore */ }

    // Each column becomes a variable: {{variable_key}}
    const availableVariables = Object.entries(columnMapping).map(([originalName, varKey]) => ({
      tag: `{{${varKey}}}`,
      label: originalName,
      source: 'custom' as const,
    }))

    // Fetch first contact for preview data (real values from the spreadsheet)
    const firstContact = await db.contact.findFirst({
      where: { contactListId: id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ contacts, total, page, limit, availableVariables, firstContact })
  } catch (error) {
    console.error('Contacts GET error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await req.json()
    const { name, phone, customFields } = body

    if (!name || !phone) {
      return NextResponse.json({ error: 'Nome e telefone são obrigatórios' }, { status: 400 })
    }

    const existingCount = await db.contact.count({ where: { contactListId: id } })
    const contact = await db.contact.create({
      data: {
        name,
        phone: normalizePhone(phone),
        contactListId: id,
        position: existingCount,
        customFields: customFields && Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null,
      },
    })

    return NextResponse.json(contact, { status: 201 })
  } catch (error) {
    console.error('Contact POST error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    // Delete all contacts in this list that are not linked to a chip
    await db.contact.deleteMany({
      where: {
        contactListId: id,
        chipId: null,
      },
    })
    // Unlink contacts that are linked to a chip
    await db.contact.updateMany({
      where: {
        contactListId: id,
        chipId: { not: null },
      },
      data: { contactListId: null },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contacts DELETE error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
