/**
 * leads-xlsx-export.ts
 *
 * Gera XLSX estilizado para exportação de leads usando exceljs.
 *
 * Visual idêntico à planilha de referência (leads_sem_site_florianopolis_VERIFICADOS.xlsx):
 *  - Cores: header verde escuro #1B4332 (texto branco), linhas alternadas #F0F7F4
 *  - Font: Calibri (14 title, 13 sheet title, 11 header, 10 data)
 *  - Borders: thin em todas as células com dados
 *  - Wrap text em todas as células
 *  - Merged cells para título e warning
 *
 * 4 sheets:
 *  1. Leads — lista de leads com TODOS os campos do banco (32 colunas)
 *  2. Resumo por Categoria — agrupado por categoria (CNAE ou Google Maps)
 *  3. Scripts de Abordagem — scripts WhatsApp por categoria
 *  4. Precificação — tabela estática de preços por tipo de site
 */

import ExcelJS from 'exceljs';

// ============================================================
// DESIGN TOKENS (idênticos à planilha de referência)
// ============================================================
const COLORS = {
  DARK_GREEN: 'FF1B4332',     // header principal + título
  LIGHT_GREEN: 'FFF0F7F4',    // linhas alternadas
  RED: 'FFFF6B6B',            // ★★★★★ alta prioridade
  ORANGE: 'FFFFA94D',         // ★★★★☆ média prioridade
  YELLOW: 'FFFFD93D',         // ★★★☆☆ baixa prioridade
  WHITE: 'FFFFFFFF',
  BLACK: 'FF000000',
  DARK_TEXT: 'FF333333',      // texto sobre amarelo
  WARNING_RED: 'FFCC0000',    // aviso vermelho no subtítulo
};

const FONT = 'Calibri';

// ============================================================
// TYPES
// ============================================================
export interface LeadRow {
  name: string;
  nomeFantasia: string;
  razaoSocial: string;
  telefone: string;
  telefoneReceita: string;
  email: string;
  website: string;
  endereco: string;
  cidade: string;
  uf: string;
  rating: string;
  avaliacoes: string;
  googleMaps: string;
  cnpj: string;
  situacaoCadastral: string;
  statusCnpj: string;
  dataAbertura: string;
  naturezaJuridica: string;
  porte: string;
  capitalSocial: string;
  cnaePrincipal: string;
  bairro: string;
  municipioReceita: string;
  ufReceita: string;
  cep: string;
  pipeline: string;
  score: string;
  tags: string;
  listas: string;
  statusReceitaws: string;
  criadoEm: string;
}

// ============================================================
// HELPERS — APPLY STYLES TO CELLS
// ============================================================
import type { Cell, Worksheet, Alignment, Borders, Fill, Font } from 'exceljs';

// Alias conveniente — cell.alignment aceita Partial<Alignment>.
type Align = Partial<Alignment>;

const THIN_BORDER: Partial<Borders> = {
  top: { style: 'thin', color: { argb: COLORS.BLACK } },
  bottom: { style: 'thin', color: { argb: COLORS.BLACK } },
  left: { style: 'thin', color: { argb: COLORS.BLACK } },
  right: { style: 'thin', color: { argb: COLORS.BLACK } },
};

function applyHeaderStyle(cell: Cell) {
  cell.font = {
    name: FONT, size: 11, bold: true, color: { argb: COLORS.WHITE },
  } satisfies Partial<Font>;
  cell.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.DARK_GREEN },
  } satisfies Fill;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } satisfies Align;
  cell.border = THIN_BORDER;
}

function applyDataStyle(
  cell: Cell,
  opts: { bold?: boolean; align?: 'left' | 'center'; altRow?: boolean } = {}
) {
  const { bold = false, align = 'left', altRow = false } = opts;
  cell.font = {
    name: FONT, size: 10, bold, color: { argb: COLORS.BLACK },
  } satisfies Partial<Font>;
  if (altRow) {
    cell.fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.LIGHT_GREEN },
    } satisfies Fill;
  }
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true } satisfies Align;
  cell.border = THIN_BORDER;
}

function applyPriorityStyle(cell: Cell, stars: string) {
  let bg = COLORS.YELLOW;
  let fontColor = COLORS.DARK_TEXT;
  if (stars.startsWith('★★★★★')) {
    bg = COLORS.RED;
    fontColor = COLORS.WHITE;
  } else if (stars.startsWith('★★★★')) {
    bg = COLORS.ORANGE;
    fontColor = COLORS.WHITE;
  }
  cell.font = {
    name: FONT, size: 10, bold: true, color: { argb: fontColor },
  } satisfies Partial<Font>;
  cell.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: bg },
  } satisfies Fill;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } satisfies Align;
  cell.border = THIN_BORDER;
}

