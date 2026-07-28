/**
 * Google Places API (New) Client
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1'

interface PlacesTextSearchResponse {
  places?: PlaceResult[]
  nextPageToken?: string
  error?: { code: number; message: string; status: string }
}

export interface PlaceResult {
  id?: string
  displayName?: { text?: string; languageCode?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  nationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  location?: { latitude?: number; longitude?: number }
  types?: string[]
  currentOpeningHours?: { openNow?: boolean }
  businessStatus?: string
}

export interface TextSearchParams {
  textQuery: string
  locationBias?: {
    circle: {
      center: { latitude: number; longitude: number }
      radius: number  // meters
    }
  }
  isOpenNow?: boolean
  languageCode?: string
  regionCode?: string
  pageSize?: number
  pageToken?: string
}

export async function searchText(
  params: TextSearchParams,
  apiKey: string
): Promise<{ places: PlaceResult[]; nextPageToken?: string }> {
  const body: any = {
    textQuery: params.textQuery,
    languageCode: params.languageCode || 'pt-BR',
    regionCode: params.regionCode || 'br',
    pageSize: Math.min(params.pageSize || 20, 20),
  }
  if (params.locationBias) body.locationBias = params.locationBias
  if (params.isOpenNow) body.isOpenNow = true
  if (params.pageToken) body.pageToken = params.pageToken

  // FieldMask — controla quais campos retornar (e custo)
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
    'places.types',
    'places.currentOpeningHours',
    'places.businessStatus',
    'nextPageToken',
  ].join(',')

  const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  })

  const data: PlacesTextSearchResponse = await res.json()

  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`
    throw new Error(`Places API error: ${msg}`)
  }

  return {
    places: data.places || [],
    nextPageToken: data.nextPageToken,
  }
}

/**
 * Geocodificar um endereço livre ("Florianópolis, SC") em lat/lng
 * usando a mesma API key do Places.
 */
export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<{ latitude: number; longitude: number }> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&region=br`
  const res = await fetch(url)
  const data = await res.json()

  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Geocode falhou para "${address}": ${data.status} ${data.error_message || ''}`)
  }

  const loc = data.results[0].geometry.location
  return { latitude: loc.lat, longitude: loc.lng }
}

/**
 * Buscar múltiplas páginas para atingir maxResults (até 60).
 * Cada página custa 1 request ($0.032).
 */
export async function searchTextWithPagination(
  params: TextSearchParams,
  apiKey: string,
  maxResults: number
): Promise<PlaceResult[]> {
  const all: PlaceResult[] = []
  let pageToken: string | undefined

  for (let page = 0; page < 3 && all.length < maxResults; page++) {
    const result = await searchText(
      { ...params, pageToken },
      apiKey
    )
    all.push(...result.places)
    pageToken = result.nextPageToken
    if (!pageToken) break
    // Pequeno delay entre páginas (Google requer isso)
    if (pageToken) await new Promise(r => setTimeout(r, 300))
  }

  return all.slice(0, maxResults)
}
