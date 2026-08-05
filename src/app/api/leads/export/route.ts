// /opt/octupuszap/src/app/api/leads/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { generateLeadsXlsx, type LeadRow } from '@/lib/leads-xlsx-export';
const prisma = new PrismaClient();

// Separador ponto-e-vírgula — padrão do Excel brasileiro (abi/pt-BR)
const SEP = ';';

// Escape RFC 4180 adaptado para `;` — sempre coloca aspas quando há `;`, aspas, quebra de linha, ou leading/trailing whitespace
function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r') || s !== s.trim()) {
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

// Encurta URL do Google Maps — usa place_id quando disponível (muito mais curto e estável)
// Entrada típica: https://www.google.com/maps/place/Nonna%27s+Cantina+e+Pizzaria/data=!4m7!3m6!1s0x9521831f82bfb97b:0x7c2102cc59bf3078!8m2!3d-28.6754608!4d-49.408657!16s%2Fg%2F11c5bg1ql8!19sChIJe7m_gh-DIZUReDC_WcwCIXw
// Saída:         https://www.google.com/maps/place/?q=place_id:ChIJe7m_gh-DIZUReDC_WcwCIXw
function shortenMapsUrl(uri: string | null | undefined): string {
  if (!uri) return '';
  // Extrai place_id do final da URL (depois de !19s ou !1s)
  const placeIdMatch = uri.match(/!1?s[=:]([A-Za-z0-9_-]{10,})/);
  if (placeIdMatch && placeIdMatch[1]) {
    return `https://www.google.com/maps/place/?q=place_id:${placeIdMatch[1]}`;
  }
  // Fallback: se a URL for muito longa (>200 chars), trunca no primeiro `!` ou `?`
  if (uri.length > 200) {
    const cutIdx = uri.indexOf('?');
    if (cutIdx > 0) return uri.slice(0, cutIdx);
    const dataIdx = uri.indexOf('/data=');
    if (dataIdx > 0) return uri.slice(0, dataIdx);
  }
  return uri;
}

// Concatena endereço completo (logradouro + número + complemento)
function formatEndereco(l: any): string {
  return [l.enderecoLogradouro, l.enderecoNumero, l.enderecoComplemento]
    .filter(Boolean)
    .join(', ') || '';
}

/**
 * Defensive fallback: when structured fields are NULL but receitawsJson is saved,
 * parse the JSON locally to extract the missing fields on the fly.
 *
 * This protects the export from any past bugs in receitawsToDBFields (like the
 * one fixed in 99499e6 — address fields were read from r.endereco?.bairro
 * instead of r.bairro, leaving them NULL even when JSON had the data).
 *
 * With this fallback, the XLSX export will show correct data immediately after
 * deploy, without needing to run /api/admin/backfill-receitaws-fields first.
 */
