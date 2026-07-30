import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { leadIds, contactListId, createNewList } = body

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds é obrigatório' }, { status: 400 })
    }

    const leads = await db.lead.findMany({
      where: { placeId: { in: leadIds } },
    })

    if (leads.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum lead encontrado com esses placeIds', leadIds },
        { status: 404 }
      )
    }

    const leadsWithPhone = leads.filter((l) => l.phone)
    const skippedNoPhone = leads.length - leadsWithPhone.length

    let finalContactListId = contactListId
    let createdList: any = null
    if (!finalContactListId) {
      const listName = createNewList?.name ||
        `Leads - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
      createdList = await db.contactList.create({
        data: {
          name: listName,
          columns: JSON.stringify({
            empresa: 'Empresa',
            telefone: 'Telefone',
            site: 'Site',
            endereco: 'Endereco',
            cidade: 'Cidade',
            rating: 'Rating',
            categorias: 'Categorias',
          }),
        },
      })
      finalContactListId = createdList.id
    }

    const maxPosition = await db.contact.aggregate({
      where: { contactListId: finalContactListId },
      _max: { position: true },
    })
    let nextPosition = (maxPosition._max.position || 0) + 1

    const created: any[] = []
    const errors: any[] = []

    for (const lead of leadsWithPhone) {
      try {
        const contact = await db.contact.create({
          data: {
            name: lead.name || 'Sem nome',
            phone: lead.phone || '',
            contactListId: finalContactListId,
            position: nextPosition++,
            customFields: JSON.stringify({
              empresa: lead.name,
              telefone: lead.phone || '',
              site: lead.website || '',
              endereco: lead.formattedAddress || '',
              cidade: lead.locality || '',
              estado: lead.administrativeArea || '',
              rating: lead.rating?.toString() || '',
              reviews: lead.userRatingCount?.toString() || '',
              categorias: '[]',
              fonte: 'google_places',
              placeId: lead.placeId,
              cnpj: lead.cnpj || '',
              razaoSocial: lead.razaoSocial || '',
              cnae: lead.cnaePrincipalTexto || '',
              situacao: lead.situacaoCadastral || '',
            }),
          },
        })

        await db.lead.update({
          where: { id: lead.id },
          data: {
            status: 'imported',
            importedToContactId: contact.id,
          },
        })

        created.push(contact)
      } catch (err: any) {
        errors.push({ leadId: lead.id, name: lead.name || 'Sem nome', error: err.message })
      }
    }

    return NextResponse.json({
      imported: created.length,
      skippedNoPhone,
      errors: errors.length,
      errorDetails: errors.slice(0, 10),
      contactListId: finalContactListId,
      contactListName: createdList?.name || null,
      contacts: created,
    }, { status: 201 })
  } catch (error) {
    console.error('Leads import error:', error)
    return NextResponse.json(
      { error: 'Internal server error', detail: String(error) },
      { status: 500 }
    )
  }
}
