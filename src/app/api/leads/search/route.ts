import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { searchText, type SearchFilters } from '@/lib/places-client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      keyword,           // ex: "pizzaria"
      location,          // ex: "Florianópolis, SC"
      radiusKm = 10,
      filters = {},
      saveResults = true,
    } = body

    if (!keyword || !location) {
      return NextResponse.json(
        { error: 'keyword e location são obrigatórios' },
        { status: 400 }
      )
    }

    // Default filters: hasPhone=true, onlyOperational=true
    const appliedFilters: SearchFilters = {
      hasPhone: filters.hasPhone ?? true,
      hasWebsite: filters.hasWebsite ?? false,
      minRating: filters.minRating,
      minReviews: filters.minReviews,
      onlyOperational: filters.onlyOperational ?? true,
    }

    // Monta textQuery combinando keyword + location
    const textQuery = `${keyword} em ${location}`

    console.log(`[Leads] Buscando: "${textQuery}" (radius=${radiusKm}km, filters=${JSON.stringify(appliedFilters)})`)

    const result = await searchText({
      textQuery,
      pageSize: 20,
      filters: appliedFilters,
    })

    console.log(`[Leads] Places API retornou ${result.places.length} places (após filtros)`)

    if (!saveResults || result.places.length === 0) {
      return NextResponse.json({
        places: result.places,
        totalFound: result.totalFound,
        costEstimate: result.costEstimate,
        nextPageToken: result.nextPageToken,
      })
    }

    // Salva SearchQuery
    const searchQuery = await db.searchQuery.create({
      data: {
        keyword,
        location,
        radiusKm,
        filters: JSON.stringify(appliedFilters),
        resultCount: result.places.length,
        costEstimate: result.costEstimate,
        lastRunAt: new Date(),
      },
    })

    // Dedup: checa quais placeIds já existem no banco
    const placeIds = result.places.map((p) => p.placeId)
    const existing = await db.lead.findMany({
      where: { placeId: { in: placeIds } },
      select: { placeId: true, phone: true },
    })
    const existingByPlaceId = new Map(existing.map((e) => [e.placeId, e]))

    // Dedup adicional: checa phones contra Contact e Chip existentes
    const phones = result.places.map((p) => p.phone).filter(Boolean) as string[]
    const [existingContacts, existingChips] = await Promise.all([
      db.contact.findMany({ where: { phone: { in: phones } }, select: { phone: true } }),
      db.chip.findMany({ where: { phoneNumber: { in: phones } }, select: { phoneNumber: true } }),
    ])
    const existingPhones = new Set([
      ...existingContacts.map((c) => c.phone),
      ...existingChips.map((c) => c.phoneNumber),
    ])

    // Cria leads em bulk
    let newCount = 0
    let duplicateCount = 0
    const leadsToCreate: Array<Record<string, unknown>> = []

    for (const place of result.places) {
      const isDuplicatePlace = existingByPlaceId.has(place.placeId)
      const isDuplicatePhone = place.phone && existingPhones.has(place.phone)

      const status = isDuplicatePlace || isDuplicatePhone ? 'duplicate' : 'new'

      if (status === 'new') newCount++
      else duplicateCount++

      leadsToCreate.push({
        source: 'google_places',
        placeId: place.placeId,
        name: place.name,
        phone: place.phone,
        phoneRaw: place.phoneRaw,
        website: place.website,
        address: place.address,
        city: place.city,
        state: place.state,
        lat: place.lat,
        lng: place.lng,
        rating: place.rating,
        reviewsCount: place.reviewsCount,
        categories: JSON.stringify(place.categories),
        status,
        searchQueryId: searchQuery.id,
      })
    }

    // Bulk insert
    await db.lead.createMany({ data: leadsToCreate as any })

    // Atualiza contadores da SearchQuery
    await db.searchQuery.update({
      where: { id: searchQuery.id },
      data: { newCount, duplicateCount },
    })

    // Busca os leads criados para retornar (incluindo os duplicados marcados)
    const savedLeads = await db.lead.findMany({
      where: { searchQueryId: searchQuery.id },
      orderBy: { rating: 'desc' },
    })

    console.log(`[Leads] Salvos: ${newCount} novos + ${duplicateCount} duplicados`)

    return NextResponse.json({
      searchQueryId: searchQuery.id,
      places: savedLeads,
      totalFound: savedLeads.length,
      newCount,
      duplicateCount,
      costEstimate: result.costEstimate,
      nextPageToken: result.nextPageToken,
    })
  } catch (error: any) {
    console.error('Leads search error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