function fallbackFromReceitawsJson(lead: any): any {
  if (!lead.receitawsJson) return lead;

  let parsed: any;
  try {
    parsed = typeof lead.receitawsJson === 'string'
      ? JSON.parse(lead.receitawsJson)
      : lead.receitawsJson;
  } catch {
    return lead;
  }
  if (!parsed || typeof parsed !== 'object') return lead;

  // Helper: pick first non-null value from a list of candidates
  const first = (...vals: any[]) => {
    for (const v of vals) {
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };

  // atividade_principal is an array [{code, text}] in the actual API
  const atvPrinc = Array.isArray(parsed.atividade_principal)
    ? parsed.atividade_principal[0]
    : parsed.atividade_principal;

  return {
    ...lead,
    // Address fields (top-level in ReceitaWS API, NOT under 'endereco')
    enderecoBairro: first(lead.enderecoBairro, parsed.bairro, parsed.endereco?.bairro),
    enderecoCep: first(lead.enderecoCep, parsed.cep, parsed.endereco?.cep),
    enderecoMunicipio: first(lead.enderecoMunicipio, parsed.municipio, parsed.endereco?.municipio),
    enderecoUf: first(lead.enderecoUf, parsed.uf, parsed.endereco?.uf),
    enderecoNumero: first(lead.enderecoNumero, parsed.numero, parsed.endereco?.numero),
    enderecoComplemento: first(lead.enderecoComplemento, parsed.complemento, parsed.endereco?.complemento),
    enderecoLogradouro: first(lead.enderecoLogradouro, parsed.logradouro, parsed.endereco?.logradouro),
    enderecoTipoLogradouro: first(lead.enderecoTipoLogradouro, parsed.tipo_logradouro, parsed.endereco?.tipo_logradouro),
    // CNAE
    cnaePrincipalCodigo: first(lead.cnaePrincipalCodigo, atvPrinc?.code),
    cnaePrincipalTexto: first(lead.cnaePrincipalTexto, atvPrinc?.text),
    // Other ReceitaWS fields
    razaoSocial: first(lead.razaoSocial, parsed.nome),
    nomeFantasia: first(lead.nomeFantasia, parsed.fantasia),
    situacaoCadastral: first(lead.situacaoCadastral, parsed.situacao),
    dataSituacaoCadastral: first(lead.dataSituacaoCadastral, parsed.data_situacao),
    motivoSituacaoCadastral: first(lead.motivoSituacaoCadastral, parsed.motivo_situacao),
    naturezaJuridica: first(lead.naturezaJuridica, parsed.natureza_juridica),
    dataAbertura: first(lead.dataAbertura, parsed.abertura),
    porte: first(lead.porte, parsed.porte),
    tipoEmpresa: first(lead.tipoEmpresa, parsed.tipo),
    emailReceita: first(lead.emailReceita, parsed.email),
    telefoneReceita: first(lead.telefoneReceita, parsed.telefone),
    capitalSocial: lead.capitalSocial != null
      ? lead.capitalSocial
      : (parsed.capital_social ? parseFloat(String(parsed.capital_social).replace(',', '.')) : null),
  };
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

  // Apply defensive fallback: parse receitawsJson to fill any NULL structured fields.
  // This is a no-op for leads without receitawsJson or with all fields populated.
  const enrichedLeads = leads.map((lead) => fallbackFromReceitawsJson(lead));

  // Cabeçalhos amigáveis, em PT-BR, agrupados logicamente.
  // Ordem prioriza as colunas mais úteis para o usuário comercial (Nome, Contato, Endereço, CNPJ).
  const headers = [
    // === Identificação (mais importante) ===
    'Nome',
    'Nome Fantasia',
    'Razão Social',
    // === Contato (essencial para prospecção) ===
    'Telefone',
    'Telefone (Receita)',
    'Email',
    'Website',
    // === Endereço (Google Places — sempre presente) ===
    'Endereço',
    'Cidade',
    'UF',
    // === Google Places (métricas de relevância) ===
    'Rating',
    'Avaliações',
    'Google Maps',
    // === CNPJ (preenchido após fetch) ===
    'CNPJ',
    'Situação Cadastral',
    'Status CNPJ',
    'Data Abertura',
    'Natureza Jurídica',
    'Porte',
    'Capital Social',
    'CNAE Principal',
    // === Endereço Receita (mais detalhado que Google) ===
    'Bairro',
    'Município (Receita)',
    'UF (Receita)',
    'CEP',
    // === Pipeline / Score / Tags ===
    'Pipeline',
    'Score',
    'Tags',
    'Listas',
    'Status ReceitaWS',
    // === Auditoria ===
    'Criado em',
  ];

  const rows = enrichedLeads.map((lead) => [
    // Identificação
    lead.name || '',
    lead.nomeFantasia || '',
    lead.razaoSocial || '',
    // Contato
    formatPhone(lead.phone),
    formatPhone(lead.telefoneReceita),
    lead.emailReceita || '',
    lead.website || '',
    // Endereço (Google Places)
    lead.formattedAddress || '',
    lead.locality || '',
    lead.administrativeArea || '',
    // Google Places
    lead.rating != null ? lead.rating.toFixed(1) : '',
    lead.userRatingCount != null ? String(lead.userRatingCount) : '',
    shortenMapsUrl(lead.googleMapsUri),
    // CNPJ
    lead.cnpjFormatted || lead.cnpj || '',
    lead.situacaoCadastral || '',
    cnpjStatusLabel(lead),
    lead.dataAbertura || '',
    lead.naturezaJuridica || '',
    lead.porte || '',
    lead.capitalSocial != null ? `R$ ${lead.capitalSocial.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
    lead.cnaePrincipalTexto || '',
    // Endereço Receita
    lead.enderecoBairro || '',
    lead.enderecoMunicipio || '',
    lead.enderecoUf || '',
    lead.enderecoCep || '',
    // Pipeline / Score / Tags
    pipelineLabel(lead.pipelineStatus),
    lead.score != null ? String(lead.score) : '',
    lead.tagAssignments.map((a) => a.tag.name).join('; '),
    lead.listMemberships.map((m) => m.list.name).join('; '),
    receitawsStatusLabel(lead.receitawsStatus),
    // Auditoria
    formatDateBR(lead.createdAt),
  ]);

  // === FORMATO XLSX: gera planilha estilizada (4 sheets) ===
  if (format === 'xlsx') {
    const leadRows: LeadRow[] = enrichedLeads.map((lead, i) => ({
      name: lead.name || '',
      nomeFantasia: lead.nomeFantasia || '',
      razaoSocial: lead.razaoSocial || '',
      telefone: formatPhone(lead.phone),
      telefoneReceita: formatPhone(lead.telefoneReceita),
      email: lead.emailReceita || '',
      website: lead.website || '',
      endereco: lead.formattedAddress || '',
      cidade: lead.locality || '',
      uf: lead.administrativeArea || '',
      rating: lead.rating != null ? lead.rating.toFixed(1) : '',
      avaliacoes: lead.userRatingCount != null ? String(lead.userRatingCount) : '',
      googleMaps: shortenMapsUrl(lead.googleMapsUri),
      cnpj: lead.cnpjFormatted || lead.cnpj || '',
      situacaoCadastral: lead.situacaoCadastral || '',
      statusCnpj: cnpjStatusLabel(lead),
      dataAbertura: lead.dataAbertura || '',
      naturezaJuridica: lead.naturezaJuridica || '',
      porte: lead.porte || '',
      capitalSocial: lead.capitalSocial != null ? `R$ ${lead.capitalSocial.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
      cnaePrincipal: lead.cnaePrincipalTexto || '',
      bairro: lead.enderecoBairro || '',
      municipioReceita: lead.enderecoMunicipio || '',
      ufReceita: lead.enderecoUf || '',
      cep: lead.enderecoCep || '',
      pipeline: pipelineLabel(lead.pipelineStatus),
      score: lead.score != null ? String(lead.score) : '',
      tags: lead.tagAssignments.map((a) => a.tag.name).join('; '),
      listas: lead.listMemberships.map((m) => m.list.name).join('; '),
      statusReceitaws: receitawsStatusLabel(lead.receitawsStatus),
      criadoEm: formatDateBR(lead.createdAt),
    }));

    // Detectar cidade mais comum para título
    const cities = leadRows.map(l => l.cidade).filter(Boolean);
    const cityCount = new Map<string, number>();
    for (const c of cities) cityCount.set(c, (cityCount.get(c) || 0) + 1);
    const topCity = Array.from(cityCount.entries()).sort((a, b) => b[1] - a[1])[0];
    const cityName = topCity ? `${topCity[0]}/${leadRows.find(l => l.cidade === topCity[0])?.uf || ''}` : undefined;

    const xlsxBuffer = await generateLeadsXlsx(leadRows, cityName);

    // generateLeadsXlsx retorna ArrayBuffer puro (BufferSource válido → BodyInit válido).
    return new NextResponse(xlsxBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="leads_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  // === FORMATO CSV (default): CSV plano com BOM ===
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(SEP)).join('\r\n');

  return new NextResponse('\ufeff' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