// ============================================================
// SHEET 1: LEADS — 32 colunas com todos os campos
// ============================================================

const LEAD_HEADERS = [
  '#',
  'Nome',
  'Nome Fantasia',
  'Razão Social',
  'Telefone',
  'Telefone (Receita)',
  'Email',
  'Website',
  'Endereço',
  'Cidade',
  'UF',
  'Rating',
  'Avaliações',
  'Google Maps',
  'CNPJ',
  'Situação Cadastral',
  'Status CNPJ',
  'Data Abertura',
  'Natureza Jurídica',
  'Porte',
  'Capital Social',
  'CNAE Principal',
  'Bairro',
  'Município (Receita)',
  'UF (Receita)',
  'CEP',
  'Pipeline',
  'Score',
  'Tags',
  'Listas',
  'Status ReceitaWS',
  'Criado em',
];

// Larguras das colunas (em caracteres)
const LEAD_COL_WIDTHS = [
  5, 32, 22, 28, 18, 18, 28, 28, 35, 18, 6, 8, 10, 35, 22, 18, 14, 14,
  22, 14, 16, 35, 18, 22, 10, 12, 14, 8, 25, 25, 14, 18,
];

function buildLeadsSheet(wb: ExcelJS.Workbook, leads: LeadRow[], cityName?: string) {
  const ws = wb.addWorksheet('Leads');

  // Larguras das colunas
  ws.columns = LEAD_COL_WIDTHS.map(w => ({ width: w }));

  // Merge linha 1 (título) e linha 2 (warning)
  ws.mergeCells(1, 1, 1, LEAD_HEADERS.length);
  ws.mergeCells(2, 1, 2, LEAD_HEADERS.length);

  // Linha 1: Título principal
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const cityPart = cityName ? ` | ${cityName}` : '';
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `LEADS EXPORTADOS - OctopusZap${cityPart} | ${dateStr}`;
  titleCell.font = { name: FONT, size: 14, bold: true, color: { argb: COLORS.DARK_GREEN } } satisfies Partial<Font>;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' } satisfies Align;

  // Linha 2: Warning
  const warningCell = ws.getCell(2, 1);
  warningCell.value = `⚠️ Total de ${leads.length} lead(s) exportado(s). Dados enriquecidos via Google Places, ReceitaWS e BigQuery.`;
  warningCell.font = { name: FONT, size: 10, italic: true, color: { argb: COLORS.WARNING_RED } } satisfies Partial<Font>;
  warningCell.alignment = { horizontal: 'center', vertical: 'middle' } satisfies Align;

  // Linha 4: Headers
  LEAD_HEADERS.forEach((h, idx) => {
    const cell = ws.getCell(4, idx + 1);
    cell.value = h;
    applyHeaderStyle(cell);
  });

  // Linhas 5+: Dados
  leads.forEach((lead, i) => {
    const rowIdx = 5 + i;
    const altRow = i % 2 === 1;
    const num = i + 1;

    const values: (string | number)[] = [
      num,
      lead.name,
      lead.nomeFantasia,
      lead.razaoSocial,
      lead.telefone,
      lead.telefoneReceita,
      lead.email,
      lead.website,
      lead.endereco,
      lead.cidade,
      lead.uf,
      lead.rating,
      lead.avaliacoes,
      lead.googleMaps,
      lead.cnpj,
      lead.situacaoCadastral,
      lead.statusCnpj,
      lead.dataAbertura,
      lead.naturezaJuridica,
      lead.porte,
      lead.capitalSocial,
      lead.cnaePrincipal,
      lead.bairro,
      lead.municipioReceita,
      lead.ufReceita,
      lead.cep,
      lead.pipeline,
      lead.score,
      lead.tags,
      lead.listas,
      lead.statusReceitaws,
      lead.criadoEm,
    ];

    // Colunas com center align (curtas/numéricas)
    const centerCols = new Set([1, 5, 6, 11, 12, 13, 17, 19, 21, 25, 26, 27, 28, 31]);

    values.forEach((val, colIdx) => {
      const cell = ws.getCell(rowIdx, colIdx + 1);
      cell.value = val;
      if (colIdx === 0) {
        // # coluna: center, não bold
        applyDataStyle(cell, { bold: false, align: 'center', altRow });
      } else if (colIdx === 1) {
        // Nome: left, bold
        applyDataStyle(cell, { bold: true, align: 'left', altRow });
      } else if (centerCols.has(colIdx + 1)) {
        applyDataStyle(cell, { bold: false, align: 'center', altRow });
      } else {
        applyDataStyle(cell, { bold: false, align: 'left', altRow });
      }
    });
  });

  // Freeze panes: linha 5 (deixa título + warning + header fixos)
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 0 }];
}

