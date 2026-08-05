/**
 * BigQuery CNPJ Finder - busca fuzzy em estabelecimentos do Brasil.
 * Fonte: Base dos Dados - basedosdados.br_me_cnpj
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface BigQueryMatch {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string;
  municipio: string | null;
  uf: string | null;
  cnaeCodigo: string | null;
  cnaeTexto: string | null;
  capitalSocial: number | null;
  score: number;
  matchedBy: 'exact' | 'startsWith' | 'partial';
}

let cachedClient: any = null;
let cachedClientAuth: string | null = null;

function getCredentialsInline(): { creds: any; projectId: string } | null {
  const inlineJson = process.env.BIGQUERY_CREDENTIALS_JSON;
  if (inlineJson) {
    try {
      const parsed = JSON.parse(inlineJson);
      const projectId = process.env.BIGQUERY_PROJECT_ID || parsed.project_id || null;
      if (!projectId) {
        console.warn('[bigquery] BIGQUERY_PROJECT_ID nao definido');
        return null;
      }
      return { creds: parsed, projectId };
    } catch (e) {
      console.error('[bigquery] BIGQUERY_CREDENTIALS_JSON invalido:', e);
      return null;
    }
  }
  return null;
}

async function getCredentials(): Promise<{ creds: any; projectId: string } | null> {
  const inline = getCredentialsInline();
  if (inline) return inline;

  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath) {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const projectId = process.env.BIGQUERY_PROJECT_ID || parsed.project_id || null;
      if (!projectId) {
        console.warn('[bigquery] BIGQUERY_PROJECT_ID nao definido');
        return null;
      }
      return { creds: parsed, projectId };
    } catch (e) {
      console.error('[bigquery] Falha ao ler GOOGLE_APPLICATION_CREDENTIALS:', e);
      return null;
    }
  }

  return null;
}

export function isBigQueryConfigured(): boolean {
  if (getCredentialsInline()) return true;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  return false;
}

async function getBigQueryClient(): Promise<any | null> {
  const authKey = process.env.BIGQUERY_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  if (cachedClient && cachedClientAuth === authKey) return cachedClient;

  const cfg = await getCredentials();
  if (!cfg) return null;

  try {
    const { BigQuery } = await import('@google-cloud/bigquery');
    const client = new BigQuery({
      projectId: cfg.projectId,
      credentials: cfg.creds,
    });
    cachedClient = client;
    cachedClientAuth = authKey;
    return client;
  } catch (e) {
    console.error('[bigquery] Pacote @google-cloud/bigquery nao instalado. Rode: npm i @google-cloud/bigquery');
    return null;
  }
}

function normalizeName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function computeScore(
  queryName: string,
  matchedName: string,
  matchedSituacao: string,
  matchedMunicipio: string | null,
  cidadeFiltro: string | null
): { score: number; matchedBy: BigQueryMatch['matchedBy'] } {
  const q = normalizeName(queryName);
  const m = normalizeName(matchedName);

  let score = 0;
  let matchedBy: BigQueryMatch['matchedBy'] = 'partial';

  if (q === m) {
    score = 100;
    matchedBy = 'exact';
  } else if (m.startsWith(q) || q.startsWith(m)) {
    score = 80;
    matchedBy = 'startsWith';
  } else if (m.includes(q) || q.includes(m)) {
    score = 60;
    matchedBy = 'partial';
  } else {
    const tokensQ = new Set(q.split(' '));
    const tokensM = new Set(m.split(' '));
    let inter = 0;
    for (const t of tokensQ) if (tokensM.has(t)) inter++;
    const ratio = inter / Math.max(tokensQ.size, 1);
    score = Math.round(ratio * 50);
    matchedBy = 'partial';
  }

  if (matchedSituacao === '01' || matchedSituacao === 'ATIVA') score += 10;
  if (matchedSituacao === '02' || matchedSituacao === 'BAIXADA') score -= 30;

  if (cidadeFiltro && matchedMunicipio) {
    if (
      normalizeName(matchedMunicipio).includes(normalizeName(cidadeFiltro)) ||
      normalizeName(cidadeFiltro).includes(normalizeName(matchedMunicipio))
    ) {
      score += 15;
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, matchedBy };
}

function rowToResult(row: any, queryName: string, cidadeFiltro: string | null): BigQueryMatch {
  const cnpjCompleto = String(row.cnpj_completo || row.cnpj || '');
  const { score, matchedBy } = computeScore(queryName, row.razao_social || row.nome_fantasia || '', row.situacao_cadastral || '', row.municipio || null, cidadeFiltro);
  return {
    cnpj: cnpjCompleto,
    razaoSocial: row.razao_social || '',
    nomeFantasia: row.nome_fantasia || null,
    situacaoCadastral: row.situacao_cadastral || '',
    municipio: row.municipio || null,
    uf: row.uf || null,
    cnaeCodigo: row.cnae_codigo || null,
    cnaeTexto: row.cnae_texto || null,
    capitalSocial: row.capital_social || null,
    score,
    matchedBy,
  };
}

export function estimateQueryCost(useUFFilter: boolean): number {
  return useUFFilter ? 200_000_000 : 50_000_000_000;
}

/**
 * Gera variações do nome para busca fuzzy no BigQuery.
 * Google Maps frequentemente tem nomes com sufixos de marketing:
 * "Mega Story Copiadoras - Venda, Locação de impressoras e suprimentos - Cartucho de toner"
 * Já a razao_social na Receita Federal é formal: "MEGA STORY COMERCIO DE COPIADORAS LTDA"
 *
 * Variações geradas (únicas, em ordem de prioridade):
 * 1. Nome completo normalizado (raro de match)
 * 2. Primeiras 4 palavras (captura "loja x comercio de produtos")
 * 3. Primeiras 3 palavras
 * 4. Primeiras 2 palavras (mais comum de match)
 * 5. Nome antes do primeiro separador de marketing ("-", "|", "—", "–")
 */
