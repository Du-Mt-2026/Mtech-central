import { NextRequest, NextResponse } from 'next/server';
import { searchPlaces } from '@/lib/places-client';

/**
 * POST /api/prospeccao/search
 * Body: { query: string, pageSize?: number }
 *
 * NEW prospecção flow (session-based, no DB persistence):
 * 1. User types free-text query like "informatica Palhoça"
 * 2. Scraper pastes it directly into Google Maps
 * 3. Returns array of leads (in-memory only — frontend manages state)
 * 4. Does NOT call CNPJ pipeline — that's done separately via /api/prospeccao/enrich
 *
 * This route is intentionally stateless and does not touch the database.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { query, pageSize } = body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    return NextResponse.json(
      { error: 'query é obrigatório (ex: "informatica Palhoça")' },
      { status: 400 }
    );
  }

  const trimmedQuery = query.trim();
  const limit = Math.min(Math.max(Number(pageSize) || 60, 10), 200);

  const t0 = Date.now();
  try {
    // Call the scraper directly with the raw user query.
    // city/state are empty — the scraper will paste the query directly into Google Maps.
    // See gmaps_scraper.py:_build_search_url — handles empty city/uf by using raw query.
    const results = await searchPlaces(trimmedQuery, {
      pageSize: limit,
      city: '',
      state: '',
    });

    const elapsedMs = Date.now() - t0;

    // Return in-memory array — frontend will manage state and trigger CNPJ enrichment
    return NextResponse.json({
      leads: results,
      count: results.length,
      query: trimmedQuery,
      elapsedMs,
    });
  } catch (e: any) {
    console.error('[prospeccao/search] erro:', e);
    const elapsedMs = Date.now() - t0;
    return NextResponse.json(
      {
        error: e.message || 'erro interno no scraper',
        leads: [],
        count: 0,
        query: trimmedQuery,
        elapsedMs,
      },
      { status: 500 }
    );
  }
}
