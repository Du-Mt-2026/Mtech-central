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

/**
 * Extrai CNPJ do HTML de um website.
 *
 * Lei brasileira (CDC art. 31) exige CNPJ no rodapé de sites comerciais.
 * Padrões suportados:
 *   - XX.XXX.XXX/XXXX-XX (formatado)
 *   - 14 dígitos seguidos (após "CNPJ:" ou similar)
 *
 * @returns CNPJ com 14 dígitos (sem formatação) ou null se não encontrar
 */
export async function extractCnpjFromWebsite(
  websiteUrl: string,
  timeoutMs = 6000
): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OctupusZap-CNPJ-Bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const html = await res.text()
    if (html.length < 100) return null

    // Padrão 1: XX.XXX.XXX/XXXX-XX (formatado)
    const formatted = html.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/)
    if (formatted) {
      const cnpj = formatted[1].replace(/\D/g, '')
      if (cnpj.length === 14) return cnpj
    }

    // Padrão 2: "CNPJ: XXXXXXXXXXXXXX" (14 dígitos após label)
    const labeled = html.match(/CNPJ[:\s]+(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i)
    if (labeled) {
      const cnpj = labeled[1].replace(/\D/g, '')
      if (cnpj.length === 14) return cnpj
    }

    // Padrão 3: 14 dígitos isolados (menos confiável, pode pegar CPF)
    // Só usa se tiver "CNPJ" nas proximidades (janela de 200 chars)
    const cnpjPositions: number[] = []
    const cnpjRegex = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\b\d{14}\b)/g
    let m
    while ((m = cnpjRegex.exec(html)) !== null) {
      const start = Math.max(0, m.index - 200)
      const window = html.substring(start, m.index + m[0].length + 200)
      if (/CNPJ/i.test(window)) {
        const cnpj = m[0].replace(/\D/g, '')
        if (cnpj.length === 14) return cnpj
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Valida CNPJ (algoritmo oficial DV).
 */
export function validateCnpj(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '')
  if (clean.length !== 14) return false
  if (/^(\d)\1+$/.test(clean)) return false // todos iguais

  const calc = (slice: string, weights: number[]): number => {
    let sum = 0
    for (let i = 0; i < slice.length; i++) {
      sum += parseInt(slice[i]) * weights[i]
    }
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const d1 = calc(clean.substring(0, 12), w1)
  const d2 = calc(clean.substring(0, 12) + d1, w2)
  return d1 === parseInt(clean[12]) && d2 === parseInt(clean[13])
}

/**
 * Formata CNPJ: 12345678000190 → 12.345.678/0001-90
 */
export function formatCnpj(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, '')
  if (clean.length !== 14) return cnpj
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}
