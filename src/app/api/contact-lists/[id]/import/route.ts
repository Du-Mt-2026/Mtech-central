import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as XLSX from 'xlsx'
import { normalizePhone } from '@/lib/phone-utils'

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.ods']
const ACCEPTED_MIMES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
]

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.substring(idx).toLowerCase() : ''
}

// Column name aliases for core fields (case-insensitive)
const NAME_ALIASES = ['nome', 'name', 'nombre', 'cliente']
const PHONE_ALIASES = ['telefone', 'phone', 'tel', 'numero', 'número', 'celular', 'whatsapp']
// empresa is also a common column but goes into customFields like everything else

function findColumnAlias(header: string, aliases: string[]): boolean {
  const h = header.toLowerCase().trim()
  return aliases.includes(h)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Arquivo é obrigatório' }, { status: 400 })
    }

    const ext = getFileExtension(file.name)

    if (!ACCEPTED_EXTENSIONS.includes(ext) && !ACCEPTED_MIMES.includes(file.type)) {
      return NextResponse.json(
        { error: `Formato não suportado. Aceitos: ${ACCEPTED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      )
    }

    // Verify list exists
    const list = await db.contactList.findUnique({ where: { id } })
    if (!list) {
      return NextResponse.json({ error: 'Lista não encontrada' }, { status: 404 })
    }

    // Parse the file using SheetJS (handles CSV, XLSX, XLS, ODS)
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]

    if (!sheet) {
      return NextResponse.json({ error: 'Arquivo vazio ou sem planilha válida' }, { status: 400 })
    }

    // Convert sheet to array of objects
    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nenhum dado encontrado no arquivo' }, { status: 400 })
    }

    // Detect all headers from the spreadsheet
    const headers = Object.keys(rows[0])

    // Find name and phone columns (core fields)
    const nameHeader = headers.find(h => findColumnAlias(h, NAME_ALIASES)) || null
    const phoneHeader = headers.find(h => findColumnAlias(h, PHONE_ALIASES)) || null

    if (!phoneHeader) {
      return NextResponse.json(
        { error: 'Arquivo deve ter uma coluna de telefone. Nomes aceitos: Telefone, Phone, Tel, Numero, Celular, WhatsApp' },
        { status: 400 }
      )
    }

    // Extra columns (everything except name and phone) go into customFields
    const extraHeaders = headers.filter(h => h !== nameHeader && h !== phoneHeader)
    const detectedColumns = [
      nameHeader ? { name: nameHeader, variable: 'nome', type: 'core' } : null,
      { name: phoneHeader, variable: 'telefone', type: 'core' },
      ...extraHeaders.map(h => ({ name: h, variable: h.toLowerCase().replace(/\s+/g, '_'), type: 'custom' })),
    ].filter(Boolean) as Array<{ name: string; variable: string; type: string }>

    // Build contacts with customFields
    const contacts: { name: string; phone: string; customFields: string }[] = []
    for (const row of rows) {
      const name = nameHeader ? String(row[nameHeader] || '').trim() : ''
      const phone = String(row[phoneHeader] || '').trim()
      if (phone && /\d/.test(phone)) {
        // Collect extra columns into customFields JSON
        const customData: Record<string, string> = {}
        for (const header of extraHeaders) {
          const value = String(row[header] || '').trim()
          if (value) {
            customData[header.toLowerCase().replace(/\s+/g, '_')] = value
          }
        }

        contacts.push({
          name: name || phone,
          phone,
          customFields: Object.keys(customData).length > 0 ? JSON.stringify(customData) : '',
        })
      }
    }

    if (contacts.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato válido encontrado no arquivo' }, { status: 400 })
    }

    // Bulk create contacts (normalize phones)
    const created = await db.contact.createMany({
      data: contacts.map(c => ({
        name: c.name,
        phone: normalizePhone(c.phone),
        contactListId: id,
        customFields: c.customFields || null,
      })),
      skipDuplicates: true,
    })

    return NextResponse.json({
      success: true,
      imported: created.count,
      total: contacts.length,
      detectedColumns,
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: 'Erro ao importar arquivo' }, { status: 500 })
  }
}