// ============================================================
// SHEET 2: RESUMO POR CATEGORIA
// ============================================================

function buildResumoSheet(wb: ExcelJS.Workbook, leads: LeadRow[]) {
  const ws = wb.addWorksheet('Resumo por Categoria');
  ws.columns = [
    { width: 30 }, { width: 8 }, { width: 55 }, { width: 18 }, { width: 18 },
  ];

  // Agrupar por CNAE Principal (ou "Sem categoria" se vazio)
  const byCategory = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const cat = lead.cnaePrincipal || lead.tags?.split(';')[0]?.trim() || 'Sem categoria';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(lead);
  }

  // Ordenar por quantidade (decrescente)
  const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length);

  // Merge linha 1
  ws.mergeCells(1, 1, 1, 5);

  // Linha 1: Título
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'RESUMO POR CATEGORIA - Agrupamento dos leads exportados';
  titleCell.font = { name: FONT, size: 13, bold: true, color: { argb: COLORS.DARK_GREEN } } satisfies Partial<Font>;

  // Linha 3: Headers
  const headers = ['Categoria', 'Qtd', 'Observação', 'Ticket Médio', 'Prioridade'];
  headers.forEach((h, idx) => {
    const cell = ws.getCell(3, idx + 1);
    cell.value = h;
    applyHeaderStyle(cell);
  });

  // Dados
  sorted.forEach(([cat, catLeads], i) => {
    const rowIdx = 4 + i;
    const altRow = i % 2 === 1;

    // Rating médio
    const avgRating = catLeads
      .filter(l => l.rating)
      .map(l => parseFloat(l.rating))
      .filter(r => !isNaN(r));
    const avg = avgRating.length > 0 ? avgRating.reduce((a, b) => a + b, 0) / avgRating.length : 0;

    let priorityStars = '★★★☆☆';
    if (avg >= 4.5) priorityStars = '★★★★★';
    else if (avg >= 4.0) priorityStars = '★★★★☆';
    else if (avg >= 3.0) priorityStars = '★★★☆☆';
    else priorityStars = '★★☆☆☆';

    const observacao = `${catLeads.length} lead(s) com rating médio ${avg.toFixed(1)}`;
    const ticketMedio = avg >= 4.5 ? 'R$ 3.000-5.000' : avg >= 4.0 ? 'R$ 2.000-3.500' : 'R$ 1.200-2.500';

    // Categoria
    const c1 = ws.getCell(rowIdx, 1);
    c1.value = cat;
    applyDataStyle(c1, { bold: false, align: 'left', altRow });

    // Qtd
    const c2 = ws.getCell(rowIdx, 2);
    c2.value = catLeads.length;
    applyDataStyle(c2, { bold: false, align: 'center', altRow });

    // Observação
    const c3 = ws.getCell(rowIdx, 3);
    c3.value = observacao;
    applyDataStyle(c3, { bold: false, align: 'left', altRow });

    // Ticket Médio
    const c4 = ws.getCell(rowIdx, 4);
    c4.value = ticketMedio;
    applyDataStyle(c4, { bold: false, align: 'center', altRow });

    // Prioridade (colorida)
    const c5 = ws.getCell(rowIdx, 5);
    c5.value = priorityStars;
    applyPriorityStyle(c5, priorityStars);
  });
}

// ============================================================
// SHEET 3: SCRIPTS DE ABORDAGEM (estático)
// ============================================================

