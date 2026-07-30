// /opt/octupuszap/src/app/api/leads/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { leadIds, format = 'csv' } = body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds[] é obrigatório' }, { status: 400 });
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    include: {
      tagAssignments: { include: { tag: true } },
      listMemberships: { include: { list: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const headers = [
    'Nome', 'Razao Social', 'CNPJ', 'CNPJ Formatado', 'Situacao Cadastral',
    'Telefone', 'Telefone Receita', 'Email Receita', 'Website',
    'Endereco', 'Bairro', 'Municipio', 'UF', 'CEP',
    'CNAE Principal', 'Rating', 'Reviews',
    'Score', 'Pipeline Status', 'Tags', 'Listas', 'Data Criacao',
  ];

  const rows = leads.map((lead) => [
    lead.name || '',
    lead.razaoSocial || '',
    lead.cnpj || '',
    lead.cnpjFormatted || '',
    lead.situacaoCadastral || '',
    lead.phone || '',
    lead.telefoneReceita || '',
    lead.emailReceita || '',
    lead.website || '',
    lead.formattedAddress || '',
    lead.enderecoBairro || '',
    lead.enderecoMunicipio || lead.locality || '',
    lead.enderecoUf || lead.administrativeArea || '',
    lead.enderecoCep || lead.postalCode || '',
    lead.cnaePrincipalTexto || '',
    lead.rating != null ? String(lead.rating) : '',
    lead.userRatingCount != null ? String(lead.userRatingCount) : '',
    lead.score != null ? String(lead.score) : '',
    lead.pipelineStatus || '',
    lead.tagAssignments.map((a) => a.tag.name).join('; '),
    lead.listMemberships.map((m) => m.list.name).join('; '),
    lead.createdAt.toISOString(),
  ]);

  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');

  return new NextResponse('\ufeff' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
