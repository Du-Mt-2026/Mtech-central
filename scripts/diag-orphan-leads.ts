#!/usr/bin/env tsx
/**
 * Diagnóstico: agrupa leads sem phone por cidade/locality pra ajudar a
 * decidir quais buscas manuais fazer no rescrape-places-fields.ts.
 *
 * Mostra:
 *   - Distribuição por cidade (locality)
 *   - Distribuição por UF (administrativeArea)
 *   - Amostra de nomes pra tentar inferir a keyword original
 *
 * Uso:
 *   docker exec octupuszap-app tsx scripts/diag-orphan-leads.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Distribuição por cidade + UF
  const orphans = await prisma.lead.findMany({
    where: { phone: null, searchQueryId: null },
    select: {
      id: true,
      name: true,
      locality: true,
      administrativeArea: true,
      formattedAddress: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`=== ${orphans.length} leads órfãos sem phone ===\n`)

  // Agrupa por "cidade/UF"
  const byLoc = new Map<string, { count: number; names: string[] }>()
  for (const l of orphans) {
    const key = `${l.locality || '(sem cidade)'}/${l.administrativeArea || '??'}`
    const entry = byLoc.get(key) ?? { count: 0, names: [] }
    entry.count++
    if (entry.names.length < 5) entry.names.push(l.name || '(sem nome)')
    byLoc.set(key, entry)
  }

  console.log('=== Distribuição por cidade/UF ===')
  const sorted = Array.from(byLoc.entries()).sort((a, b) => b[1].count - a[1].count)
  for (const [key, data] of sorted) {
    console.log(`\n  ${key}: ${data.count} leads`)
    console.log(`    amostra de nomes:`)
    for (const n of data.names) console.log(`      - ${n}`)
  }

  // Distribuição por UF apenas
  const byUf = new Map<string, number>()
  for (const l of orphans) {
    const uf = l.administrativeArea || '(sem UF)'
    byUf.set(uf, (byUf.get(uf) || 0) + 1)
  }
  console.log('\n=== Distribuição por UF (administrativeArea) ===')
  for (const [uf, count] of Array.from(byUf.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${uf}: ${count}`)
  }

  // Tenta inferir keyword comum — pega palavras mais frequentes nos nomes
  const wordCounts = new Map<string, number>()
  const STOP = new Set([
    'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'ltda', 'me',
    'informatica', 'informática', 'tecnologia', 'comercio', 'comércio',
    'servicos', 'serviços', 'solutions', 'store', 'shop', 'group',
  ])
  for (const l of orphans) {
    if (!l.name) continue
    // normaliza: lowercase, sem acento
    const norm = l.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
    for (const w of norm.split(/\s+/)) {
      if (w.length < 4) continue
      if (STOP.has(w)) continue
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1)
    }
  }
  console.log('\n=== Top 20 palavras nos nomes (pra tentar inferir keyword) ===')
  const topWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
  for (const [w, c] of topWords) {
    console.log(`  ${w}: ${c}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
