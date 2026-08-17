/**
 * Places client — usa o microsserviço Python (scraper-service) por padrão.
 * Faz fallback para a Google Places API se SCRAPER_URL não estiver
 * configurado ou retornar erro.
 *
 * Env:
 *   SCRAPER_URL          URL interna do microsserviço (ex: http://scraper:5000)
 *   GOOGLE_PLACES_API_KEY  fallback (opcional)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const PLACE_DETAILS_ENDPOINT = (id: string) => `https://places.googleapis.com/v1/places/${id}`;

const SCRAPER_URL = process.env.SCRAPER_URL || '';
// 4 minutos por padrão — o scraper pode levar ~160s no pior caso
// (45s goto + 20s wait_for_selector + 25 scrolls × 2.2s + 30 clicks × 1.2s).
// Ajustável via env para deploy em HW mais lento.
const SCRAPER_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS) || 240_000;

export interface PlaceSearchResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  website?: string;
  phone?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  internationalPhoneNumber?: string;
  addressParts?: {
    streetNumber?: string;
    route?: string;
    sublocality?: string;
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
    country?: string;
  };
}

export interface PlaceDetails extends PlaceSearchResult {
  openingHours?: string[];
  primaryType?: string;
  types?: string[];
}

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || key === 'sua_chave_aqui' || key.startsWith('sua_chave') || key.length < 20) {
    throw new Error(
      'GOOGLE_PLACES_API_KEY não configurada ou inválida. Defina uma chave real do Google Cloud no .env e reinicie o container.'
    );
  }
  return key;
}

// ============================================================
// Scraper microservice client (substitui Places API)
// ============================================================

interface ScraperResponse {
  leads: Array<{
    placeId?: string;
    name?: string;
    formattedAddress?: string;
    website?: string;
    phone?: string;
    internationalPhoneNumber?: string;
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    businessStatus?: string;
    addressParts?: {
      streetNumber?: string;
      route?: string;
      sublocality?: string;
      locality?: string;
      administrativeArea?: string;
      postalCode?: string;
      country?: string;
    };
    latitude?: number;
    longitude?: number;
  }>;
  count: number;
  query: string;
  city: string;
  uf: string;
  elapsed_ms: number;
}

/**
 * Chama o microsserviço Python que faz scraping direto do Google Maps.
 * Lança erro se o scraper não estiver disponível ou retornar status != 200.
 */
