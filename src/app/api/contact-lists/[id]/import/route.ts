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

    // Find name and phone columns (case-insensitive)
    const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim())
    const nameIdx = headers.findIndex(h =>
      h === 'nome' || h === 'name' || h === 'nombre' || h === 'cliente'
    )
    const phoneIdx = headers.findIndex(h =>
      h === 'telefone' || h === 'phone' || h === 'tel' || h === 'numero' || h === 'número' || h === 'celular' || h === 'whatsapp'
    )

    if (phoneIdx === -1) {
      return NextResponse.json(
        { error: 'Arquivo deve ter uma coluna de telefone. Nomes aceitos: telefone, phone, tel, numero, celular, whatsapp' },
        { status: 400 }
      )
    }

    const nameHeader = nameIdx >= 0 ? Object.keys(rows[0])[nameIdx] : null
    const phoneHeader = Object.keys(rows[0])[phoneIdx]

    const contacts: { name: string; phone: string }[] = []
    for (const row of rows) {
      const name = nameHeader ? String(row[nameHeader] || '').trim() : ''
      const phone = String(row[phoneHeader] || '').trim()
      if (phone && /\d/.test(phone)) {
        contacts.push({
          name: name || phone,
          phone,
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
      })),
      skipDuplicates: true,
    })

    return NextResponse.json({
      success: true,
      imported: created.count,
      total: contacts.length,
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: 'Erro ao importar arquivo' }, { status: 500 })
  }
}
