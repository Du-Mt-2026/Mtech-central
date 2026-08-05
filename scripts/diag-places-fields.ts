#!/usr/bin/env tsx
/**
 * Diagnóstico: cobertura dos campos do Google Places (phone, userRatingCount,
 * rating, website) no banco de leads.
 *
 * Mostra:
 *   - Total de leads + % que têm cada campo preenchido
 *   - 5 leads sem phone/reviews (pra ver o padrão)
 *   - 5 leads com phone/reviews (sanidade)
 *   - Distribuição por data dos leads sem phone (pra identificar batch antigo)
 *
 * Uso:
 *   docker exec octupuszap-app tsx scripts/diag-places-fields.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const total = await prisma.lead.count()
  const withPhone = await prisma.lead.count({ where: { phone: { not: null } } })
  const withReviews = await prisma.lead.count({ where: { userRatingCount: { not: null } } })
  const withRating = await prisma.lead.count({ where: { rating: { not: null } } })
  const withWebsite = await prisma.lead.count({ where: { website: { not: null } } })
  const withAddress = await prisma.lead.count({ where: { formattedAddress: { not: null } } })

  console.log('=== Lead field coverage (Google Places fields) ===')
  console.log(`Total:                  ${total}`)
  console.log(`With phone:             ${withPhone} (${total ? (withPhone/total*100).toFixed(1) : 0}%)`)
  console.log(`With userRatingCount:   ${withReviews} (${total ? (withReviews/total*100).toFixed(1) : 0}%)`)
  console.log(`With rating:            ${withRating} (${total ? (withRating/total*100).toFixed(1) : 0}%)`)
  console.log(`With website:           ${withWebsite} (${total ? (withWebsite/total*100).toFixed(1) : 0}%)`)
  console.log(`With formattedAddress:  ${withAddress} (${total ? (withAddress/total*100).toFixed(1) : 0}%)`)

  const missing = await prisma.lead.findMany({
    where: { OR: [{ phone: null }, { userRatingCount: null }] },
    select: {
      id: true,
      name: true,
      phone: true,
      userRatingCount: true,
      rating: true,
      website: true,
      formattedAddress: true,
      placeId: true,
      createdAt: true,
    },
    take: 8,
    orderBy: { createdAt: 'desc' },
  })
  console.log('\n=== Sample leads MISSING phone OR userRatingCount (8 most recent) ===')
  console.log(JSON.stringify(missing, null, 2))

  const withAll = await prisma.lead.findMany({
    where: { AND: [{ phone: { not: null } }, { userRatingCount: { not: null } }] },
    select: {
      id: true,
      name: true,
      phone: true,
      userRatingCount: true,
      rating: true,
      website: true,
      formattedAddress: true,
      createdAt: true,
    },
    take: 5,
    orderBy: { createdAt: 'desc' },
  })
  console.log('\n=== Sample leads WITH phone AND userRatingCount (5 most recent, sanity) ===')
  console.log(JSON.stringify(withAll, null, 2))

  // Distribuição por dia de criação (lead sem phone)
  const phoneless = await prisma.lead.findMany({
    where: { phone: null },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const byDay = new Map<string, number>()
  for (const l of phoneless) {
    const d = l.createdAt.toISOString().slice(0, 10)
    byDay.set(d, (byDay.get(d) || 0) + 1)
  }
  console.log(`\n=== Phone-less leads by creation day (${phoneless.length} total) ===`)
  for (const [day, count] of byDay) {
    console.log(`  ${day}: ${count}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