function generateNameVariations(normalizedName: string): string[] {
  const variations = new Set<string>();
  variations.add(normalizedName);

  // Nome antes do primeiro separador de marketing
  const marketingSplit = normalizedName.split(/\s+[\-|–—]+\s+/)[0]?.trim();
  if (marketingSplit && marketingSplit.length >= 3) {
    variations.add(marketingSplit);
  }

  const words = normalizedName.split(/\s+/).filter(w => w.length > 0);

  // Variações por número de palavras: 2, 3, 4 palavras
  for (const n of [4, 3, 2]) {
    if (words.length >= n) {
      const variant = words.slice(0, n).join(' ');
      if (variant.length >= 3) variations.add(variant);
    }
  }

  // Também gera variação a partir do marketingSplit (palavras)
  if (marketingSplit && marketingSplit !== normalizedName) {
    const mw = marketingSplit.split(/\s+/).filter(w => w.length > 0);
    for (const n of [3, 2]) {
      if (mw.length >= n) {
        const variant = mw.slice(0, n).join(' ');
        if (variant.length >= 3) variations.add(variant);
      }
    }
  }

  // Filtra variações muito curtas (< 3 chars) ou muito longas (> 60 chars)
  return Array.from(variations).filter(v => v.length >= 3 && v.length <= 60);
}

