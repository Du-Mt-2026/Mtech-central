import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Arquivo CSV é obrigatório' }, { status: 400 })
    }

    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      return NextResponse.json({ error: 'Apenas arquivos CSV são aceitos' }, { status: 400 })
    }

    // Verify list exists
    const list = await db.contactList.findUnique({ where: { id } })
    if (!list) {
      return NextResponse.json({ error: 'Lista não encontrada' }, { status: 404 })
    }

    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(line => line.trim())

    if (lines.length === 0) {
      return NextResponse.json({ error: 'Arquivo CSV vazio' }, { status: 400 })
    }

    // Parse CSV: first line is header, expect "nome" and "telefone" columns
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))

    const nameIdx = header.findIndex(h => h === 'nome' || h === 'name')
    const phoneIdx = header.findIndex(h => h === 'telefone' || h === 'phone' || h === 'tel')

    if (nameIdx === -1 || phoneIdx === -1) {
      return NextResponse.json(
        { error: 'CSV deve ter colunas "nome" e "telefone" no cabeçalho' },
        { status: 400 }
      )
    }

    const contacts: { name: string; phone: string }[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''))
      const name = cols[nameIdx]
      const phone = cols[phoneIdx]
      if (name && phone) {
        contacts.push({ name, phone })
      }
    }

    if (contacts.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato válido encontrado no CSV' }, { status: 400 })
    }

    // Bulk create contacts
    const created = await db.contact.createMany({
      data: contacts.map(c => ({
        name: c.name,
        phone: c.phone,
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
    console.error('CSV Import error:', error)
    return NextResponse.json({ error: 'Erro ao importar CSV' }, { status: 500 })
  }
}
