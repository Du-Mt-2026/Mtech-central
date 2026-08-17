import { NextRequest, NextResponse } from 'next/server';
import {
  extractCnpjFromWebsite,
  formatCnpj,
  validateCnpj,
  webSearchCnpj,
} from '@/lib/places-client';
import {
  findCnpjByName,
  findCnpjByNameNoUF,
  isBigQueryConfigured,
} from '@/lib/bigquery-cnpj-finder';
import { consultarReceitaWS, receitawsToDBFields } from '@/lib/receitaws-client';

/**
 * POST /api/prospeccao/enrich
 * Body: { leads: ProspectLead[] }
 *
 * Runs the 6-layer CNPJ pipeline for a batch of leads (max 5 per request).
 * Does NOT touch the database — input and output are in-memory.
 *
 * Pipeline layers (per lead):
 *   1. Scraper — fetch CNPJ from company website (22 common paths)
 *   2. BigQuery — fuzzy match by name + UF (score >= 50)
 *   3. Web Search — Google search for "CNPJ {name} {city}"
 *   4. ReceitaWS — enrich CNPJ with Receita Federal data
 *
 * If a CNPJ is found in any layer, ReceitaWS is called to enrich it.
 * If no layer finds a CNPJ, the lead is returned with cnpjFetchStatus='not_found'.
 */

interface ProspectLead {
  placeId: string;
  name?: string;
  formattedAddress?: string;
  website?: string;
  phone?: string;
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
}

interface EnrichedLead extends ProspectLead {
  cnpj: string | null;
  cnpjFormatted: string | null;
  cnpjSource: string | null;
  cnpjConfidence: number | null;
  cnpjFetchStatus: 'ok' | 'not_found' | 'error';
  receitawsStatus: 'ok' | 'error' | 'pending';
  // Receita Federal fields
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  situacaoCadastral?: string | null;
  dataSituacaoCadastral?: string | null;
  naturezaJuridica?: string | null;
  dataAbertura?: string | null;
  capitalSocial?: number | null;
  porte?: string | null;
  tipoEmpresa?: string | null;
  emailReceita?: string | null;
  telefoneReceita?: string | null;
  enderecoBairro?: string | null;
  enderecoCep?: string | null;
  enderecoMunicipio?: string | null;
  enderecoUf?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoLogradouro?: string | null;
  enderecoTipoLogradouro?: string | null;
  cnaePrincipalCodigo?: string | null;
  cnaePrincipalTexto?: string | null;
  steps: string[];
}

async function enrichOneLead(lead: ProspectLead): Promise<EnrichedLead> {
  const steps: string[] = [];
  let cnpjFound: string | null = null;
  let cnpjSource: string = 'scraper';
  let cnpjConfidence: number | null = null;
  let receitawsStatus: 'ok' | 'error' | 'pending' = 'pending';

  const name = lead.name || '';
  const website = lead.website;
  const uf = lead.addressParts?.administrativeArea || '';
  const city = lead.addressParts?.locality || '';
  const cep = lead.addressParts?.postalCode || '';

  // === CAMADA 1: Scraper do site ===
  if (website) {
    steps.push('scraper:start');
    try {
      const { cnpj, sourceUrl } = await extractCnpjFromWebsite(website);
      if (cnpj && validateCnpj(cnpj)) {
        cnpjFound = cnpj;
        cnpjSource = 'scraper';
        steps.push(`scraper:found via ${sourceUrl}`);
      } else {
        steps.push('scraper:not_found');
      }
    } catch (e: any) {
      steps.push('scraper:error');
      console.error('[prospeccao/enrich] scraper error:', e.message);
    }
  }

  // === CAMADA 2: BigQuery fuzzy match ===
  if (!cnpjFound && isBigQueryConfigured() && name) {
    steps.push('bigquery:start');
    try {
      let matches = uf
        ? await findCnpjByName(name, uf, {
            limit: 20,
            minScore: 50,
            cidade: city || undefined,
          })
        : [];
      if (matches.length === 0) {
        steps.push('bigquery:fallback_no_uf');
        matches = await findCnpjByNameNoUF(name, {
          limit: 20,
          minScore: 50,
          cidade: city || undefined,
        });
      }
      if (matches.length > 0) {
        const best = matches[0];
        cnpjFound = best.cnpj;
        cnpjSource = `bigquery:${best.matchedBy}`;
        cnpjConfidence = best.score;
        steps.push(`bigquery:found score=${best.score} matchedBy=${best.matchedBy}`);
      } else {
        steps.push('bigquery:not_found');
      }
    } catch (e: any) {
      steps.push('bigquery:error');
      console.error('[prospeccao/enrich] bigquery error:', e.message);
    }
  } else if (!cnpjFound && !isBigQueryConfigured()) {
    steps.push('bigquery:not_configured');
  }

  // === CAMADA 3: Web Search ===
  if (!cnpjFound && name) {
    steps.push('websearch:start');
    try {
      const found = await webSearchCnpj(name, city);
      if (found && validateCnpj(found)) {
        cnpjFound = found;
        cnpjSource = 'websearch:google';
        steps.push('websearch:hit');
      } else {
        steps.push('websearch:miss');
      }
    } catch (e: any) {
      steps.push('websearch:error');
      console.error('[prospeccao/enrich] websearch error:', e.message);
    }
  }

  // === CAMADA 4: ReceitaWS enrichment ===
  const enriched: EnrichedLead = {
    ...lead,
    cnpj: cnpjFound,
    cnpjFormatted: cnpjFound ? formatCnpj(cnpjFound) : null,
    cnpjSource: cnpjFound ? cnpjSource : null,
    cnpjConfidence,
    cnpjFetchStatus: cnpjFound ? 'ok' : 'not_found',
    receitawsStatus: 'pending',
    steps,
  };

  if (cnpjFound) {
    steps.push('receitaws:start');
    try {
      const receitaws = await consultarReceitaWS(cnpjFound, { force: false });
      if (receitaws) {
        const fields = receitawsToDBFields(receitaws);
        Object.assign(enriched, fields);
        enriched.cnpjSource = `${cnpjSource}+receitaws`;
        enriched.receitawsStatus = 'ok';
        steps.push('receitaws:ok');
      } else {
        enriched.receitawsStatus = 'error';
        steps.push('receitaws:not_found_or_error');
      }
    } catch (e: any) {
      enriched.receitawsStatus = 'error';
      steps.push('receitaws:error');
      console.error('[prospeccao/enrich] receitaws error:', e.message);
    }
  } else {
    steps.push('all:not_found');
  }

  return enriched;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { leads } = body as { leads?: ProspectLead[] };

  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json(
      { error: 'leads (array) é obrigatório' },
      { status: 400 }
    );
  }

  // Hard cap at 5 leads per request to avoid timing out on ReceitaWS rate limits
  const batch = leads.slice(0, 5);

  const t0 = Date.now();
  try {
    // Process in parallel (max 5 concurrent — ReceitaWS rate limiter will throttle)
    const results = await Promise.all(batch.map(enrichOneLead));
    const elapsedMs = Date.now() - t0;

    return NextResponse.json({
      results,
      count: results.length,
      withCnpj: results.filter((r) => r.cnpj).length,
      elapsedMs,
    });
  } catch (e: any) {
    console.error('[prospeccao/enrich] erro:', e);
    return NextResponse.json(
      {
        error: e.message || 'erro interno',
        results: [],
        count: 0,
        withCnpj: 0,
        elapsedMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}