function buildSQL(normalizedNames: string[], uf: string, limit: number, useUFFilter: boolean): string {
  const ufUpper = uf.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const whereUF = useUFFilter ? `AND e.sigla_uf = '${ufUpper}'` : '';

  // Constrói cláusulas OR para cada variação de nome
  // Cada variação é buscada como substring em razao_social OU nome_fantasia
  const orClauses: string[] = [];
  for (const name of normalizedNames) {
    const escaped = name.replace(/'/g, "''");
    orClauses.push(`LOWER(emp.razao_social) LIKE '%${escaped}%'`);
    orClauses.push(`LOWER(e.nome_fantasia) LIKE '%${escaped}%'`);
  }
  const orCondition = orClauses.join('\n          OR ');

  // Para ordenação, usa a variação mais curta (mais específica que provavelmente match)
  const shortestName = normalizedNames
    .slice()
    .sort((a, b) => a.length - b.length)[0]
    .replace(/'/g, "''");

  return `
    WITH candidatos AS (
      SELECT
        e.cnpj AS cnpj_completo,
        emp.razao_social AS razao_social,
        e.nome_fantasia AS nome_fantasia,
        e.situacao_cadastral AS situacao_cadastral,
        mun.nome AS municipio,
        e.sigla_uf AS uf,
        e.cnae_fiscal_principal AS cnae_codigo,
        CAST(NULL AS STRING) AS cnae_texto,
        emp.capital_social AS capital_social
      FROM \`basedosdados.br_me_cnpj.estabelecimentos\` e
      LEFT JOIN \`basedosdados.br_me_cnpj.empresas\` emp
        ON emp.cnpj_basico = e.cnpj_basico
      LEFT JOIN \`basedosdados.br_bd_diretorios_brasil.municipio\` mun
        ON mun.id_municipio = e.id_municipio
      WHERE 1=1
        ${whereUF}
        AND (
          ${orCondition}
        )
      LIMIT ${limit}
    )
    SELECT * FROM candidatos
    ORDER BY
      CASE
        WHEN LOWER(razao_social) = LOWER('${shortestName}') THEN 0
        WHEN LOWER(razao_social) LIKE LOWER('${shortestName}%') THEN 1
        WHEN LOWER(razao_social) LIKE LOWER('%${shortestName}%') THEN 2
        WHEN LOWER(nome_fantasia) LIKE LOWER('${shortestName}%') THEN 3
        ELSE 4
      END,
      CASE situacao_cadastral WHEN '01' THEN 0 ELSE 1 END
    LIMIT ${limit}
  `;
}

export async function findCnpjByName(
  name: string,
  uf: string,
  opts: { limit?: number; minScore?: number; cidade?: string } = {}
): Promise<BigQueryMatch[]> {
  const client = await getBigQueryClient();
  if (!client) return [];

  const norm = normalizeName(name);
  if (norm.length < 3) return [];

  const { limit = 20, minScore = 50, cidade = null } = opts;
  const variations = generateNameVariations(norm);
  const sql = buildSQL(variations, uf, limit, true);

  try {
    const [job] = await client.createQueryJob({ query: sql, location: 'US', params: {} });
    const [rows] = await job.getQueryResults();
    const results: BigQueryMatch[] = (rows as any[]).map((r) => rowToResult(r, name, cidade));
    return results.filter((r) => r.score >= minScore).sort((a, b) => b.score - a.score);
  } catch (e: any) {
    console.error('[bigquery] query falhou:', e.message);
    return [];
  }
}

export async function findCnpjByNameNoUF(
  name: string,
  opts: { limit?: number; minScore?: number; cidade?: string } = {}
): Promise<BigQueryMatch[]> {
  const client = await getBigQueryClient();
  if (!client) return [];

  const norm = normalizeName(name);
  if (norm.length < 3) return [];

  const { limit = 20, minScore = 50, cidade = null } = opts;
  const variations = generateNameVariations(norm);
  const sql = buildSQL(variations, '', limit, false);

  try {
    const [job] = await client.createQueryJob({ query: sql, location: 'US' });
    const [rows] = await job.getQueryResults();
    const results: BigQueryMatch[] = (rows as any[]).map((r) => rowToResult(r, name, cidade));
    return results.filter((r) => r.score >= minScore).sort((a, b) => b.score - a.score);
  } catch (e: any) {
    console.error('[bigquery] no-UF query falhou:', e.message);
    return [];
  }
}

export async function pingBigQuery(): Promise<boolean> {
  const client = await getBigQueryClient();
  if (!client) return false;
  try {
    const [rows] = await client.query('SELECT 1 AS ok');
    return (rows as any[])[0]?.ok === 1;
  } catch {
    return false;
  }
}

// ===========================================================================
// COLETA MASSIVA POR CNAE + UF (v7)
// ===========================================================================

export type LeadByCnaeInput = {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacaoCadastral: string | null;
  municipio: string | null;
  uf: string | null;
  cnaeCodigo: string | null;
  cnaeTexto: string | null;
  capitalSocial: number | null;
  porte: string | null;
  naturezaJuridica: string | null;
  dataAbertura: string | null;
  logradouroTipo: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  site: string | null;
};

export async function findLeadsByCnaeUF(
  ufs: string[],
  cnaePrefixes: string[],
  limit: number = 500,
  situacaoFiltro: string = '01'
): Promise<LeadByCnaeInput[]> {
  const ufsSan = ufs
    .map(u => String(u || '').toUpperCase().replace(/[^A-Z]/g, ''))
    .filter(u => u.length === 2);
  const cnaeSan = cnaePrefixes
    .map(p => String(p || '').replace(/\D/g, ''))
    .filter(p => p.length >= 2 && p.length <= 7);

  if (ufsSan.length === 0 || cnaeSan.length === 0) {
    throw new Error('ufs e cnaePrefixes são obrigatórios');
  }

  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const credsJson = process.env.BIGQUERY_CREDENTIALS_JSON;
  if (!projectId || !credsJson) {
    throw new Error('BigQuery não configurado. Verifique BIGQUERY_PROJECT_ID e BIGQUERY_CREDENTIALS_JSON no .env');
  }

  const { BigQuery } = await import('@google-cloud/bigquery');
  const bigquery = new BigQuery({
    projectId,
    credentials: JSON.parse(credsJson),
    location: 'US',
  });

  const ufsList = ufsSan.map(u => `'${u}'`).join(', ');
  const cnaeClause = cnaeSan
    .map(p => `SUBSTR(e.cnae_fiscal_principal, 1, ${p.length}) = '${p}'`)
    .join(' OR ');

  const query = `
    SELECT
      e.cnpj AS cnpj,
      emp.razao_social AS razao_social,
      e.nome_fantasia AS nome_fantasia,
      e.situacao_cadastral AS situacao_cadastral,
      mun.nome AS municipio,
      e.sigla_uf AS uf,
      e.cnae_fiscal_principal AS cnae_codigo,
      CAST(NULL AS STRING) AS cnae_texto,
      emp.capital_social AS capital_social,
      emp.porte AS porte,
      emp.natureza_juridica AS natureza_juridica,
      e.data_inicio_atividade AS data_abertura,
      e.tipo_logradouro AS logradouro_tipo,
      e.logradouro AS logradouro,
      e.numero AS numero,
      e.bairro AS bairro,
      e.cep AS cep
    FROM \`basedosdados.br_me_cnpj.estabelecimentos\` e
    LEFT JOIN \`basedosdados.br_me_cnpj.empresas\` emp
      ON emp.cnpj_basico = e.cnpj_basico
    LEFT JOIN \`basedosdados.br_bd_diretorios_brasil.municipio\` mun
      ON mun.id_municipio = e.id_municipio
    WHERE e.sigla_uf IN (${ufsList})
      AND (${cnaeClause})
      AND e.situacao_cadastral = '${situacaoFiltro}'
    LIMIT ${limit}
  `.trim();

  console.log('[bigquery] Executando findLeadsByCnaeUF...');
  const [rows] = await bigquery.query({ query, location: 'US' });

  return (rows as any[]).map(r => ({
    cnpj: String(r.cnpj || ''),
    razaoSocial: r.razao_social || null,
    nomeFantasia: r.nome_fantasia || null,
    situacaoCadastral: r.situacao_cadastral || null,
    municipio: r.municipio || null,
    uf: r.uf || null,
    cnaeCodigo: r.cnae_codigo || null,
    cnaeTexto: r.cnae_texto || null,
    capitalSocial: r.capital_social != null ? Number(r.capital_social) : null,
    porte: r.porte || null,
    naturezaJuridica: r.natureza_juridica || null,
    dataAbertura: r.data_abertura ? String(r.data_abertura) : null,
    logradouroTipo: r.logradouro_tipo || null,
    logradouro: r.logradouro || null,
    numero: r.numero ? String(r.numero) : null,
    bairro: r.bairro || null,
    cep: r.cep ? String(r.cep) : null,
    site: null,
  }));
}
