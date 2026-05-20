import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as XLSX from 'xlsx'
import { normalizePhone } from '@/lib/phone-utils'

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.ods']
const ACCEPTED_MIMES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
]

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.substring(idx).toLowerCase() : ''
}

// Column name aliases for name/phone (case-insensitive)
const NAME_ALIASES = ['nome', 'name', 'nombre', 'cliente']
const PHONE_ALIASES = ['telefone', 'phone', 'tel', 'numero', 'número', 'celular', 'whatsapp']

function isAlias(header: string, aliases: string[]): boolean {
  return aliases.includes(header.toLowerCase().trim())
}

// Convert header name to variable key: "Vendedora Responsável" → "vendedora_responsável"
function toVarKey(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-zA-Z0-9À-ÿ]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
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

    // Parse the file using SheetJS
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]

    if (!sheet) {
      return NextResponse.json({ error: 'Arquivo vazio ou sem planilha válida' }, { status: 400 })
    }

    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nenhum dado encontrado no arquivo' }, { status: 400 })
    }

    // Detect all headers from the spreadsheet
    const headers = Object.keys(rows[0])

    // Find which column is name and which is phone
    const nameHeader = headers.find(h => isAlias(h, NAME_ALIASES)) || null
    const phoneHeader = headers.find(h => isAlias(h, PHONE_ALIASES)) || null

    if (!phoneHeader) {
      return NextResponse.json(
        { error: 'Arquivo deve ter uma coluna de telefone. Nomes aceitos: Telefone, Phone, Tel, Numero, Celular, WhatsApp' },
        { status: 400 }
      )
    }

    // Build column mapping: original header → variable key
    // This tells the system: column "WhatsApp" → use {{whatsapp}}, column "Vendedora" → use {{vendedora}}
    const columnMapping: Record<string, string> = {}
    for (const header of headers) {
      columnMapping[header] = toVarKey(header)
    }

    // Save column mapping to the ContactList
    await db.contactList.update({
      where: { id },
      data: { columns: JSON.stringify(columnMapping) },
    })

    // Build contacts
    // EVERY column value goes into customFields so {{any_column_name}} always resolves
    const contacts: { name: string; phone: string; customFields: string }[] = []

    for (const row of rows) {
      const nameValue = nameHeader ? String(row[nameHeader] || '').trim() : ''
      const phoneValue = String(row[phoneHeader] || '').trim()

      if (!phoneValue || !/\d/.test(phoneValue)) continue

      // Store ALL columns in customFields using their variable keys
      // This is the key: {{nome}}, {{whatsapp}}, {{empresa}}, {{vendedora}} etc.
      // ALL resolve from customFields — including name and phone columns!
      // e.g., if the phone column is "WhatsApp", {{whatsapp}} will resolve to the contact's number
      const customData: Record<string, string> = {}

      for (const header of headers) {
        const value = String(row[header] || '').trim()
        if (value) {
          const varKey = toVarKey(header)
          customData[varKey] = value
        }
      }

      contacts.push({
        name: nameValue || phoneValue,
        phone: phoneValue,
        customFields: Object.keys(customData).length > 0 ? JSON.stringify(customData) : '',
      })
    }

    if (contacts.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato válido encontrado no arquivo' }, { status: 400 })
    }

    // Bulk create contacts
    let created: { count: number }
    try {
      created = await db.contact.createMany({
        data: contacts.map(c => ({
          name: c.name,
          phone: normalizePhone(c.phone),
          contactListId: id,
          customFields: c.customFields || null,
        })),
      })
    } catch (dbError: any) {
      console.error('Import DB error:', dbError.message)
      let importedCount = 0
      for (const c of contacts) {
        try {
          await db.contact.create({
            data: {
              name: c.name,
              phone: normalizePhone(c.phone),
              contactListId: id,
              customFields: c.customFields || null,
            },
          })
          importedCount++
        } catch {
          // Skip duplicates or bad records
        }
      }
      return NextResponse.json({
        success: true,
        imported: importedCount,
        total: contacts.length,
        columnMapping,
        warning: `Alguns contatos podem ter sido pulados. ${importedCount} de ${contacts.length} importados.`,
      })
    }

    return NextResponse.json({
      success: true,
      imported: created.count,
      total: contacts.length,
      columnMapping,
    })
  } catch (error: any) {
    console.error('Import error:', error?.message || error)
    return NextResponse.json({ error: `Erro ao importar arquivo: ${error?.message || 'erro desconhecido'}` }, { status: 500 })
  }
}
