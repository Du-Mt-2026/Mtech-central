// /opt/octupuszap/src/app/api/leads/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Escape RFC 4180 — sempre coloca aspas quando há vírgula, aspas, quebra de linha, ou leading/trailing whitespace
function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r') || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Formata telefone brasileiro: 48996707979 -> (48) 99670-7979
function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return phone;
}

// Formata data ISO -> DD/MM/YYYY HH:MM
function formatDateBR(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Status CNPJ legível em PT-BR
function cnpjStatusLabel(lead: any): string {
  if (lead.cnpj) return 'Encontrado';
  if (lead.cnpjFetchStatus === 'not_found') return 'Não encontrado';
  if (lead.cnpjFetchStatus === 'error') return 'Erro';
  return 'Pendente';
}

// Status ReceitaWS legível em PT-BR
function receitawsStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const map: Record<string, string> = {
    ok: 'OK',
    pending: 'Pendente',
    error: 'Erro',
  };
  return map[status] || status;
}

// Pipeline status traduzido
function pipelineLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const map: Record<string, string> = {
    novo: 'Novo',
    contatado: 'Contatado',
    qualificado: 'Qualificado',
    cliente: 'Cliente',
    descartado: 'Descartado',
  };
  return map[status] || status;
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
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
  });

  // Cabeçalhos amigáveis, em PT-BR, com agrupamento lógico
  const headers = [
    // Identificação
    'Nome',
    'Nome Fantasia',
    'Razão Social',
    // CNPJ
    'CNPJ',
    'Situação Cadastral',
    'Status CNPJ',
    'Data Abertura',
    'Natureza Jurídica',
    'Porte',
    'Capital Social',
    // Contato
    'Telefone',
    'Telefone (Receita)',
    'Email (Receita)',
    'Website',
    // Endereço (Receita — autoritativo)
    'Endereço (Receita)',
    'Bairro',
    'Município',
    'UF',
    'CEP',
    // Endereço (Google Places — fallback)
    'Endereço (Google)',
    'Cidade (Google)',
    'UF (Google)',
    // Atividade
    'CNAE Principal',
    'CNAE Código',
    // Google Places
    'Rating',
    'Avaliações',
    'Google Maps',
    // Pipeline / Score / Tags
    'Pipeline',
    'Score',
    'Tags',
    'Listas',
    'Status ReceitaWS',
    // Auditoria
    'Criado em',
  ];

  const rows = leads.map((lead) => [
    // Identificação
    lead.name || '',
    lead.nomeFantasia || '',
    lead.razaoSocial || '',
    // CNPJ
    lead.cnpjFormatted || lead.cnpj || '',
    lead.situacaoCadastral || '',
    cnpjStatusLabel(lead),
    lead.dataAbertura || '',
    lead.naturezaJuridica || '',
    lead.porte || '',
    lead.capitalSocial != null ? `R$ ${lead.capitalSocial.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
    // Contato
    formatPhone(lead.phone),
    formatPhone(lead.telefoneReceita),
    lead.emailReceita || '',
    lead.website || '',
    // Endereço (Receita)
    [lead.enderecoLogradouro, lead.enderecoNumero, lead.enderecoComplemento].filter(Boolean).join(', ') || '',
    lead.enderecoBairro || '',
    lead.enderecoMunicipio || '',
    lead.enderecoUf || '',
    lead.enderecoCep || '',
    // Endereço (Google)
    lead.formattedAddress || '',
    lead.locality || '',
    lead.administrativeArea || '',
    // Atividade
    lead.cnaePrincipalTexto || '',
    lead.cnaePrincipalCodigo || '',
    // Google Places
    lead.rating != null ? lead.rating.toFixed(1) : '',
    lead.userRatingCount != null ? String(lead.userRatingCount) : '',
    lead.googleMapsUri || '',
    // Pipeline / Score / Tags
    pipelineLabel(lead.pipelineStatus),
    lead.score != null ? String(lead.score) : '',
    lead.tagAssignments.map((a) => a.tag.name).join('; '),
    lead.listMemberships.map((m) => m.list.name).join('; '),
    receitawsStatusLabel(lead.receitawsStatus),
    // Auditoria
    formatDateBR(lead.createdAt),
  ]);

  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');

  return new NextResponse('\ufeff' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