const SCRIPTS = [
  ['POUSADA/HOTEL/CAMPING',
   'Olá! Vi sua pousada no Google Maps e notei que vocês não têm um site próprio. Trabalho com criação de sites para hospedagem e posso ajudar vocês a receber reservas diretas, sem depender só do Booking/Agoda (que cobram 15-20% de comissão). Posso mandar uma proposta?'],
  ['RESTAURANTE/PIZZARIA',
   'Olá! Vi seu restaurante no Maps e notei que não tem site próprio. Um site com cardápio online + reservas + delivery próprio (sem iFood) pode aumentar suas vendas. Posso mandar uma proposta?'],
  ['BARBEARIA/SALÃO',
   'Fala! Vi sua barbearia no Maps e notei que não tem site. Imagina ter agendamento online, galeria de cortes e integração com WhatsApp. Posso te mandar uma proposta?'],
  ['CLÍNICA/ESTÉTICA',
   'Olá! Vi sua clínica no Google Maps e notei que só atende pelo WhatsApp. Muitas pessoas pesquisam procedimentos e valores antes de agendar. Um site profissional passa credibilidade. Posso mandar uma proposta?'],
  ['ESCOLA/CURSO',
   'Olá! Vi sua escola no Maps e notei que não tem site próprio. Quando alguém pesquisa "escola X cidade", seu site apareceria no topo do Google. Posso mandar uma proposta?'],
  ['TATUAGEM/ARTE',
   'Olá! Acompanho seu trabalho no Instagram e é incrível! Mas imagine ter um site profissional com portfólio em alta qualidade, agendamento e preços. Os clientes pesquisam antes de escolher. Posso te mandar uma proposta?'],
  ['CONSTRUÇÃO/MARCENARIA',
   'Olá! Vi seus trabalhos e notei que não têm site próprio. Na hora de contratar marcenaria/reforma, o cliente quer ver portfólio. Um site com fotos dos trabalhos vende por você. Posso mandar uma proposta?'],
  ['EVENTOS/BUFFET',
   'Olá! Sou da área de criação de sites e notei que seu buffet não tem site próprio. Noivos pesquisam tudo no Google antes de contratar. Um site com fotos de eventos, depoimentos e pacotes converte muito. Posso mandar uma proposta?'],
  ['FOTOGRAFIA/VÍDEO',
   'Olá! Como profissional de imagem, ter um site com portfólio em alta qualidade é essencial. Instagram comprime as fotos. Posso te ajudar com isso, mando proposta?'],
  ['SERVIÇOS GERAIS',
   'Olá! Vi seu negócio no Google Maps e notei que não tem site próprio. Um site profissional ajuda a aparecer no topo do Google quando alguém pesquisa "serviço X cidade". Posso mandar uma proposta?'],
];

function buildScriptsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Scripts de Abordagem');
  ws.columns = [{ width: 28 }, { width: 100 }];

  // Merge linha 1
  ws.mergeCells(1, 1, 1, 2);

  // Título
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'SCRIPTS DE ABORDAGEM POR CATEGORIA - Prontos para usar no WhatsApp';
  titleCell.font = { name: FONT, size: 13, bold: true, color: { argb: COLORS.DARK_GREEN } } satisfies Partial<Font>;

  // Linha 2: Headers
  const h1 = ws.getCell(2, 1);
  h1.value = 'Categoria';
  applyHeaderStyle(h1);
  const h2 = ws.getCell(2, 2);
  h2.value = 'Script';
  applyHeaderStyle(h2);

  // Scripts
  SCRIPTS.forEach(([cat, script], i) => {
    const rowIdx = 3 + i;

    const c1 = ws.getCell(rowIdx, 1);
    c1.value = cat;
    c1.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.DARK_GREEN } } satisfies Partial<Font>;
    c1.alignment = { vertical: 'middle', wrapText: true } satisfies Align;

    const c2 = ws.getCell(rowIdx, 2);
    c2.value = script;
    c2.font = { name: FONT, size: 10 } satisfies Partial<Font>;
    c2.alignment = { vertical: 'middle', wrapText: true } satisfies Align;
  });
}

// ============================================================
// SHEET 4: PRECIFICAÇÃO (estático)
// ============================================================

const PRECIFICACAO = [
  ['Site Institucional (3-5 pág)', 'R$ 1.500 - R$ 2.500', 'Barbearias, lavanderias, pet shops, lanchonetes, oficinas', 'Home, Sobre, Serviços, Contato, WhatsApp flutuante'],
  ['Site com Portfólio', 'R$ 2.000 - R$ 3.500', 'Tatuadores, fotógrafos, marcenarias, decoradores, construtoras', 'Home, Portfólio/Galeria, Sobre, Contato, WhatsApp'],
  ['Site com Agendamento', 'R$ 2.500 - R$ 4.000', 'Clínicas estética, salões, barbearias, pilates, escolas', 'Home, Serviços, Agendamento online, Sobre, Contato'],
  ['Site Premium - Reservas', 'R$ 3.500 - R$ 5.500', 'Pousadas, campings, imobiliárias, espaços de evento', 'Home, Quartos/Imóveis, Reservas online, Galeria, Contato'],
  ['Site Premium - Alto Padrão', 'R$ 5.000 - R$ 8.000', 'Imobiliárias Jurerê, buffets premium, construtoras alto padrão', 'Design premium, reservas, tour virtual, depoimentos'],
];

