import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Importa leads selecionados para uma ContactList.
 *
 * Body:
 *   - leadIds: string[]                  IDs dos leads a importar
 *   - contactListId: string              ID da lista existente
 *   - createNewList?: { name: string }   cria nova lista se contactListId não informado
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { leadIds, contactListId, createNewList } = body

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds é obrigatório' }, { status: 400 })
    }

    if (!contactListId && !createNewList?.name) {
      return NextResponse.json(
        { error: 'Informe contactListId ou createNewList.name' },
        { status: 400 }
      )
    }

    // Busca leads
    const leads = await db.lead.findMany({
      where: { id: { in: leadIds } },
    })

    if (leads.length === 0) {
      return NextResponse.json({ error: 'Nenhum lead encontrado' }, { status: 404 })
    }

    // Filtra apenas leads com telefone (sem telefone não dá pra importar p/ WhatsApp)
    const leadsWithPhone = leads.filter((l) => l.phone)
    const skippedNoPhone = leads.length - leadsWithPhone.length

    // Cria nova lista se necessário
    let finalContactListId = contactListId
    if (!finalContactListId && createNewList?.name) {
      const newList = await db.contactList.create({
        data: {
          name: createNewList.name,
          columns: JSON.stringify({
            empresa: 'Empresa',
            telefone: 'Telefone',
            site: 'Site',
            endereco: 'Endereço',
            cidade: 'Cidade',
            rating: 'Rating',
            categorias: 'Categorias',
          }),
        },
      })
      finalContactListId = newList.id
    }

    // Pega a maior position atual da lista
    const maxPosition = await db.contact.aggregate({
      where: { contactListId: finalContactListId },
      _max: { position: true },
    })
    let nextPosition = (maxPosition._max.position || 0) + 1

    // Cria contatos
    const created: any[] = []
    const errors: any[] = []

    for (const lead of leadsWithPhone) {
      try {
        const contact = await db.contact.create({
          data: {
            name: lead.name,
            phone: lead.phone!,
            contactListId: finalContactListId,
            position: nextPosition++,
            customFields: JSON.stringify({
              empresa: lead.name,
              telefone: lead.phoneRaw || lead.phone,
              site: lead.website || '',
              endereco: lead.address || '',
              cidade: lead.city || '',
              estado: lead.state || '',
              rating: lead.rating?.toString() || '',
              reviews: lead.reviewsCount?.toString() || '',
              categorias: lead.categories || '[]',
              fonte: 'google_places',
              placeId: lead.placeId,
            }),
          },
        })

        // Marca lead como importado
        await db.lead.update({
          where: { id: lead.id },
          data: {
            status: 'imported',
            importedToContactId: contact.id,
          },
        })

        created.push(contact)
      } catch (err: any) {
        errors.push({ leadId: lead.id, name: lead.name, error: err.message })
      }
    }

    return NextResponse.json({
      imported: created.length,
      skippedNoPhone,
      errors: errors.length,
      errorDetails: errors.slice(0, 10),
      contactListId: finalContactListId,
      contacts: created,
    }, { status: 201 })
  } catch (error) {
    console.error('Leads import error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