async function searchViaScraper(
  query: string,
  city: string,
  uf: string,
  pageSize: number
): Promise<PlaceSearchResult[]> {
  if (!SCRAPER_URL) {
    throw new Error('SCRAPER_URL não configurado');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);

  // Log para confirmar que a versão nova do código está rodando no container.
  // Se você NÃO vir esta linha em `docker compose logs app`, o rebuild não pegou.
  console.log(
    `[places-client] searchViaScraper start: timeout=${SCRAPER_TIMEOUT_MS}ms, ` +
    `deadline_ms=${Math.max(SCRAPER_TIMEOUT_MS - 10_000, 30_000)}`
  );

  try {
    // Envia o deadline para o scraper Python — ele para os loops graciosamente
    // e retorna resultados parciais em vez de estourar o timeout do cliente.
    const deadlineMs = Math.max(SCRAPER_TIMEOUT_MS - 10_000, 30_000); // 10s de folga
    const res = await fetch(`${SCRAPER_URL.replace(/\/$/, '')}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        city,
        uf,
        max_results: Math.min(Math.max(pageSize, 10), 200),
        headless: true,
        lang: 'pt-BR',
        deadline_ms: deadlineMs,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Scraper ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = (await res.json()) as ScraperResponse;
    const places = data.leads ?? [];

    return places
      .filter((p): p is NonNullable<typeof p> & { placeId: string } => Boolean(p && p.placeId))
      .map((p) => ({
        placeId: p.placeId,
        name: p.name ?? '',
        formattedAddress: p.formattedAddress ?? '',
        website: p.website,
        phone: p.phone ?? p.internationalPhoneNumber,
        rating: typeof p.rating === 'number' ? p.rating : undefined,
        userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
        googleMapsUri: p.googleMapsUri,
        businessStatus: p.businessStatus,
        addressParts: p.addressParts ?? extractAddressParts([]),
      }));
  } catch (e: any) {
    // Detecta AbortError (timeout do cliente) — produz mensagem acionável.
    // O Node não expõe e.name === 'AbortError' de forma 100% confiável em
    // todas as versões; também checamos a mensagem padrão.
    const isAbort =
      e?.name === 'AbortError' ||
      e?.name === 'TimeoutError' ||
      /aborted/i.test(String(e?.message || ''));

    if (isAbort) {
      throw new Error(
        `Scraper demorou mais de ${Math.round(SCRAPER_TIMEOUT_MS / 1000)}s e foi interrompido pelo cliente. ` +
        `Isso geralmente indica que o Google Maps está lento (anti-bot, captcha, ou rede), ` +
        `ou que o container "scraper" está sobrecarregado. ` +
        `Aumente SCRAPER_TIMEOUT_MS ou tente uma busca mais específica. ` +
        `Diagnóstico: docker compose logs scraper --tail 50`
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchPlaces(
  query: string,
  opts: { languageCode?: string; regionCode?: string; pageSize?: number; city?: string; state?: string } = {}
): Promise<PlaceSearchResult[]> {
  const { languageCode = 'pt-BR', regionCode = 'BR', pageSize = 20, city, state } = opts;

  // ============================================================
  // Tenta primeiro o microsserviço Python (scraper) — sem custo de API
  // Nota: city/state podem ser vazios (novo fluxo prospecção) — o scraper
  // coloca a query direto no Google Maps quando city/uf estão vazios.
  // ============================================================
  if (SCRAPER_URL) {
    const uf = (state || '').trim().toUpperCase().slice(0, 2);
    console.log(`[places-client] usando scraper: query="${query}" city=${city || '(vazio)'} uf=${uf || '(vazio)'}`);
    try {
      const results = await searchViaScraper(query.trim(), (city || '').trim(), uf, pageSize);
      if (results.length > 0) {
        // NÃO faz upsertLeads — novo fluxo prospecção é stateless
        // (apenas o /api/leads/search antigo persiste no banco)
        return results;
      }
      // Scraper returned 0 results — surface as a CLEAR error so the user
      // knows the scraper ran but found nothing (likely Google Maps blocked
      // the request, or the query had no matches). Previously we fell
      // through to Places API which then errored with a confusing 403.
      throw new Error(
        `Scraper retornou 0 resultados para "${query}". ` +
        `Possíveis causas: Google Maps bloqueou o headless browser (considere rebuildar o container scraper), ` +
        `ou a busca não teve correspondências. Tente reformular a busca.`
      );
    } catch (e: any) {
      // If it's already our descriptive error, rethrow as-is
      const msg = String(e?.message || '');
      if (
        msg.startsWith('Scraper retornou 0 resultados') ||
        msg.startsWith('Scraper demorou mais de') ||
        msg.startsWith('Scraper indisponível:')
      ) {
        throw e;
      }
      // Otherwise it's a network/HTTP error from the scraper call
      console.error(`[places-client] scraper falhou: ${msg}`);
      throw new Error(
        `Scraper indisponível: ${msg}. ` +
        `Verifique se o container "scraper" está saudável (docker compose ps scraper) ` +
        `e se o log não mostra erros (docker compose logs scraper --tail 50).`
      );
    }
  }

  // ============================================================
  // Fallback: Google Places API (apenas se SCRAPER_URL não estiver setado)
  // Em produção, o SCRAPER_URL é sempre setado via docker-compose.yml,
  // então este caminho só roda em desenvolvimento local sem scraper.
  // ============================================================
  console.warn('[places-client] SCRAPER_URL não configurado — usando Google Places API (fallback)');
  const apiKey = getApiKey();
  let textQuery = query.trim();
  const locParts: string[] = [];
  if (city && city.trim()) locParts.push(city.trim());
  if (state && state.trim()) locParts.push(state.trim().toUpperCase());
  if (locParts.length > 0) {
    if (!/\b(em|in|no|na)\b/i.test(textQuery)) {
      textQuery = `${textQuery} in ${locParts.join(' ')}`;
    }
  }
  const body = {
    textQuery,
    languageCode,
    regionCode,
    pageSize: Math.min(Math.max(pageSize, 1), 20),
  };
  const res = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id','places.displayName','places.formattedAddress',
        'places.websiteUri','places.internationalPhoneNumber',
        'places.nationalPhoneNumber','places.rating','places.userRatingCount',
        'places.googleMapsUri','places.businessStatus','places.addressComponents',
      ].join(','),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Places API ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const places = (json.places ?? []) as any[];
  const results: PlaceSearchResult[] = places.map((p) => ({
    placeId: p.id,
    name: p.displayName?.text ?? '',
    formattedAddress: p.formattedAddress ?? '',
    website: p.websiteUri,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    googleMapsUri: p.googleMapsUri,
    businessStatus: p.businessStatus,
    addressParts: extractAddressParts(p.addressComponents ?? []),
  }));
  await upsertLeads(results);
  return results;
}

/**
 * Faz upsert dos leads no banco (compartilhado entre scraper e Places API).
 */
async function upsertLeads(results: PlaceSearchResult[]): Promise<void> {
  for (const r of results) {
    try {
      await prisma.lead.upsert({
        where: { placeId: r.placeId },
        create: {
          placeId: r.placeId, name: r.name, formattedAddress: r.formattedAddress,
          website: r.website, phone: r.phone, rating: r.rating,
          userRatingCount: r.userRatingCount, googleMapsUri: r.googleMapsUri,
          businessStatus: r.businessStatus,
          streetNumber: r.addressParts?.streetNumber,
          route: r.addressParts?.route,
          sublocality: r.addressParts?.sublocality,
          locality: r.addressParts?.locality,
          administrativeArea: r.addressParts?.administrativeArea,
          postalCode: r.addressParts?.postalCode,
          country: r.addressParts?.country,
          cnpjFetchStatus: 'pending', receitawsStatus: 'pending',
        },
        update: {
          name: r.name, formattedAddress: r.formattedAddress,
          website: r.website, phone: r.phone, rating: r.rating,
          userRatingCount: r.userRatingCount, googleMapsUri: r.googleMapsUri,
          businessStatus: r.businessStatus,
          streetNumber: r.addressParts?.streetNumber,
          route: r.addressParts?.route,
          sublocality: r.addressParts?.sublocality,
          locality: r.addressParts?.locality,
          administrativeArea: r.addressParts?.administrativeArea,
          postalCode: r.addressParts?.postalCode,
          country: r.addressParts?.country,
        },
      });
    } catch (e) {
      console.error('Upsert place failed:', r.placeId, e);
    }
  }
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const apiKey = getApiKey();
  const res = await fetch(PLACE_DETAILS_ENDPOINT(placeId), {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'id','displayName','formattedAddress','websiteUri',
        'internationalPhoneNumber','nationalPhoneNumber','rating',
        'userRatingCount','googleMapsUri','businessStatus',
        'addressComponents','currentOpeningHours',
        'primaryTypeDisplayName','types',
      ].join(','),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Place Details ${res.status}: ${txt}`);
  }
  const p = await res.json();
  return {
    placeId: p.id,
    name: p.displayName?.text ?? '',
    formattedAddress: p.formattedAddress ?? '',
    website: p.websiteUri,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    googleMapsUri: p.googleMapsUri,
    businessStatus: p.businessStatus,
    internationalPhoneNumber: p.internationalPhoneNumber,
    addressParts: extractAddressParts(p.addressComponents ?? []),
    openingHours: p.currentOpeningHours?.weekdayDescriptions ?? [],
    primaryType: p.primaryTypeDisplayName?.text,
    types: p.types ?? [],
  };
}

