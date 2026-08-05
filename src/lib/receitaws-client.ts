/**
 * ReceitaWS client - https://receitaws.com.br/api
 *
 * Free: 3 consultas/minuto, sem token
 * Plus: 100/minuto, com token (RECEITAWS_TOKEN)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RECEITAWS_BASE = 'https://www.receitaws.com.br/v1/cnpj';

const WINDOW_MS = 60_000;
const FREE_LIMIT = 3;
const PLUS_LIMIT = 100;

interface TimestampSlot { ts: number; }
const requestTimestamps: TimestampSlot[] = [];

function getToken(): string | null {
  return process.env.RECEITAWS_TOKEN?.trim() || null;
}

function getLimit(): number {
  return getToken() ? PLUS_LIMIT : FREE_LIMIT;
}

async function acquireSlot(): Promise<void> {
  const limit = getLimit();
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0].ts > WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= limit) {
    const oldest = requestTimestamps[0].ts;
    const waitMs = WINDOW_MS - (now - oldest) + 1000;
    const sleepMs = Math.max(waitMs, 35_000);
    console.log(`[receitaws] rate limit atingido. Aguardando ${Math.round(sleepMs / 1000)}s...`);
    await sleep(sleepMs);
    return acquireSlot();
  }
  requestTimestamps.push({ ts: now });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;

interface CacheEntry { value: any; ts: number; }
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): any | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, e);
  return e.value;
}

function cacheSet(key: string, value: any): void {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { value, ts: Date.now() });
}

export interface ReceitaWSResponse {
  cnpj: string;
  status?: string;
  tipo?: string;
  porte?: string;
  nome?: string;
  fantasia?: string;
  abertura?: string;
  situacao?: string;
  data_situacao?: string;
  motivo_situacao?: string;
  natureza_juridica?: string;
  ultima_atualizacao?: string;
  capital_social?: string;
  email?: string;
  telefone?: string;
  efr?: string;
  situacao_especial?: string;
  data_situacao_especial?: string;
  // ===== BUG FIX: ReceitaWS retorna endereço no TOP LEVEL (não dentro de 'endereco') =====
  // Antes a interface esperava `r.endereco?.bairro` etc., mas a API retorna esses campos
  // soltos no JSON raiz. Mantemos 'endereco' como opcional pra compat retroativa.
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  numero?: string;
  complemento?: string;
  logradouro?: string;
  tipo_logradouro?: string;
  endereco?: {
    bairro?: string;
    cep?: string;
    municipio?: string;
    uf?: string;
    numero?: string;
    complemento?: string;
    logradouro?: string;
    tipo_logradouro?: string;
  };
  // ===== BUG FIX: atividade_principal é um ARRAY de {code, text}, não um objeto =====
  // A ReceitaWS sempre retorna array (mesmo com 1 elemento). Antes o código esperava
  // {code, text} e sempre pegava undefined.
  atividade_principal?: { code: string; text: string }[];
  atividades_secundarias?: { code: string; text: string }[];
}

export async function consultarReceitaWS(
  cnpj: string,
  opts: { force?: boolean } = {}
): Promise<ReceitaWSResponse | null> {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return null;

  if (!opts.force) {
    const cached = cacheGet(clean);
    if (cached) return cached;
  }

  if (!opts.force) {
    const dbLead = await prisma.lead.findFirst({
      where: { cnpj: clean },
      select: {
        receitawsJson: true,
        receitawsFetchedAt: true,
        receitawsStatus: true,
      },
    });
    if (dbLead?.receitawsJson) {
      const ageHs =
        dbLead.receitawsFetchedAt != null
          ? (Date.now() - dbLead.receitawsFetchedAt.getTime()) / 3_600_000
          : Infinity;
      if (ageHs < 24 && dbLead.receitawsStatus !== 'error') {
        try {
          const parsed = JSON.parse(String(dbLead.receitawsJson)) as ReceitaWSResponse;
          cacheSet(clean, parsed);
          return parsed;
        } catch {
          // ignora JSON invalido
        }
      }
    }
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await acquireSlot();

    const token = getToken();
    const url = token
      ? `${RECEITAWS_BASE}/${clean}?token=${encodeURIComponent(token)}`
      : `${RECEITAWS_BASE}/${clean}?days=30`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'octupuszap/1.0 (+contato@octopus.com.br)',
          Accept: 'application/json',
        },
      });

      if (res.status === 429) {
        const backoff = 30_000 * Math.pow(2, attempt);
        console.warn(`[receitaws] 429 no CNPJ ${clean}. Backoff ${backoff}ms (tentativa ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
        continue;
      }

      if (res.status === 404) return null;

      if (!res.ok) {
        const txt = await res.text();
        console.error(`[receitaws] ${res.status} para ${clean}: ${txt}`);
        if (attempt === maxRetries - 1) return null;
        await sleep(5000);
        continue;
      }

      const data = (await res.json()) as ReceitaWSResponse;
      if (data.status === 'ERROR' || (data as any).message?.includes('não encontrado')) {
        return null;
      }

      cacheSet(clean, data);
      return data;
    } catch (e) {
      console.error(`[receitaws] erro tentativa ${attempt + 1}:`, e);
      if (attempt === maxRetries - 1) return null;
      await sleep(5000);
    }
  }

  return null;
}

export function receitawsToDBFields(r: ReceitaWSResponse): Record<string, any> {
  // ===== BUG FIX: ReceitaWS retorna endereço no TOP LEVEL =====
  // Antes: r.endereco?.bairro (sempre undefined — API não usa 'endereco')
  // Agora: r.bairro ?? r.endereco?.bairro (fallback pra compat retroativa)
  const end = r.endereco ?? {};
  const bairro = r.bairro ?? end.bairro ?? null;
  const cep = r.cep ?? end.cep ?? null;
  const municipio = r.municipio ?? end.municipio ?? null;
  const uf = r.uf ?? end.uf ?? null;
  const numero = r.numero ?? end.numero ?? null;
  const complemento = r.complemento ?? end.complemento ?? null;
  const logradouro = r.logradouro ?? end.logradouro ?? null;
  const tipoLogradouro = r.tipo_logradouro ?? end.tipo_logradouro ?? null;

  // ===== BUG FIX: atividade_principal é um ARRAY =====
  // Antes: r.atividade_principal?.code (sempre undefined — API retorna array)
  // Agora: pega o primeiro elemento do array
  const atividadePrincipal = Array.isArray(r.atividade_principal)
    ? r.atividade_principal[0]
    : r.atividade_principal;
  const cnaeCodigo = atividadePrincipal?.code ?? null;
  const cnaeTexto = atividadePrincipal?.text ?? null;

  return {
    razaoSocial: r.nome ?? null,
    nomeFantasia: r.fantasia ?? null,
    situacaoCadastral: r.situacao ?? null,
    dataSituacaoCadastral: r.data_situacao ?? null,
    motivoSituacaoCadastral: r.motivo_situacao ?? null,
    naturezaJuridica: r.natureza_juridica ?? null,
    dataAbertura: r.abertura ?? null,
    capitalSocial: r.capital_social ? parseFloat(r.capital_social.replace(',', '.')) : null,
    porte: r.porte ?? null,
    tipoEmpresa: r.tipo ?? null,
    emailReceita: r.email ?? null,
    telefoneReceita: r.telefone ?? null,
    enderecoBairro: bairro,
    enderecoCep: cep,
    enderecoMunicipio: municipio,
    enderecoUf: uf,
    enderecoNumero: numero,
    enderecoComplemento: complemento,
    enderecoLogradouro: logradouro,
    enderecoTipoLogradouro: tipoLogradouro,
    cnaePrincipalCodigo: cnaeCodigo,
    cnaePrincipalTexto: cnaeTexto,
    cnafeSecundarioJson: r.atividades_secundarias?.length ? JSON.stringify(r.atividades_secundarias) : null,
    receitawsJson: JSON.stringify(r),
    receitawsFetchedAt: new Date(),
    receitawsStatus: 'ok',
  };
}

export async function consultarEmLote(
  cnpjs: string[]
): Promise<Map<string, ReceitaWSResponse | null>> {
  const out = new Map<string, ReceitaWSResponse | null>();
  for (const cnpj of cnpjs) {
    const clean = cnpj.replace(/\D/g, '');
    if (clean.length !== 14) {
      out.set(clean, null);
      continue;
    }
    const r = await consultarReceitaWS(clean);
    out.set(clean, r);
  }
  return out;
}
