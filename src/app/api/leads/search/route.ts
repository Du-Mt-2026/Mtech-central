import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { searchPlaces, extractCnpjFromWebsite, formatCnpj, validateCnpj } from '@/lib/places-client';
import { findCnpjByName, findCnpjByNameNoUF, isBigQueryConfigured } from '@/lib/bigquery-cnpj-finder';
import { consultarReceitaWS, receitawsToDBFields } from '@/lib/receitaws-client';

const prisma = new PrismaClient();

/**
 * Pipeline automático de CNPJ para um lead.
 * Camadas: scraper do site → BigQuery fuzzy match → ReceitaWS enrichment.
 * Atualiza o lead no banco com os campos encontrados.
 */
async function fillCnpjForLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  if (lead.cnpj && lead.cnpjFetchStatus === 'ok') return; // já preenchido

  let cnpjFound: string | null = null;
  let cnpjSource: 'scraper' | 'bigquery' = 'scraper';
  let bigQueryScore: number | null = null;

  // CAMADA 1: Scraper do site
  if (lead.website) {
    try {
      const { cnpj, sourceUrl } = await extractCnpjFromWebsite(lead.website);
      if (cnpj && validateCnpj(cnpj)) {
        cnpjFound = cnpj;
        cnpjSource = 'scraper';
        console.log(`[auto-cnpj] lead ${leadId} scraper:found via ${sourceUrl}`);
      }
    } catch (e) {
      console.log(`[auto-cnpj] lead ${leadId} scraper:error`, e);
    }
  }

  // CAMADA 2: BigQuery fuzzy match
  if (!cnpjFound && isBigQueryConfigured() && lead.name) {
    try {
      const uf = lead.administrativeArea || '';
      let matches = uf
        ? await findCnpjByName(lead.name, uf, { limit: 5, minScore: 60, cidade: lead.locality ?? undefined })
        : [];
      if (matches.length === 0) {
        matches = await findCnpjByNameNoUF(lead.name, { limit: 5, minScore: 70, cidade: lead.locality ?? undefined });
      }
      if (matches.length > 0) {
        const best = matches[0];
        cnpjFound = best.cnpj;
        cnpjSource = 'bigquery';
        bigQueryScore = best.score;
        console.log(`[auto-cnpj] lead ${leadId} bigquery:found score=${best.score}`);
        await prisma.lead.update({
          where: { id: leadId },
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
      }
    } catch (e) {
      console.log(`[auto-cnpj] lead ${leadId} bigquery:error`, e);
    }
  }

  // CAMADA 3: ReceitaWS enrichment (se CNPJ foi encontrado)
  if (cnpjFound) {
    try {
      const receitaws = await consultarReceitaWS(cnpjFound, { force: false });
      if (receitaws) {
        const fields = receitawsToDBFields(receitaws);
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            ...fields,
            cnpj: cnpjFound,
            cnpjFormatted: formatCnpj(cnpjFound),
            cnpjSource: cnpjSource === 'bigquery' ? 'bigquery+receitaws' : `${cnpjSource}+receitaws`,
          },
        });
        console.log(`[auto-cnpj] lead ${leadId} receitaws:ok`);
      } else {
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            cnpj: cnpjFound,
            cnpjFormatted: formatCnpj(cnpjFound),
            cnpjSource,
            cnpjFetchStatus: 'ok',
            cnpjFetchedAt: new Date(),
            receitawsStatus: 'error',
          },
        });
      }
    } catch (e) {
      console.log(`[auto-cnpj] lead ${leadId} receitaws:error`, e);
    }
  } else {
    // Nenhuma camada encontrou CNPJ
    await prisma.lead.update({
      where: { id: leadId },
      data: { cnpjFetchStatus: 'not_found', cnpjFetchedAt: new Date() },
    });
    console.log(`[auto-cnpj] lead ${leadId} all:not_found`);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { query, pageSize, city, state } = body;
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'query é obrigatório' }, { status: 400 });
  }
  try {
    // 1. Busca no Google Places (com localizacao se city/state fornecidos)
    const results = await searchPlaces(query, { pageSize, city, state });

    // 2. Upsert de cada lugar no banco
    const leadIds: string[] = [];
    for (const place of results) {
      const existing = await prisma.lead.findUnique({ where: { placeId: place.placeId } });
      if (existing && existing.cnpj && existing.cnpjFetchStatus === 'ok') {
        // já tem CNPJ — não precisa reprocessar
        leadIds.push(existing.id);
        continue;
      }
      const lead = await prisma.lead.upsert({
        where: { placeId: place.placeId },
        create: {
          placeId: place.placeId,
          name: place.name ?? null,
          formattedAddress: place.formattedAddress ?? null,
          website: place.website ?? null,
          phone: place.phone ?? null,
          rating: place.rating ?? null,
          userRatingCount: place.userRatingCount ?? null,
          googleMapsUri: place.googleMapsUri ?? null,
          businessStatus: place.businessStatus ?? null,
          status: 'novo',
          cnpjFetchStatus: 'pending',
        },
        update: {
          name: place.name ?? undefined,
          formattedAddress: place.formattedAddress ?? undefined,
          website: place.website ?? undefined,
          phone: place.phone ?? undefined,
          rating: place.rating ?? undefined,
          userRatingCount: place.userRatingCount ?? undefined,
        },
      });
      leadIds.push(lead.id);
    }

    // 3. Pipeline CNPJ automático em paralelo (com limite de concorrência)
    const CONCURRENCY = 3;
    const chunks: string[][] = [];
    for (let i = 0; i < leadIds.length; i += CONCURRENCY) {
      chunks.push(leadIds.slice(i, i + CONCURRENCY));
    }
    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(id => fillCnpjForLead(id)));
    }

    // 4. Retorna os leads atualizados (com CNPJ preenchido)
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      orderBy: [{ cnpj: 'desc' }, { rating: 'desc' }],
    });

    return NextResponse.json({
      leads,
      count: leads.length,
      withCnpj: leads.filter(l => l.cnpj).length,
    });
  } catch (e: any) {
    console.error('[leads/search] erro:', e);
    return NextResponse.json({ error: e.message || 'erro interno' }, { status: 500 });
  }
}
