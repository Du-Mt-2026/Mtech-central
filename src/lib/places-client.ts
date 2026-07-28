/**
 * Google Places API (New) Client
 *
 * Adapter para a nova API v1 do Google Places.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * Fluxo:
 *   1. searchText() → retorna até 20 places + nextPageToken
 *   2. getPlaceDetails() → opcional, busca dados completos por place_id
 *
 * FieldMask controla quais campos são retornados (e cobrados).
 * Para nossa feature de prospecção pedimos: name, phone, website, address,
 * rating, reviews, location, types.
 *
 * Custo (Places API New):
 *   - Text Search: $0.032 por request (até 20 results)
 *   - Place Details: $0.04 por request (com FieldMask)
 *   - Free tier: $200/mês = ~6200 Text Searches
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1'

interface PlacesTextSearchResponse {
  places?: PlaceResult[]
  nextPageToken?: string
  error?: { code: number; message: string; status: string }
}

interface PlaceResult {
  id?: string                          // place_id (ex: ChIJN1t_tDeuEmsRUsoyG83frY4)
  displayName?: { text?: string; languageCode?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string    // ex: +55 48 3204-4785
  nationalPhoneNumber?: string         // ex: (48) 3204-4785
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  location?: { latitude?: number; longitude?: number }
  addressComponents?: Array<{
    longText?: string
    shortText?: string
    types?: string[]
  }>
  types?: string[]                     // ex: ["restaurant", "food", "point_of_interest"]
  businessStatus?: string              // OPERATIONAL, CLOSED_PERMANENTLY, etc
}

export interface NormalizedPlace {
  placeId: string
  name: string
  phone: string | null                 // E.164 sem +: 554832044785
  phoneRaw: string | null              // original: +55 48 3204-4785
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  rating: number | null
  reviewsCount: number | null
  categories: string[]
  businessStatus: string | null
}

export interface SearchFilters {
  hasPhone?: boolean                   // só retorna places com telefone (default: true)
  hasWebsite?: boolean                 // só retorna places com site
  minRating?: number                   // ex: 4.0
  minReviews?: number                  // ex: 50
  onlyOperational?: boolean            // exclui CLOSED_PERMANENTLY (default: true)
}

export interface SearchResult {
  places: NormalizedPlace[]
  nextPageToken?: string
  totalFound: number
  costEstimate: number                 // USD
}

/**
 * Normaliza um telefone para o padrão E.164 sem o "+".
 * Ex: "+55 48 3204-4785" → "554832044785"
 *     "+55 48 98821-8036" → "5548988218036"
 */
function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null
  // Remove tudo que não é dígito
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  // Se começar com 55 (Brasil) e tiver 12-13 dígitos, mantém
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) {
    return digits
  }
  // Se não tem 55 mas tem 10-11 dígitos (BR sem código de país), adiciona 55
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) {
    return '55' + digits
  }
  // Outros formatos — retorna como está
  return digits
}

/**
 * Extrai cidade e estado dos addressComponents.
 */
function extractCityState(components: PlaceResult['addressComponents']): { city: string | null; state: string | null } {
  if (!components) return { city: null, state: null }
  let city: string | null = null
  let state: string | null = null
  for (const c of components) {
    if (c.types?.includes('administrative_area_level_2')) {
      city = c.longText || c.shortText || city
    }
    if (c.types?.includes('administrative_area_level_1')) {
      state = c.shortText || c.longText || state
    }
  }
  return { city, state }
}

/**
 * Aplica filtros a um place normalizado.
 */
function passesFilters(place: NormalizedPlace, filters: SearchFilters): boolean {
  if (filters.hasPhone && !place.phone) return false
  if (filters.hasWebsite && !place.website) return false
  if (filters.minRating !== undefined && (place.rating === null || place.rating < filters.minRating)) return false
  if (filters.minReviews !== undefined && (place.reviewsCount === null || place.reviewsCount < filters.minReviews)) return false
  return true
}

