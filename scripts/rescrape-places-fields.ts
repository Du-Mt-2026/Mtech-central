#!/usr/bin/env tsx
/**
 * Re-scrape dos leads que ficaram sem phone / userRatingCount / website
 * por causa de timeouts do scraper no batch original.
 *
 * Estratégia: agrupa leads afetados por SearchQuery original, e re-roda
 * o scraper uma vez por SearchQuery (não por lead). Cada chamada do scraper
 * retorna até 60 places — então se 446 leads vieram de 5 buscas, são só 5
 * chamadas, não 446.
 *
 * O scraper retorna TODOS os places da busca (incluindo os que já temos).
 * Para cada place retornado, atualizamos no DB apenas os campos NULL
 * (não sobrescreve dados já preenchidos).
 *
 * Idempotente: pode rodar múltiplas vezes. Só atualiza leads com phone NULL.
 *
 * Uso:
 *   # Modo automático: descobre SearchQuerys com leads sem phone e re-roda
 *   docker exec octupuszap-app tsx scripts/rescrape-places-fields.ts
 *   docker exec octupuszap-app tsx scripts/rescrape-places-fields.ts --dry-run
 *   docker exec octupuszap-app tsx scripts/rescrape-places-fields.ts --limit=3
 *
 *   # Modo manual: especifica query/city/uf explicitamente (pra leads órfãos)
 *   docker exec octupuszap-app tsx scripts/rescrape-places-fields.ts \
 *     --query="informática" --city="Curitiba" --uf="PR"
 *
 * Env:
 *   SCRAPER_URL  — URL interna do microsserviço Python (ex: http://scraper:5000)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SCRAPER_URL = process.env.SCRAPER_URL || ''
const SCRAPER_TIMEOUT_MS = 180_000 // 3 min por chamada (Playwright é lento)
const DELAY_BETWEEN_QUERIES_MS = 3_000 // 3s entre queries — polite com Google

// ============================================================================
// Scraper client (copia de places-client.ts — runner image não tem src/)
// ============================================================================

interface ScraperLead {
  placeId?: string
  name?: string
  formattedAddress?: string
  website?: string
  phone?: string
  internationalPhoneNumber?: string
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
  businessStatus?: string
}

interface ScraperResponse {
  leads: ScraperLead[]
  count: number
  query: string
  city: string
  uf: string
  elapsed_ms: number
}

async function callScraper(
  query: string,
  city: string,
  uf: string,
  maxResults = 60
): Promise<ScraperLead[]> {
  if (!SCRAPER_URL) throw new Error('SCRAPER_URL não configurado no env do container')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS)

  try {
    const res = await fetch(`${SCRAPER_URL.replace(/\/$/, '')}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        city,
        uf,
        max_results: maxResults,
        headless: true,
        lang: 'pt-BR',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Scraper ${res.status}: ${txt.slice(0, 200)}`)
    }

    const data = (await res.json()) as ScraperResponse
    return data.leads ?? []
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseLocation(location: string): { city: string; uf: string } {
  // "Florianópolis, SC" → { city: "Florianópolis", uf: "SC" }
  // "Florianópolis"     → { city: "Florianópolis", uf: '' }
  const parts = location.split(',').map((s) => s.trim())
  if (parts.length >= 2 && parts[1].length >= 2) {
    return { city: parts[0], uf: parts[1].toUpperCase().slice(0, 2) }
  }
  return { city: location.trim(), uf: '' }
}

function parseArgs() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  let limit = 0 // 0 = sem limite
  let query: string | null = null
  let city: string | null = null
  let uf: string | null = null
  for (const a of args) {
    const m1 = /^--limit=(\d+)$/.exec(a)
    if (m1) limit = parseInt(m1[1], 10)
    const m2 = /^--query=(.+)$/.exec(a)
    if (m2) query = m2[1]
    const m3 = /^--city=(.+)$/.exec(a)
    if (m3) city = m3[1]
    const m4 = /^--uf=(.+)$/.exec(a)
    if (m4) uf = m4[1].toUpperCase().slice(0, 2)
  }
  return { dryRun, limit, query, city, uf }
}

// ============================================================================
// Re-scrape for a single (query, city, uf) tuple
// ============================================================================

interface QueryStats {
  query: string
  city: string
  uf: string
  returned: number
  withPhoneInScrape: number
  withReviewsInScrape: number
  enriched: number
  updatedWithPhone: number
  elapsedMs: number
  error?: string
}

async function rescrapeForQuery(
  query: string,
  city: string,
  uf: string,
  dryRun: boolean
): Promise<QueryStats> {
  const stats: QueryStats = {
    query,
    city,
    uf,
    returned: 0,
    withPhoneInScrape: 0,
    withReviewsInScrape: 0,
    enriched: 0,
    updatedWithPhone: 0,
    elapsedMs: 0,
  }

  if (dryRun) {
    console.log(`[rescrape]   [DRY-RUN] não vou chamar o scraper`)
    return stats
  }

  const t0 = Date.now()
  try {
    const leads = await callScraper(query, city, uf, 60)
    stats.elapsedMs = Date.now() - t0
    stats.returned = leads.length
    stats.withPhoneInScrape = leads.filter((l) => l.phone || l.internationalPhoneNumber).length
    stats.withReviewsInScrape = leads.filter((l) => l.userRatingCount != null).length

    console.log(`[rescrape]   scraper retornou ${leads.length} places em ${stats.elapsedMs}ms`)
    console.log(
      `[rescrape]   cobertura do scraper: phone=${stats.withPhoneInScrape}/${leads.length}, reviews=${stats.withReviewsInScrape}/${leads.length}`
    )

    let enriched = 0
    let updatedWithPhone = 0
    for (const p of leads) {
      if (!p.placeId) continue

      // Só atualiza leads existentes — não cria novos
      const existing = await prisma.lead.findUnique({
        where: { placeId: p.placeId },
        select: {
          id: true,
          phone: true,
          userRatingCount: true,
          website: true,
          rating: true,
          googleMapsUri: true,
        },
      })

      if (!existing) continue

      // Só preenche campos NULL — não sobrescreve dados já preenchidos
      const updateData: any = {}
      const phone = p.phone ?? p.internationalPhoneNumber
      if (!existing.phone && phone) updateData.phone = phone
      if (!existing.userRatingCount && p.userRatingCount != null) {
        updateData.userRatingCount = p.userRatingCount
      }
      if (!existing.website && p.website) updateData.website = p.website
      if (!existing.rating && p.rating != null) updateData.rating = p.rating
      if (!existing.googleMapsUri && p.googleMapsUri) {
        updateData.googleMapsUri = p.googleMapsUri
      }

      if (Object.keys(updateData).length === 0) continue

      await prisma.lead.update({
        where: { id: existing.id },
        data: updateData,
      })
      enriched++
      if (updateData.phone) updatedWithPhone++
    }

    stats.enriched = enriched
    stats.updatedWithPhone = updatedWithPhone
    console.log(
      `[rescrape]   enriquecidos ${enriched} leads existentes (${updatedWithPhone} ganharam phone)`
    )
  } catch (e: any) {
    stats.error = e.message
    stats.elapsedMs = Date.now() - t0
    console.error(`[rescrape]   ERROR: ${e.message}`)
  }

  return stats
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs()
  console.log(`[rescrape] dryRun=${args.dryRun} limit=${args.limit || 'unlimited'}`)
  console.log(`[rescrape] SCRAPER_URL=${SCRAPER_URL || '(NOT SET — vai falhar)'}`)

  if (!SCRAPER_URL && !args.dryRun) {
    console.error('[rescrape] FATAL: SCRAPER_URL não configurado')
    process.exit(1)
  }

  // === Modo manual: --query= --city= --uf= ===
  if (args.query && args.city && args.uf) {
    console.log(`\n[rescrape] MODO MANUAL: query="${args.query}" city=${args.city} uf=${args.uf}`)
    const stats = await rescrapeForQuery(args.query, args.city, args.uf, args.dryRun)
    await printFinalReport([stats])
    await prisma.$disconnect()
    return
  }

  if (args.query || args.city || args.uf) {
    console.error(
      '[rescrape] FATAL: --query, --city e --uf devem ser passados juntos (ou nenhum)'
    )
    process.exit(1)
  }

  // === Modo automático: descobre SearchQuery records com leads sem phone ===
  const searchQueries = await prisma.searchQuery.findMany({
    where: { leads: { some: { phone: null } } },
    select: {
      id: true,
      keyword: true,
      location: true,
      _count: {
        select: {
          leads: { where: { phone: null } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Conta leads órfãos (sem searchQueryId) — não serão processados no modo auto
  const orphanLeads = await prisma.lead.count({
    where: { phone: null, searchQueryId: null },
  })

  console.log(`\n[rescrape] MODO AUTOMÁTICO`)
  console.log(`[rescrape] ${searchQueries.length} SearchQuerys com leads sem phone`)
  console.log(`[rescrape] ${orphanLeads} leads sem phone NÃO têm searchQueryId (órfãos)`)

  if (searchQueries.length === 0) {
    console.log(`\n[rescrape] Nenhuma SearchQuery encontrada. Use modo manual:`)
    console.log(
      `[rescrape]   docker exec octupuszap-app tsx scripts/rescrape-places-fields.ts \\`
    )
    console.log(`[rescrape]     --query="KEYWORD" --city="CIDADE" --uf="UF"`)
    console.log(`\n[rescrape] Exemplo baseado nos leads (nomes como "X Tecnologia", "Y Informática"):`)
    console.log(
      `[rescrape]   --query="informática" --city="Curitiba" --uf="PR"`
    )
    await prisma.$disconnect()
    return
  }

  // Plano
  console.log('\n[rescrape] Plano:')
  for (const sq of searchQueries) {
    const { city, uf } = parseLocation(sq.location)
    console.log(
      `  - "${sq.keyword}" em ${city}/${uf || '?'} — ${sq._count.leads} leads sem phone`
    )
  }

  if (args.limit > 0 && searchQueries.length > args.limit) {
    console.log(`\n[rescrape] Limitando a ${args.limit} primeiras queries`)
    searchQueries.length = args.limit
  }

  if (args.dryRun) {
    console.log('\n[rescrape] DRY-RUN — não vou chamar o scraper. Rode sem --dry-run pra executar.')
    await prisma.$disconnect()
    return
  }

  // === Execução ===
  const allStats: QueryStats[] = []
  for (let i = 0; i < searchQueries.length; i++) {
    const sq = searchQueries[i]
    const { city, uf } = parseLocation(sq.location)
    console.log(
      `\n[rescrape] (${i + 1}/${searchQueries.length}) "${sq.keyword}" em ${city}/${uf || '?'}`
    )

    if (!uf) {
      console.log(`[rescrape]   SKIP — não consegui extrair UF de "${sq.location}"`)
      allStats.push({
        query: sq.keyword,
        city,
        uf: '',
        returned: 0,
        withPhoneInScrape: 0,
        withReviewsInScrape: 0,
        enriched: 0,
        updatedWithPhone: 0,
        elapsedMs: 0,
        error: 'UF não extraída do location',
      })
      continue
    }

    const stats = await rescrapeForQuery(sq.keyword, city, uf, args.dryRun)
    allStats.push(stats)

    // Delay entre queries (exceto a última)
    if (i < searchQueries.length - 1) {
      console.log(`[rescrape]   aguardando ${DELAY_BETWEEN_QUERIES_MS}ms...`)
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_QUERIES_MS))
    }
  }

  await printFinalReport(allStats)
  await prisma.$disconnect()
}

async function printFinalReport(allStats: QueryStats[]) {
  const finalMissingPhone = await prisma.lead.count({ where: { phone: null } })
  const finalMissingReviews = await prisma.lead.count({ where: { userRatingCount: null } })
  const finalTotal = await prisma.lead.count()

  const totalScrapeCalls = allStats.filter((s) => !s.error).length
  const totalPlaces = allStats.reduce((sum, s) => sum + s.returned, 0)
  const totalEnriched = allStats.reduce((sum, s) => sum + s.enriched, 0)
  const totalUpdatedPhone = allStats.reduce((sum, s) => sum + s.updatedWithPhone, 0)
  const totalErrors = allStats.filter((s) => s.error).length

  console.log('\n[rescrape] === FINAL REPORT ===')
  console.log(`Scrape calls (sucesso):      ${totalScrapeCalls}`)
  console.log(`Scrape calls (erro):         ${totalErrors}`)
  console.log(`Places retornados (total):   ${totalPlaces}`)
  console.log(`Leads enriquecidos:          ${totalEnriched}`)
  console.log(`Leads que ganharam phone:    ${totalUpdatedPhone}`)
  console.log(`Total leads no DB:           ${finalTotal}`)
  console.log(
    `Ainda sem phone:             ${finalMissingPhone} (${(finalMissingPhone / finalTotal * 100).toFixed(1)}%)`
  )
  console.log(
    `Ainda sem userRatingCount:   ${finalMissingReviews} (${(finalMissingReviews / finalTotal * 100).toFixed(1)}%)`
  )

  console.log('\n[rescrape] per-query breakdown:')
  for (const s of allStats) {
    if (s.error) {
      console.log(`  ❌ "${s.query}" em ${s.city}/${s.uf || '?'}: ${s.error}`)
    } else {
      console.log(
        `  ✓ "${s.query}" em ${s.city}/${s.uf}: ${s.returned} places, ${s.enriched} enriched (${s.updatedWithPhone} c/ phone), ${s.elapsedMs}ms`
      )
    }
  }
}

main().catch((e) => {
  console.error('[rescrape] FATAL:', e)
  process.exit(1)
})
