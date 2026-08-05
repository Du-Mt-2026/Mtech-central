/**
 * POST /api/leads/collect
 *
 * Coleta leads do BigQuery (Base dos Dados - tabela de CNPJs) por CNAE + UF.
 * Diferente do /api/leads/search (que faz scraping do Google Maps), este
 * endpoint busca empresas diretamente na Receita Federal via BigQuery.
 *
 * Body:
 *   ufs:          string[]  — ex: ["SC","RS","PR"]  (obrigatório)
 *   cnaePrefixes: string[]  — ex: ["62","63"]       (obrigatório)
 *   limit:        number    — 1..5000 (default 500)
 *   situacao:     string    — "01"=ATIVA, "02"=INATIVA, "08"=BAIXADA (default "01")
 *
 * Response:
 *   { total, inserted, updated, skipped, byUf, withCnpj, errors, durationMs }
 */
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import {
  isBigQueryConfigured,
  pingBigQuery,
  findCnpjByNameNoUF,
  type BigQueryMatch,
} from '@/lib/bigquery-cnpj-finder';

const prisma = new PrismaClient();

function formatCnpj(cnpj: string): string {
  const cleaned = String(cnpj || '').replace(/\D/g, '');
  if (cleaned.length !== 14) return cnpj;
  return cleaned.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatCep(cep: string): string {
  const cleaned = String(cep || '').replace(/\D/g, '');
  if (cleaned.length !== 8) return String(cep || '');
  return cleaned.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

/**
 * Constrói uma string de endereço completa a partir dos campos da Receita.
 */
function buildAddressString(e: {
  logradouro_tipo?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
}): string {
  const parts: string[] = [];
  const street = [e.logradouro_tipo, e.logradouro].filter(Boolean).join(' ').trim();
  if (street) parts.push(street);
  if (e.numero) parts.push(String(e.numero));
  if (e.bairro) parts.push(String(e.bairro));
  const cityUf = [e.municipio, e.uf].filter(Boolean).join(' - ');
  if (cityUf) parts.push(cityUf);
  if (e.cep) parts.push(`CEP ${formatCep(String(e.cep))}`);
  return parts.join(', ');
}

// ============================================================
// BigQuery query por CNAE + UF
// ============================================================
// A função findLeadsByCnaeUF não existe mais no bigquery-cnpj-finder.
// Em vez de implementar uma query nova (que exigiria @google-cloud/bigquery
// e uma tabela específica), este endpoint agora faz fallback para
// findCnpjByNameNoUF passando o CNAE como nome. Isso NÃO é ideal —
// é só um stub para não quebrar o build.
//
// TODO: implementar query real no BigQuery quando tivermos a tabela
// mapeada. Por enquanto, retorna erro 501 se chamado.

export async function GET(req: NextRequest) {
  const ping = req.nextUrl.searchParams.get('ping');
  if (ping !== '1') {
    return NextResponse.json({ error: 'Use ?ping=1' }, { status: 400 });
  }
  const configured = isBigQueryConfigured();
  if (!configured) {
    return NextResponse.json({
      configured: false,
      ok: false,
      error: 'BigQuery não configurado. Verifique BIGQUERY_PROJECT_ID e BIGQUERY_CREDENTIALS_JSON no .env',
    }, { status: 500 });
  }
  try {
    const ok = await pingBigQuery();
    return NextResponse.json({ configured: true, ok });
  } catch (e: any) {
    return NextResponse.json({ configured: true, ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const ufs: string[] = (Array.isArray(body.ufs) ? body.ufs : [])
      .map((u: string) => String(u || '').toUpperCase().replace(/[^A-Z]/g, ''))
      .filter((u: string) => u.length === 2);
    const cnaePrefixes: string[] = (Array.isArray(body.cnaePrefixes) ? body.cnaePrefixes : [])
      .map((p: any) => String(p || '').replace(/\D/g, ''))
      .filter((p: string) => p.length >= 2 && p.length <= 7);
    const limit: number = Math.min(Math.max(Number(body.limit) || 500, 1), 5000);
    const situacao: string = String(body.situacao || '01').replace(/\D/g, '').slice(0, 2) || '01';

    if (ufs.length === 0) {
      return NextResponse.json({ error: 'ufs é obrigatório (ex: ["SC","RS","PR"])' }, { status: 400 });
    }
    if (cnaePrefixes.length === 0) {
      return NextResponse.json({ error: 'cnaePrefixes é obrigatório (ex: ["62","63"])' }, { status: 400 });
    }
    if (!isBigQueryConfigured()) {
      return NextResponse.json({ error: 'BigQuery não configurado. Verifique .env' }, { status: 500 });
    }

    // TODO: implementar query real por CNAE+UF no BigQuery.
    // Por enquanto, este endpoint retorna 501 Not Implemented.
    return NextResponse.json({
      error: 'findLeadsByCnaeUF ainda não implementado. Use /api/leads/search (scraping) por enquanto.',
      ufs,
      cnaePrefixes,
      limit,
      situacao,
      durationMs: Date.now() - startedAt,
    }, { status: 501 });
  } catch (e: any) {
    console.error('[collect] ERRO:', e);
    return NextResponse.json({
      error: e.message,
      durationMs: Date.now() - startedAt,
    }, { status: 500 });
  }
}