function normalizePlace(raw: PlaceResult): NormalizedPlace {
  const { city, state } = extractCityState(raw.addressComponents)
  return {
    placeId: raw.id || '',
    name: raw.displayName?.text || '(sem nome)',
    phone: normalizePhone(raw.internationalPhoneNumber || raw.nationalPhoneNumber),
    phoneRaw: raw.internationalPhoneNumber || raw.nationalPhoneNumber || null,
    website: raw.websiteUri || null,
    address: raw.formattedAddress || null,
    city,
    state,
    lat: raw.location?.latitude || null,
    lng: raw.location?.longitude || null,
    rating: raw.rating ?? null,
    reviewsCount: raw.userRatingCount ?? null,
    categories: raw.types || [],
    businessStatus: raw.businessStatus || null,
  }
}

/**
 * Text Search — busca places por texto livre + localização.
 *
 * @param textQuery   ex: "pizzaria em Florianópolis" OU "dentista"
 * @param locationBias opcional: { lat, lng, radiusKm } — limita busca ao redor de um ponto
 * @param pageSize    máx 20 (default 20)
 * @param pageToken   para paginação
 * @param filters     filtros pós-busca (telefone, rating, etc)
 */
export async function searchText({
  textQuery,
  locationBias,
  pageSize = 20,
  pageToken,
  filters = {},
}: {
  textQuery: string
  locationBias?: { lat: number; lng: number; radiusKm: number }
  pageSize?: number
  pageToken?: string
  filters?: SearchFilters
}): Promise<SearchResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY não configurada no .env')
  }

  // FieldMask: pede só o que vamos usar (mais barato)
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.internationalPhoneNumber',
    'places.nationalPhoneNumber',
    'places.websiteUri',
    'places.rating',
    'places.userRatingCount',
    'places.location',
    'places.addressComponents',
    'places.types',
    'places.businessStatus',
    'nextPageToken',
  ].join(',')

  const body: Record<string, unknown> = {
    textQuery,
    languageCode: 'pt-BR',
    regionCode: 'BR',
    pageSize: Math.min(pageSize, 20),
  }

  if (locationBias) {
    // circle:lat,lng,radius_meters
    const radiusMeters = locationBias.radiusKm * 1000
    body.locationBias = {
      circle: {
        center: { latitude: locationBias.lat, longitude: locationBias.lng },
        radius: radiusMeters,
      },
    }
  }

  if (pageToken) {
    body.pageToken = pageToken
  }

  const url = `${PLACES_API_BASE}/places:searchText`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Places API error ${response.status}: ${errBody}`)
  }

  const data: PlacesTextSearchResponse = await response.json()
  if (data.error) {
    throw new Error(`Places API error: ${data.error.message}`)
  }

  const rawPlaces = data.places || []

  // Normaliza + aplica filtros
  const normalized = rawPlaces
    .map(normalizePlace)
    .filter((p) => {
      // Filtro de businessStatus (default: onlyOperational=true)
      if (filters.onlyOperational !== false && p.businessStatus && p.businessStatus !== 'OPERATIONAL') {
        return false
      }
      return passesFilters(p, filters)
    })

  // Custo estimado: Text Search = $0.032/request
  const costEstimate = 0.032

  return {
    places: normalized,
    nextPageToken: data.nextPageToken,
    totalFound: normalized.length,
    costEstimate,
  }
}

/**
 * Geocode — converte nome de cidade em lat/lng (para usar como locationBias).
 * Usa a Geocoding API (separada da Places API, $0.005 por request).
 *
 * Como alternativa gratuita, podemos usar o endpoint de Text Search da própria
 * Places API com pageSize=1, mas isso custa $0.032. Por simplicidade, vamos
 * só usar a Places API searchText com a cidade como parte do textQuery.
 */
export async function geocodeCity(cityName: string): Promise<{ lat: number; lng: number } | null> {
  // Implementação simplificada: busca "prefeitura de {cityName}" e pega a localização
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return null

  try {
    const result = await searchText({
      textQuery: `prefeitura de ${cityName}`,
      pageSize: 1,
      filters: {},
    })
    if (result.places.length > 0 && result.places[0].lat && result.places[0].lng) {
      return { lat: result.places[0].lat!, lng: result.places[0].lng! }
    }
  } catch (e) {
    console.error('[places-client] geocodeCity error:', e)
  }
  return null
}