export function extractAddressParts(components: any[]) {
  const out: any = {};
  for (const c of components) {
    const types: string[] = c.types ?? [];
    const val = c.longText ?? c.shortText;
    if (!val) continue;
    if (types.includes('street_number')) out.streetNumber = val;
    else if (types.includes('route')) out.route = val;
    else if (types.includes('sublocality') || types.includes('sublocality_level_1')) out.sublocality = val;
    else if (types.includes('locality')) out.locality = val;
    else if (types.includes('administrative_area_level_1')) out.administrativeArea = val;
    else if (types.includes('postal_code')) out.postalCode = val;
    else if (types.includes('country')) out.country = val;
  }
  return out;
}

export function validateCnpj(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;
  const calc = (slice: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) sum += parseInt(slice[i], 10) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const d1 = calc(clean.slice(0, 12), w1);
  const d2 = calc(clean.slice(0, 12) + d1, w2);
  return clean.slice(-2) === `${d1}${d2}`;
}

export function formatCnpj(cnpj: string): string {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14) return cnpj;
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

const CNPJ_PATTERNS = [
  /\b\d{2}\.\d{3}\.\d{3}[\\/]\d{4}-\d{2}\b/g,  // aceita / ou \\
  /\b\d{14}\b/g,
  /CNPJ[:\s]*\d{2}\.?\d{3}\.?\d{3}[\\/]?\d{4}-?\d{2}/gi,
];

