import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { extractCnpjFromWebsite, formatCnpj, validateCnpj } from '@/lib/places-client';
import { findCnpjByName, findCnpjByNameNoUF, isBigQueryConfigured } from '@/lib/bigquery-cnpj-finder';
import { consultarReceitaWS, receitawsToDBFields } from '@/lib/receitaws-client';

const prisma = new PrismaClient();

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/leads/[id]/fetch-cnpj
 * Body: { force?: boolean }
 *
 * Pipeline de 3 camadas:
 * 1) Scraper: tenta extrair CNPJ do site da empresa
 * 2) BigQuery: busca fuzzy por nome + UF (score >= 60)
 * 3) ReceitaWS: enriquece o CNPJ encontrado
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;
  const cnpjHint: string | null = body?.cnpjHint ? String(body.cnpjHint).replace(/\D/g, '') : null;

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) {
    return NextResponse.json({ error: 'Lead nao encontrado' }, { status: 404 });
  }

  // Early return se ja tem CNPJ enriquecido e nao e force
  if (lead.cnpj && lead.cnpjFetchStatus === 'ok' && lead.receitawsStatus === 'ok' && !force) {
    return NextResponse.json({
      ok: true,
      cached: true,
      lead,
      message: 'CNPJ ja existe e esta enriquecido. Use force=true para reprocessar.',
    });
  }

  const steps: string[] = [];
  let cnpjFound: string | null = null;
  let cnpjSource: string = 'scraper';
  let bigQueryScore: number | null = null;

  // === CAMADA 0: cnpjHint (CNPJ fornecido pelo caller, ex: via web search) ===
  if (cnpjHint && validateCnpj(cnpjHint)) {
    cnpjFound = cnpjHint;
    cnpjSource = 'websearch:zai';
    steps.push('hint:cnpj_valido');
  }

  // Se ja tem CNPJ valido no banco (e nenhum hint foi fornecido), usa o do banco
  if (!cnpjFound && lead.cnpj && validateCnpj(lead.cnpj)) {
    cnpjFound = lead.cnpj;
    cnpjSource = 'existing';
    steps.push('existing:cnpj_valido');

    // === SHORTCUT v8: se lead veio do BigQuery collect com dados completos,
    // marcar receitawsStatus='ok' sem chamar ReceitaWS (dados ja sao da propria RFB)
    if (
      lead.cnpjSource &&
      lead.cnpjSource.startsWith('bigquery') &&
      lead.razaoSocial &&
      lead.cnaePrincipalTexto
    ) {
      await prisma.lead.update({
        where: { id },
        data: {
          receitawsStatus: 'ok',
          receitawsFetchedAt: new Date(),
          cnpjFetchStatus: 'ok',
          cnpjFetchedAt: lead.cnpjFetchedAt ?? new Date(),
        },
      });
      const updated = await prisma.lead.findUnique({ where: { id } });
      return NextResponse.json({
        ok: true,
        cached: true,
        cnpj: lead.cnpj,
        cnpjSource: lead.cnpjSource,
        steps: ['existing:cnpj_valido', 'shortcut:bigquery_complete_data'],
        lead: updated,
      });
    }
  }

  // ============ CAMADA 1: Scraper ============
    // === CAMADA 0: Cache por CEP (v20) ===
  if (!cnpjFound && lead.postalCode) {
    steps.push('cache_cep:start');
    try {
      const { findCnpjByCep } = await import('@/lib/places-client');
      const cached = await findCnpjByCep(prisma, lead.postalCode, lead.route, lead.name);
      if (cached) {
        cnpjFound = cached.cnpj;
        cnpjSource = `cache_cep:${cached.source}`;
        steps.push(`cache_cep:hit:${cached.source}`);
      } else {
        steps.push('cache_cep:miss');
      }
    } catch (e) {
      steps.push('cache_cep:error');
      console.error('[fetch-cnpj] cache_cep error:', e);
    }
  }

