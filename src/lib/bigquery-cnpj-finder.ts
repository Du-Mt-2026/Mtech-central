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
  return s.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
  const cnpjCompleto = (row.cnpj_base || '') + (row.cnpj_ordem || '') + (row.cnpj_dv || '');
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

function buildSQL(normalizedName: string, uf: string, limit: number, useUFFilter: boolean): string {
  const ufUpper = uf.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const escapedName = normalizedName.replace(/'/g, "''");
  const whereUF = useUFFilter ? `AND e.uf = '${ufUpper}'` : '';

  return `
    WITH candidatos AS (
      SELECT
        e.cnpj_base,
        e.cnpj_ordem,
        e.cnpj_dv,
        e.razao_social,
        e.nome_fantasia,
        e.situacao_cadastral,
        e.municipio,
        e.uf,
        e.cnae_principal AS cnae_codigo,
        c.descricao AS cnae_texto,
        em.capital_social
      FROM \`basedosdados.br_me_cnpj.estabelecimentos\` e
      LEFT JOIN \`basedosdados.br_me_cnpj.empresas\` em
        ON e.cnpj_base = em.cnpj_base
      LEFT JOIN \`basedosdados.br_me_cnpj.cnae\` c
        ON e.cnae_principal = c.cnae
      WHERE 1=1
        ${whereUF}
        AND (
          LOWER(e.razao_social) LIKE '%${escapedName}%'
          OR LOWER(e.nome_fantasia) LIKE '%${escapedName}%'
        )
      LIMIT ${limit}
    )
    SELECT * FROM candidatos
    ORDER BY
      CASE
        WHEN LOWER(razao_social) = LOWER('${escapedName}') THEN 0
        WHEN LOWER(razao_social) LIKE LOWER('${escapedName}%') THEN 1
        ELSE 2
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

  const { limit = 20, minScore = 60, cidade = null } = opts;
  const sql = buildSQL(norm, uf, limit, true);

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

  const { limit = 20, minScore = 60, cidade = null } = opts;
  const sql = buildSQL(norm, '', limit, false);

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