const SERVICOS_ADICIONAIS = [
  ['Google Meu Negócio otimizado', '+R$ 300 - R$ 500', 'TODOS os clientes', 'Otimização do perfil GMB para aparecer no topo do Maps'],
  ['Hospedagem + Manutenção mensal', '+R$ 50 - R$ 150/mês', 'TODOS os clientes (receita recorrente!)', 'Hospedagem, SSL, atualizações, backup, suporte'],
  ['SEO Local mensal', '+R$ 500 - R$ 1.500/mês', 'Negócios competitivos (pousadas, restaurantes)', 'Aparecer nas buscas "cidade + serviço"'],
  ['Domínio .com.br', '+R$ 40 - R$ 90/ano', 'TODOS os clientes', 'Registro e renovação do domínio profissional'],
  ['WhatsApp Business integrado', '+R$ 200 - R$ 400', 'Barbearias, clínicas, restaurantes', 'Botão flutuante + catálogo de produtos WhatsApp'],
];

function buildPrecificacaoSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Precificação');
  ws.columns = [{ width: 32 }, { width: 22 }, { width: 45 }, { width: 50 }];

  // Merge linha 1
  ws.mergeCells(1, 1, 1, 4);

  // Título
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'PRECIFICAÇÃO SUGERIDA POR TIPO DE SITE';
  titleCell.font = { name: FONT, size: 13, bold: true, color: { argb: COLORS.DARK_GREEN } } satisfies Partial<Font>;

  // Linha 2: Headers
  const headers = ['TIPO DE SITE', 'PREÇO', 'IDEAL PARA', 'INCLUI'];
  headers.forEach((h, idx) => {
    const cell = ws.getCell(2, idx + 1);
    cell.value = h;
    applyHeaderStyle(cell);
  });

  // Dados: tipos de site
  PRECIFICACAO.forEach((row, i) => {
    const rowIdx = 3 + i;
    row.forEach((val, colIdx) => {
      const cell = ws.getCell(rowIdx, colIdx + 1);
      cell.value = val;
      cell.font = { name: FONT, size: 10 } satisfies Partial<Font>;
      cell.alignment = { vertical: 'middle', wrapText: true } satisfies Align;
    });
  });

  // Linha separadora: "SERVIÇOS ADICIONAIS (Upsell)"
  const upsellRowIdx = 3 + PRECIFICACAO.length + 1;
  const upsellCell = ws.getCell(upsellRowIdx, 1);
  upsellCell.value = 'SERVIÇOS ADICIONAIS (Upsell)';
  upsellCell.font = { name: FONT, size: 10, bold: true } satisfies Partial<Font>;

  // Headers novamente
  headers.forEach((h, idx) => {
    const cell = ws.getCell(upsellRowIdx + 1, idx + 1);
    cell.value = h;
    applyHeaderStyle(cell);
  });

  // Dados: serviços adicionais
  SERVICOS_ADICIONAIS.forEach((row, i) => {
    const rowIdx = upsellRowIdx + 2 + i;
    row.forEach((val, colIdx) => {
      const cell = ws.getCell(rowIdx, colIdx + 1);
      cell.value = val;
      cell.font = { name: FONT, size: 10 } satisfies Partial<Font>;
      cell.alignment = { vertical: 'middle', wrapText: true } satisfies Align;
    });
  });
}

// ============================================================
// MAIN: generateLeadsXlsx
// ============================================================

export async function generateLeadsXlsx(leads: LeadRow[], cityName?: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OctopusZap';
  wb.created = new Date();
  wb.title = 'Leads Exportados - OctopusZap';

  buildLeadsSheet(wb, leads, cityName);
  buildResumoSheet(wb, leads);
  buildScriptsSheet(wb);
  buildPrecificacaoSheet(wb);

  // exceljs declara `declare interface Buffer extends ArrayBuffer {}` no seu
  // index.d.ts (linha 1) — esse Buffer extends ArrayBuffer mas NÃO é
  // ArrayLike<number> (sem .length). Por isso .set(buffer) falha.
  // Como ele extends ArrayBuffer, podemos usar diretamente como ArrayBuffer,
  // que é BodyInit válido para NextResponse.
  return await wb.xlsx.writeBuffer() as ArrayBuffer;
}