if (lead.website && !cnpjFound) {
    steps.push('scraper:start');
    const { cnpj, sourceUrl } = await extractCnpjFromWebsite(lead.website);
    if (cnpj && validateCnpj(cnpj)) {
      cnpjFound = cnpj;
      cnpjSource = 'scraper';
      steps.push(`scraper:found via ${sourceUrl}`);
    } else {
      steps.push('scraper:not_found');
    }
  }

  // ============ CAMADA 2: BigQuery ============
  if (!cnpjFound && isBigQueryConfigured() && lead.name) {
    steps.push('bigquery:start');
    const uf = lead.administrativeArea || '';

    let matches = uf
      ? await findCnpjByName(lead.name, uf, {
          limit: 20,
          minScore: 50,
          cidade: lead.locality ?? undefined,
        })
      : [];

    if (matches.length === 0) {
      steps.push('bigquery:fallback_no_uf');
      matches = await findCnpjByNameNoUF(lead.name, {
        limit: 20,
        minScore: 50,
        cidade: lead.locality ?? undefined,
      });
    }

    if (matches.length > 0) {
      const best = matches[0];
      cnpjFound = best.cnpj;
      cnpjSource = 'bigquery';
      bigQueryScore = best.score;
      steps.push(`bigquery:found score=${best.score} matchedBy=${best.matchedBy}`);

      await prisma.lead.update({
        where: { id },
        data: {
          cnpj: best.cnpj,
          cnpjFormatted: formatCnpj(best.cnpj),
          cnpjSource: `bigquery:${best.matchedBy}`,
          cnpjConfidence: best.score,
          cnpjFetchStatus: 'ok',
          cnpjFetchedAt: new Date(),
          razaoSocial: best.razaoSocial,
          nomeFantasia: best.nomeFantasia,
          situacaoCadastral: best.situacaoCadastral,
          cnaePrincipalCodigo: best.cnaeCodigo,
          cnaePrincipalTexto: best.cnaeTexto,
          enderecoMunicipio: best.municipio,
          enderecoUf: best.uf,
          capitalSocial: best.capitalSocial,
        },
      });
    } else {
      steps.push('bigquery:not_found');
    }
  } else if (!cnpjFound && !isBigQueryConfigured()) {
    steps.push('bigquery:not_configured');
  }

  // === CAMADA 4: Web Search (v20) ===
  if (!cnpjFound && lead.name) {
    steps.push('websearch:start');
    try {
      const { webSearchCnpj } = await import('@/lib/places-client');
      const found = await webSearchCnpj(lead.name, lead.locality);
      if (found) {
        cnpjFound = found;
        cnpjSource = 'websearch:google';
        steps.push('websearch:hit');
      } else {
        steps.push('websearch:miss');
      }
    } catch (e) {
      steps.push('websearch:error');
      console.error('[fetch-cnpj] websearch error:', e);
    }
  }
  // ============ CAMADA 3: ReceitaWS enrichment ============
  if (cnpjFound) {
    steps.push('receitaws:start');
    const receitaws = await consultarReceitaWS(cnpjFound, { force });

    if (receitaws) {
      const fields = receitawsToDBFields(receitaws);
      await prisma.lead.update({
        where: { id },
        data: {
          ...fields,
          cnpj: cnpjFound,
          cnpjFormatted: formatCnpj(cnpjFound),
          cnpjSource: cnpjSource === 'bigquery'
            ? `bigquery+receitaws`
            : `${cnpjSource}+receitaws`,
          cnpjFetchStatus: 'ok',
          cnpjFetchedAt: new Date(),
        },
      });
      steps.push('receitaws:ok');
    } else {
      // Mantem CNPJ mesmo sem ReceitaWS
      await prisma.lead.update({
        where: { id },
        data: {
          cnpj: cnpjFound,
          cnpjFormatted: formatCnpj(cnpjFound),
          cnpjSource,
          cnpjFetchStatus: 'ok',
          cnpjFetchedAt: new Date(),
          receitawsStatus: 'error',
        },
      });
      steps.push('receitaws:not_found_or_error');
    }
  } else {
    // Nenhuma camada encontrou
    await prisma.lead.update({
      where: { id },
      data: {
        cnpjFetchStatus: 'not_found',
        cnpjFetchedAt: new Date(),
      },
    });
    steps.push('all:not_found');
  }

  const updated = await prisma.lead.findUnique({ where: { id } });
  return NextResponse.json({
    ok: !!cnpjFound,
    cnpj: cnpjFound,
    cnpjSource,
    bigQueryScore,
    steps,
    lead: updated,
  });
}