/**
 * Decodifica escapes Unicode/HTML que impedem match do CNPJ.
 * Sites Next.js/React escapam "/" como \u002F dentro de <script> JSON
 * para prevenir </script> injection. O scraper precisa decodificar antes
 * de aplicar os padroes.
 *
 * Cobertura:
 *   \u00XX  -> char (Unicode escape JS)
 *   \xXX    -> char (hex escape JS)
 *   &#47;   -> "/" (HTML decimal entity)
 *   &#x2F;  -> "/" (HTML hex entity)
 *   &sol;   -> "/" (HTML named entity, raro)
 *   \/     -> "/" (escape JS simples)
 */
function decodeEscapes(s: string): string {
  return s
    .replace(/\\u00([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&sol;/gi, '/')
    .replace(/\\\//g, '/');
}

const SCRAPE_PATHS = [
  '', '/contato', '/sobre', '/quem-somos', '/about', '/empresa', '/institucional',
  '/sobre-nos', '/fale-conosco', '/contact', '/who-we-are',
  '/politica-de-privacidade', '/privacy-policy', '/politica',
  '/termos-de-uso', '/termos', '/terms',
  '/faq', '/perguntas-frequentes',
  '/rodape', '/footer',
  '/cnpj', '/dados-empresa', '/dados-cadastrais',
];

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<{ text: string; status: number } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/json,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = decodeEscapes(await res.text());
    return { text, status: res.status };
  } catch { return null; } finally { clearTimeout(t); }
}

async function tryExtractFromUrl(url: string): Promise<string | null> {
  const fetched = await fetchWithTimeout(url);
  if (!fetched || fetched.status >= 400) return null;
  const html = fetched.text;
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const m of jsonLdMatch) {
      const inner = m.replace(/<[^>]+>/g, '').trim();
      try {
        const parsed = JSON.parse(inner);
        const found = findCnpjInJsonLd(parsed);
        if (found) return found;
      } catch {}
    }
  }
  const idx = html.toUpperCase().indexOf('CNPJ');
  if (idx !== -1) {
    const slice = html.slice(idx, idx + 80);
    for (const re of CNPJ_PATTERNS) {
      const match = slice.match(re);
      if (match && match[0]) {
        const digits = match[0].replace(/\D/g, '');
        if (validateCnpj(digits)) return digits;
      }
    }
  }
  for (const re of CNPJ_PATTERNS) {
    re.lastIndex = 0;
    const matches = html.match(re);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        const digits = m.replace(/\D/g, '');
        if (digits.length === 14 && validateCnpj(digits)) return digits;
      }
    }
  }
  return null;
}

