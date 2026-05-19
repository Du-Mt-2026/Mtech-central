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
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.contact.count({ where }),
    ])

    // Detect available variables from customFields across contacts in this list
    const customKeys = new Set<string>()
    const sampleContacts = await db.contact.findMany({
      where: { contactListId: id },
      select: { customFields: true },
      take: 20,
    })
    for (const c of sampleContacts) {
      if (c.customFields) {
        try {
          const data = JSON.parse(c.customFields)
          Object.keys(data).forEach(k => customKeys.add(k))
        } catch { /* ignore */ }
      }
    }

    // Load column mapping to get original labels
    const listInfo = await db.contactList.findUnique({ where: { id }, select: { columns: true } })
    let columnLabels: Record<string, string> = {}
    try { columnLabels = JSON.parse(listInfo?.columns || '{}') } catch { /* ignore */ }

    // Build reverse mapping: variable key → original header name
    const keyToLabel: Record<string, string> = {}
    for (const [originalName, varKey] of Object.entries(columnLabels)) {
      keyToLabel[varKey] = originalName
    }

    // Core variables — always include nome and telefone
    // Also include any column aliases from the mapping (e.g., {{whatsapp}} if phone column was "WhatsApp")
    const coreVariables: Array<{ tag: string; label: string; source: string }> = [
      { tag: '{{nome}}', label: keyToLabel['nome'] || 'Nome', source: 'core' },
      { tag: '{{telefone}}', label: keyToLabel['telefone'] || 'Telefone', source: 'core' },
    ]

    // If the column mapping has aliases for core fields, add them too
    // e.g., if phone column was "WhatsApp", add {{whatsapp}} as a core variable
    for (const [varKey, originalName] of Object.entries(keyToLabel)) {
      if (varKey !== 'nome' && varKey !== 'telefone') {
        // Check if this is a core field alias (phone or name column)
        const phoneAliases = ['whatsapp', 'celular', 'numero', 'tel', 'phone']
        const nameAliases = ['name', 'nombre', 'cliente']
        if (phoneAliases.includes(varKey)) {
          coreVariables.push({ tag: `{{${varKey}}}`, label: originalName, source: 'core' })
        } else if (nameAliases.includes(varKey)) {
          coreVariables.push({ tag: `{{${varKey}}}`, label: originalName, source: 'core' })
        }
      }
    }

    // Custom variables from customFields (exclude any that are already in coreVariables)
    const coreTags = new Set(coreVariables.map(v => v.tag))
    const customVariables = Array.from(customKeys).sort()
      .filter(k => !coreTags.has(`{{${k}}}`))
      .map(k => ({
        tag: `{{${k}}}`,
        label: keyToLabel[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '),
        source: 'custom'
      }))

    const availableVariables = [...coreVariables, ...customVariables]

    // Also fetch first contact for preview data
    const firstContact = await db.contact.findFirst({
      where: { contactListId: id },
      orderBy: { createdAt: 'asc' },
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
    const { name, phone } = body

    if (!name || !phone) {
      return NextResponse.json({ error: 'Nome e telefone são obrigatórios' }, { status: 400 })
    }

    const contact = await db.contact.create({
      data: {
        name,
        phone: normalizePhone(phone),
        contactListId: id,
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
