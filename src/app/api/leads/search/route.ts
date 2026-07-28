import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { searchTextWithPagination, geocodeAddress } from '@/lib/places-client'

interface SearchRequest {
  keyword: string
  location: string
  radiusKm?: number
  minRating?: number
  minReviews?: number
  hasWebsite?: 'any' | 'yes' | 'no'
  hasPhoneOnly?: boolean
  openNow?: boolean
  maxResults?: number
  sortBy?: 'relevance' | 'rating' | 'reviews' | 'distance'
  excludeImported?: boolean
}

function normalizePhone(intl?: string, national?: string): string | null {
  const raw = intl || national || ''
  if (!raw) return null
  // Remove tudo que não for dígito
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  // Garante prefixo 55 (Brasil)
  if (digits.startsWith('55')) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

export async function POST(req: NextRequest) {
  try {
    const body: SearchRequest = await req.json()
    const {
      keyword,
      location,
      radiusKm = 10,
      minRating = 0,
      minReviews = 0,
      hasWebsite = 'any',
      hasPhoneOnly = true,
      openNow = false,
      maxResults = 20,
      sortBy = 'relevance',
      excludeImported = true,
    } = body

    if (!keyword?.trim() || !location?.trim()) {
      return NextResponse.json(
        { error: 'keyword e location são obrigatórios' },
        { status: 400 }
      )
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GOOGLE_PLACES_API_KEY não configurada' },
        { status: 500 }
      )
    }

    // 1. Geocodificar localização
    const coords = await geocodeAddress(location, apiKey)

    // 2. Buscar no Places (com paginação até maxResults)
    const places = await searchTextWithPagination(
      {
        textQuery: `${keyword} em ${location}`,
        locationBias: {
          circle: {
            center: coords,
            radius: radiusKm * 1000, // metros
          },
        },
        isOpenNow: openNow,
        pageSize: 20,
      },
      apiKey,
      Math.min(maxResults, 60)
    )

    // 3. Buscar leads já importados (para marcar duplicados)
    const placeIds = places.map(p => p.id).filter(Boolean) as string[]
    const existingLeads = excludeImported
      ? await db.lead.findMany({
          where: { placeId: { in: placeIds } },
          select: { placeId: true, status: true, importedToContactId: true },
        })
      : await db.lead.findMany({
          where: { placeId: { in: placeIds }, importedToContactId: { not: null } },
          select: { placeId: true, status: true, importedToContactId: true },
        })

    const existingMap = new Map(existingLeads.map(l => [l.placeId, l]))

    // 4. Normalizar e filtrar
    let results: any[] = places
      .map(p => {
        const phone = normalizePhone(p.internationalPhoneNumber, p.nationalPhoneNumber)
        const status = existingMap.get(p.id || '')
        return {
          id: p.id,
          name: p.displayName?.text || 'Sem nome',
          phone,
          phoneRaw: p.internationalPhoneNumber || p.nationalPhoneNumber || null,
          website: p.websiteUri || null,
          address: p.formattedAddress || null,
          rating: p.rating || 0,
          reviewsCount: p.userRatingCount || 0,
          lat: p.location?.latitude,
          lng: p.location?.longitude,
          categories: p.types || [],
          isOpenNow: p.currentOpeningHours?.openNow,
          status: status
            ? status.importedToContactId
              ? 'imported'
              : 'duplicate'
            : 'new',
          // Para ordenação por distância
          _distance: coords.latitude && coords.longitude && p.location
            ? haversine(coords.latitude, coords.longitude, p.location.latitude!, p.location.longitude!)
            : 0,
        }
      })

    // 5. Aplicar filtros
    results = results.filter(r => {
      if (hasPhoneOnly && !r.phone) return false
      if (minRating > 0 && r.rating < minRating) return false
      if (minReviews > 0 && r.reviewsCount < minReviews) return false
      if (hasWebsite === 'yes' && !r.website) return false
      if (hasWebsite === 'no' && r.website) return false
      if (excludeImported && r.status === 'imported') return false
      return true
    })

    // 6. Ordenar
    if (sortBy === 'rating') {
      results.sort((a, b) => b.rating - a.rating)
    } else if (sortBy === 'reviews') {
      results.sort((a, b) => b.reviewsCount - a.reviewsCount)
    } else if (sortBy === 'distance') {
      results.sort((a, b) => (a._distance || 0) - (b._distance || 0))
    }

    // Remover campo interno
    results = results.map(({ _distance, ...rest }) => rest)

    // 7. Salvar/atualizar SearchQuery + Leads no banco
    const searchQuery = await db.searchQuery.create({
      data: {
        keyword,
        location,
        lat: coords.latitude,
        lng: coords.longitude,
        radiusKm,
        filters: JSON.stringify({
          minRating, minReviews, hasWebsite, hasPhoneOnly, openNow, maxResults, sortBy,
        }),
        resultCount: results.length,
        newCount: results.filter(r => r.status === 'new').length,
        duplicateCount: results.filter(r => r.status === 'duplicate').length,
        lastRunAt: new Date(),
      },
    })

    // Upsert leads (não recria se já existe)
    for (const r of results) {
      if (!r.id) continue
      await db.lead.upsert({
        where: { placeId: r.id },
        create: {
          source: 'google_places',
          placeId: r.id,
          name: r.name,
          phone: r.phone,
          phoneRaw: r.phoneRaw,
          website: r.website,
          address: r.address,
          rating: r.rating,
          reviewsCount: r.reviewsCount,
          categories: r.categories,
          lat: r.lat,
          lng: r.lng,
          status: r.status === 'new' ? 'new' : 'duplicate',
          searchQueryId: searchQuery.id,
        },
        update: {}, // não sobrescreve dados existentes
      })
    }

    return NextResponse.json({
      leads: results,
      searchQueryId: searchQuery.id,
      total: results.length,
      newCount: results.filter(r => r.status === 'new').length,
      duplicateCount: results.filter(r => r.status === 'duplicate').length,
    })
  } catch (err: any) {
    console.error('[Leads][search] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Erro interno' },
      { status: 500 }
    )
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // km
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
