import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const campaigns = await db.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { messages: true, chips: true } },
        chips: { include: { chip: { select: { name: true, phoneNumber: true } } } },
        contactList: { select: { name: true } },
        vendedor: { select: { nome: true, empresa: true } },
        messages: {
          select: { status: true },
        },
      },
    })

    const BOM = '\uFEFF'
    const lines: string[] = []

    lines.push('Relatório Geral de Campanhas')
    lines.push(`Gerado em;${new Date().toLocaleString('pt-BR')}`)
    lines.push('')

    // Summary header
    const totalCampaigns = campaigns.length
    const totalMessages = campaigns.reduce((sum, c) => sum + c._count.messages, 0)
    const statusCounts = campaigns.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1
      return acc
    }, {})

    const statusLabels: Record<string, string> = {
      draft: 'Rascunho',
      scheduled: 'Agendada',
      running: 'Ativa',
      paused: 'Pausada',
      completed: 'Concluída',
      cancelled: 'Cancelada',
      error: 'Erro',
    }

    lines.push('Resumo')
    lines.push(`Total de Campanhas;${totalCampaigns}`)
    lines.push(`Total de Mensagens;${totalMessages}`)
    for (const [status, label] of Object.entries(statusLabels)) {
      if (statusCounts[status]) {
        lines.push(`${label};${statusCounts[status]}`)
      }
    }
    lines.push('')

    // Per-campaign details
    lines.push('Detalhes por Campanha')
    lines.push('Nome;Status;Vendedor;Chips;Total Mensagens;Pendentes;Enviando;Enviadas;Entregues;Lidas;Falharam;Taxa de Envio;Taxa de Entrega;Criada Em;Iniciada Em;Concluída Em;Motivo Status')

    for (const campaign of campaigns) {
      const msgCounts = campaign.messages.reduce<Record<string, number>>((acc, m) => {
        acc[m.status] = (acc[m.status] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      const total = campaign._count.messages
      const pending = msgCounts['pending'] || 0
      const sending = msgCounts['sending'] || 0
      const sent = msgCounts['sent'] || 0
      const delivered = msgCounts['delivered'] || 0
      const read = msgCounts['read'] || 0
      const failed = msgCounts['failed'] || 0

      const successRate = total > 0 ? ((sent + delivered + read) / total * 100).toFixed(1) + '%' : '0%'
      const deliveryRate = total > 0 ? ((delivered + read) / total * 100).toFixed(1) + '%' : '0%'

      const chipsList = campaign.chips.map(cc => cc.chip.name).join(', ')
      const vendedorName = campaign.vendedor?.nome || 'Nenhum'
      const statusLabel = statusLabels[campaign.status] || campaign.status
      const reason = campaign.statusReason || ''

      lines.push(
        `"${campaign.name}";${statusLabel};${vendedorName};"${chipsList}";${total};${pending};${sending};${sent};${delivered};${read};${failed};${successRate};${deliveryRate};${campaign.createdAt.toLocaleString('pt-BR')};${campaign.startedAt?.toLocaleString('pt-BR') || ''};${campaign.completedAt?.toLocaleString('pt-BR') || ''};${reason}`
      )
    }

    const csv = BOM + lines.join('\n')
    const dateStr = new Date().toISOString().split('T')[0]

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio_geral_campanhas_${dateStr}.csv"`,
      },
    })
  } catch (error) {
    console.error('Campaigns export-all error:', error)
    return NextResponse.json({ error: 'Erro ao exportar campanhas' }, { status: 500 })
  }
}