function findCnpjInJsonLd(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === 'string') {
    const matches = obj.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (matches && validateCnpj(matches[0])) return matches[0].replace(/\D/g, '');
    return null;
  }
  if (Array.isArray(obj)) {
    for (const it of obj) { const r = findCnpjInJsonLd(it); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    const keys = ['cnpj', 'taxID', 'taxId', 'registrationNumber', 'vatID'];
    for (const k of keys) {
      if (obj[k] && typeof obj[k] === 'string') {
        const digits = obj[k].replace(/\D/g, '');
        if (digits.length === 14 && validateCnpj(digits)) return digits;
      }
    }
    for (const v of Object.values(obj)) { const r = findCnpjInJsonLd(v); if (r) return r; }
  }
  return null;
}

export async function extractCnpjFromWebsite(website?: string): Promise<{ cnpj: string | null; sourceUrl: string | null }> {
  if (!website) return { cnpj: null, sourceUrl: null };
  let base: string;
  try {
    const u = new URL(website);
    base = `${u.protocol}//${u.host}`;
  } catch { return { cnpj: null, sourceUrl: null }; }
  const allPaths = SCRAPE_PATHS.map((p) => (p ? base + p : website));
  for (let i = 0; i < allPaths.length; i += 3) {
    const batch = allPaths.slice(i, i + 3);
    const results = await Promise.all(batch.map(async (url) => ({ url, cnpj: await tryExtractFromUrl(url) })));
    for (const r of results) { if (r.cnpj) return { cnpj: r.cnpj, sourceUrl: r.url }; }
  }
  return { cnpj: null, sourceUrl: null };
}

// === v20: Web Search + Cache CEP ===
export async function webSearchCnpj(name: string, city?: string | null): Promise<string | null> {
  if (!name) return null;
  const q = encodeURIComponent(`CNPJ ${name}${city ? ` ${city}` : ''}`);
  const url = `https://www.google.com/search?q=${q}&hl=pt-BR&gl=BR`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await res.text();
    const patterns = [
      /\b\d{2}\.\d{3}\.\d{3}[\\\/]\d{4}-\d{2}\b/g,
      /\b\d{14}\b/g,
      /CNPJ[:\s]*\d{2}\.?\d{3}\.?\d{3}[\\\/]?\d{4}-?\d{2}/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) found.push(...m);
    }
    for (const c of found) {
      const digits = c.replace(/\D/g, '');
      if (digits.length === 14 && !/^(\d)\1{13}$/.test(digits)) return digits;
    }
  } catch (e) {
    console.error('[webSearchCnpj] error:', e);
  }
  return null;
}

export async function findCnpjByCep(
  prisma: any,
  cep?: string | null,
  street?: string | null,
  name?: string | null
): Promise<{ cnpj: string; source: string } | null> {
  if (!cep || cep.length < 8) return null;
  const cleanCep = cep.replace(/\D/g, '');
  try {
    const siblings = await prisma.lead.findMany({
      where: {
        postalCode: { contains: cleanCep.substring(0, 5) },
        cnpj: { not: null },
      },
      select: { cnpj: true, name: true, streetNumber: true, route: true },
      take: 10,
    });
    if (siblings.length === 0) return null;
    if (name) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
      const n = norm(name);
      for (const s of siblings) {
        if (s.name && norm(s.name) === n) return { cnpj: s.cnpj!, source: 'cache_cep_name' };
      }
    }
    if (street) {
      const ns = street.toLowerCase().trim();
      for (const s of siblings) {
        const sa = `${s.route || ''} ${s.streetNumber || ''}`.toLowerCase().trim();
        if (sa && ns && (sa.includes(ns) || ns.includes(sa))) {
          return { cnpj: s.cnpj!, source: 'cache_cep_endereco' };
        }
      }
    }
  } catch (e) {
    console.error('[findCnpjByCep] error:', e);
  }
  return null;
}
