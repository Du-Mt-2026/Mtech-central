import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params

  try {
    // Fetch campaign with all related data
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: { select: { messages: true, chips: true } },
        chips: { include: { chip: { select: { id: true, name: true, phoneNumber: true } } } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        contactList: { select: { id: true, name: true } },
        vendedor: { select: { id: true, nome: true, empresa: true } },
      },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }

    // Fetch ALL messages for this campaign with contact and chip details
    const messages = await db.message.findMany({
      where: { campaignId },
      orderBy: [{ contactId: 'asc' }, { stepOrder: 'asc' }],
      include: {
        contact: { select: { name: true, phone: true, customFields: true } },
        chip: { select: { name: true, phoneNumber: true } },
      },
    })

    // Count by status
    const statusCounts = messages.reduce<Record<string, number>>((acc, msg) => {
      acc[msg.status] = (acc[msg.status] || 0) + 1
      return acc
    }, {})

    const totalMsgs = messages.length
    const sent = statusCounts['sent'] || 0
    const delivered = statusCounts['delivered'] || 0
    const read = statusCounts['read'] || 0
    const pending = statusCounts['pending'] || 0
    const sending = statusCounts['sending'] || 0
    const failed = statusCounts['failed'] || 0

    const statusLabels: Record<string, string> = {
      pending: 'Pendente',
      sending: 'Enviando',
      sent: 'Enviada',
      delivered: 'Entregue',
      read: 'Lida',
      failed: 'Falhou',
    }

    // Build CSV
    const BOM = '\uFEFF' // UTF-8 BOM for Excel compatibility
    const lines: string[] = []

    // Campaign header
    lines.push(`Relatório da Campanha: ${campaign.name}`)
    lines.push('')
    lines.push(`Status;${statusLabels[campaign.status] || campaign.status}`)
    lines.push(`Vendedor;${campaign.vendedor?.nome || 'Nenhum'}`)
    lines.push(`Lista de Contatos;${campaign.contactList?.name || 'N/A'}`)
    lines.push(`Chips Utilizados;${campaign.chips.map(cc => cc.chip.name).join(', ')}`)
    lines.push(`Intervalo de Envio;${campaign.sendIntervalMin}-${campaign.sendIntervalMax}s`)
    lines.push(`Anti-Ban;${campaign.antiBanEnabled ? `Sim (${campaign.warmingMode})` : 'Não'}`)
    lines.push(`Data de Criação;${campaign.createdAt.toLocaleString('pt-BR')}`)
    lines.push(`Data de Início;${campaign.startedAt?.toLocaleString('pt-BR') || 'N/A'}`)
    lines.push(`Data de Conclusão;${campaign.completedAt?.toLocaleString('pt-BR') || 'N/A'}`)
    if (campaign.statusReason) {
      lines.push(`Motivo do Status;${campaign.statusReason}`)
    }
    lines.push('')

    // Summary
    lines.push('Resumo de Envio')
    lines.push(`Total de Mensagens;${totalMsgs}`)
    lines.push(`Pendentes;${pending}`)
    lines.push(`Enviando;${sending}`)
    lines.push(`Enviadas;${sent}`)
    lines.push(`Entregues;${delivered}`)
    lines.push(`Lidas;${read}`)
    lines.push(`Falharam;${failed}`)
    if (totalMsgs > 0) {
      const successRate = ((sent + delivered + read) / totalMsgs * 100).toFixed(1)
      const deliveryRate = ((delivered + read) / totalMsgs * 100).toFixed(1)
      const readRate = (read / totalMsgs * 100).toFixed(1)
      lines.push(`Taxa de Envio;${successRate}%`)
      lines.push(`Taxa de Entrega;${deliveryRate}%`)
      lines.push(`Taxa de Leitura;${readRate}%`)
    }
    lines.push('')

    // Step details
    if (campaign.sequenceSteps.length > 0) {
      lines.push('Etapas da Campanha')
      lines.push('Etapa;Conteúdo;Atraso;Mídia')
      campaign.sequenceSteps.forEach(step => {
        const delayLabel = step.delayUnit === 'seconds' ? `${step.delayMinutes}s` : `${step.delayMinutes}min`
        const mediaLabel = step.mediatype ? `Sim (${step.mediatype})` : 'Não'
        lines.push(`Etapa ${step.stepOrder};"${step.content.replace(/"/g, '""')}";${delayLabel};${mediaLabel}`)
      })
      lines.push('')
    }

    // Per-contact message details
    lines.push('Detalhes por Contato')
    lines.push('Contato;Telefone;Etapa;Status;Chip;Enviado Em;Entregue Em;Lido Em;Erro;Conteúdo')

    // Group by unique contacts for a cleaner view
    const contactMap = new Map<string, {
      name: string
      phone: string
      customFields: string | null
      steps: { stepOrder: number; status: string; chipName: string; sentAt: Date | null; deliveredAt: Date | null; readAt: Date | null; error: string | null; content: string }[]
    }>()

    for (const msg of messages) {
      const key = msg.contactId
      if (!contactMap.has(key)) {
        contactMap.set(key, {
          name: msg.contact.name,
          phone: msg.contact.phone,
          customFields: msg.contact.customFields,
          steps: [],
        })
      }
      contactMap.get(key)!.steps.push({
        stepOrder: msg.stepOrder,
        status: msg.status,
        chipName: msg.chip.name,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
        error: msg.error,
        content: msg.content,
      })
    }

    // Sort contacts: failed first, then pending, then sent
    const contactEntries = Array.from(contactMap.entries()).sort((a, b) => {
      const worstStatus = (steps: { status: string }[]) => {
        const order: Record<string, number> = { failed: 0, pending: 1, sending: 2, sent: 3, delivered: 4, read: 5 }
        return Math.min(...steps.map(s => order[s.status] ?? 6))
      }
      return worstStatus(a[1].steps) - worstStatus(b[1].steps)
    })

    for (const [, contact] of contactEntries) {
      for (const step of contact.steps) {
        const statusLabel = statusLabels[step.status] || step.status
        const sentAt = step.sentAt?.toLocaleString('pt-BR') || ''
        const deliveredAt = step.deliveredAt?.toLocaleString('pt-BR') || ''
        const readAt = step.readAt?.toLocaleString('pt-BR') || ''
        const error = step.error ? `"${step.error.replace(/"/g, '""')}"` : ''
        const content = `"${step.content.replace(/"/g, '""').substring(0, 200)}"`
        lines.push(`"${contact.name}";${contact.phone};Etapa ${step.stepOrder};${statusLabel};${step.chipName};${sentAt};${deliveredAt};${readAt};${error};${content}`)
      }
    }

    // Failed contacts summary
    const failedContacts = contactEntries.filter(([, c]) => c.steps.some(s => s.status === 'failed'))
    if (failedContacts.length > 0) {
      lines.push('')
      lines.push('Contatos com Falha')
      lines.push('Contato;Telefone;Etapa;Erro')
      for (const [, contact] of failedContacts) {
        for (const step of contact.steps.filter(s => s.status === 'failed')) {
          const error = step.error ? `"${step.error.replace(/"/g, '""')}"` : 'Erro desconhecido'
          lines.push(`"${contact.name}";${contact.phone};Etapa ${step.stepOrder};${error}`)
        }
      }
    }

    const csv = BOM + lines.join('\n')

    // Generate safe filename
    const safeName = campaign.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50)

    const dateStr = new Date().toISOString().split('T')[0]

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio_${safeName}_${dateStr}.csv"`,
      },
    })
  } catch (error) {
    console.error('Campaign export error:', error)
    return NextResponse.json({ error: 'Erro ao exportar campanha' }, { status: 500 })
  }
}
