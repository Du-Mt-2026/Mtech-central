import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { fetchGroupParticipants } from '@/lib/evolution-api'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupJid: string }> }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { groupJid } = await params
    const body = await request.json()
    const { chipId, contactListName, options = {} } = body

    if (!chipId || !contactListName || !groupJid) {
      return NextResponse.json(
        { error: 'chipId, contactListName e groupJid são obrigatórios' },
        { status: 400 }
      )
    }

    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { id: true, name: true, evolutionInstance: true, status: true },
    })

    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    if (!chip.evolutionInstance) {
      return NextResponse.json(
        { error: 'Chip não tem instância Evolution associada' },
        { status: 400 }
      )
    }

    if (chip.status !== 'connected') {
      return NextResponse.json(
        { error: `Chip está ${chip.status}. Conecte-o antes de extrair membros.` },
        { status: 400 }
      )
    }

    const groupData = await fetchGroupParticipants(chip.evolutionInstance, groupJid)

    if (!groupData) {
      return NextResponse.json(
        { error: 'Não foi possível buscar metadados do grupo. Verifique se o chip ainda é membro.' },
        { status: 502 }
      )
    }

    const excludeAdmins = options.excludeAdmins === true
    const onlyWithPhone = options.onlyWithPhone !== false

    let participants = groupData.participants
    let skippedAdmin = 0
    let skippedNoPhone = 0

    if (excludeAdmins) {
      const before = participants.length
      participants = participants.filter(p => !p.isAdmin && !p.isSuperAdmin)
      skippedAdmin = before - participants.length
    }

    if (onlyWithPhone) {
      const before = participants.length
      participants = participants.filter(p => {
        if (!p.jid) return false
        if (!p.jid.endsWith('@s.whatsapp.net')) return false
        const phone = p.jid.split('@')[0]
        return phone.length >= 10
      })
      skippedNoPhone = before - participants.length
    }

    const dedupAgainstAll = options.dedupAgainstAll !== false
    const phoneList = participants.map(p => p.jid.split('@')[0])

    let existingPhones = new Set<string>()
    if (dedupAgainstAll && phoneList.length > 0) {
      for (let i = 0; i < phoneList.length; i += 500) {
        const batch = phoneList.slice(i, i + 500)
        const existing = await db.contact.findMany({
          where: { phone: { in: batch } },
          select: { phone: true },
        })
        existing.forEach(c => existingPhones.add(c.phone))
      }
    }

    const newParticipants = participants.filter(p => {
      const phone = p.jid.split('@')[0]
      return !existingPhones.has(phone)
    })

    const duplicates = participants.length - newParticipants.length

    const contactList = await db.contactList.create({
      data: {
        name: contactListName,
        source: 'group_extract',
        sourceMeta: JSON.stringify({
          groupJid,
          groupName: groupData.subject,
          extractedAt: new Date().toISOString(),
          chipId: chip.id,
          chipName: chip.name,
          totalParticipants: groupData.participants.length,
          extractedCount: newParticipants.length,
        }),
        columns: JSON.stringify({
          name: 'Nome',
          phone: 'Telefone',
        }),
      },
    })

    if (newParticipants.length > 0) {
      const contactsData = newParticipants.map((p, idx) => ({
        name: p.displayName || p.phoneNumber || `Contato ${p.jid.split('@')[0]}`,
        phone: p.jid.split('@')[0],
        position: idx,
        contactListId: contactList.id,
      }))

      for (let i = 0; i < contactsData.length; i += 500) {
        const batch = contactsData.slice(i, i + 500)
        await db.contact.createMany({ data: batch })
      }
    }

    await db.auditLog.create({
      data: {
        userId: session.userId,
        userName: session.username,
        userRole: session.role,
        action: 'EXTRACT_GROUP_MEMBERS',
        category: 'contact',
        targetType: 'contact_list',
        targetId: contactList.id,
        details: {
          groupJid,
          groupName: groupData.subject,
          chipId: chip.id,
          chipName: chip.name,
          totalExtracted: newParticipants.length,
          duplicates,
        },
      },
    })

    return NextResponse.json({
      success: true,
      contactListId: contactList.id,
      contactListName: contactList.name,
      groupName: groupData.subject,
      stats: {
        totalParticipants: groupData.participants.length,
        extracted: newParticipants.length,
        duplicates,
        skippedNoPhone,
        skippedAdmin,
      },
    })
  } catch (error: any) {
    console.error('[ExtractGroupMembers] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao extrair membros do grupo' },
      { status: 500 }
    )
  }
}
