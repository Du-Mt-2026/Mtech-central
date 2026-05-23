/**
 * Linvix ERP Integration Library
 *
 * Connects to the Linvix (Linx Microvix) ERP via its DataTable AJAX endpoints.
 * Uses cookie-based authentication (PHP session) via AJAX login endpoint.
 *
 * Data available:
 * - Clients (Clientes): CODIGO, NOME, FANTASIA, TELEFONE, CELULAR, FAX, EMAIL,
 *   CNPJ_CNPF, IE_RG, SITUACAO, CIDADE, BAIRRO, UF, CATEGORIA, VENDEDOR_NOME
 * - Orders (Pedidos): retrieved via reports
 */

const LINVIX_BASE_URL = process.env.LINVIX_URL || 'https://rp.erp.linvix.com'
const LINVIX_USER = process.env.LINVIX_USER || ''
const LINVIX_PASS = process.env.LINVIX_PASS || ''

/** Timeout for fetch calls to Linvix ERP (ms) */
const LINVIX_FETCH_TIMEOUT = 15_000

/** Batch size for bulk DB operations */
const DB_BATCH_SIZE = 100

interface LinvixClient {
  CODIGO: string
  NOME: string
  FANTASIA: string
  TELEFONE: string
  CELULAR: string
  FAX: string
  EMAIL: string
  CNPJ_CNPF: string
  IE_RG: string
  SITUACAO: string
  CIDADE: string
  BAIRRO: string
  UF: string
  CATEGORIA: string
  VENDEDOR_NOME: string
  UUID: string
  [key: string]: string
}

interface LinvixDatatableResponse {
  draw: number
  recordsTotal: number
  recordsFiltered: number
  data: LinvixClient[]
}

/**
 * Fetch with timeout and retry
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = LINVIX_FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Login to Linvix ERP via AJAX endpoint and return session cookies
 */
async function linvixLogin(): Promise<string> {
  const loginUrl = `${LINVIX_BASE_URL}/ajax/ajax-login.php`

  console.debug('[LinvixSync] Logging in via AJAX endpoint...')

  const response = await fetchWithTimeout(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
    body: new URLSearchParams({
      login: LINVIX_USER,
      senha: LINVIX_PASS,
    }).toString(),
  })

  // Extract PHPSESSID from Set-Cookie headers
  const setCookieHeaders = response.headers.getSetCookie?.() || []
  const allCookies: string[] = []

  for (const cookie of setCookieHeaders) {
    const match = cookie.match(/^([^;]+)/)
    if (match) allCookies.push(match[1])
  }

  if (allCookies.length === 0) {
    // Try reading response body for error details
    let errorDetail = ''
    try {
      const body = await response.text()
      // Check if it's a JSON error response
      const json = JSON.parse(body)
      if (json.status !== 'SUCESSO') {
        errorDetail = json.mensagem || 'Unknown error'
      }
    } catch {
      errorDetail = 'No cookies returned and response is not JSON'
    }
    throw new Error(`Linvix login failed: ${errorDetail}`)
  }

  // Verify login was successful by checking the response
  try {
    const body = await response.text()
    // The AJAX endpoint returns JSON
    const json = JSON.parse(body)
    if (json.status !== 'SUCESSO') {
      throw new Error(`Linvix login rejected: ${json.mensagem || 'Unknown error'}`)
    }
    console.debug(`[LinvixSync] Login successful: ${json.mensagem}`)
  } catch (e: any) {
    if (e.message?.includes('Linvix login rejected')) throw e
    // If we can't parse JSON but got cookies, the login might have worked
    // (some responses mix HTML before JSON)
    console.debug('[LinvixSync] Could not parse login response as JSON, but cookies were received')
  }

  return allCookies.join('; ')
}

/**
 * Build DataTable query parameters for Linvix AJAX endpoints
 */
function buildDatatableParams(options: {
  draw?: number
  start?: number
  length?: number
  columns: Array<{ data: string; name: string; searchable?: boolean; orderable?: boolean }>
  orderColumn?: number
  orderDir?: string
  search?: string
}): URLSearchParams {
  const params = new URLSearchParams()
  const draw = options.draw || 1
  const start = options.start || 0
  const length = options.length || 100

  params.set('draw', draw.toString())
  params.set('start', start.toString())
  params.set('length', length.toString())

  options.columns.forEach((col, i) => {
    params.set(`columns[${i}][data]`, col.data)
    params.set(`columns[${i}][name]`, col.name)
    params.set(`columns[${i}][searchable]`, (col.searchable !== false).toString())
    params.set(`columns[${i}][orderable]`, (col.orderable !== false).toString())
    params.set(`columns[${i}][search][value]`, '')
    params.set(`columns[${i}][search][regex]`, 'false')
  })

  params.set('order[0][column]', (options.orderColumn || 2).toString())
  params.set('order[0][dir]', options.orderDir || 'asc')
  params.set('search[value]', options.search || '')
  params.set('search[regex]', 'false')
  params.set('_', Date.now().toString())

  return params
}

const CLIENT_COLUMNS = [
  { data: 'CODIGO', name: 'CODIGO', searchable: false, orderable: false },
  { data: 'CODIGO', name: 'CODIGO1' },
  { data: 'NOME', name: 'NOME' },
  { data: 'FANTASIA', name: 'FANTASIA' },
  { data: 'TELEFONE', name: 'TELEFONE' },
  { data: 'CELULAR', name: 'CELULAR' },
  { data: 'FAX', name: 'FAX' },
  { data: 'EMAIL', name: 'EMAIL' },
  { data: 'CNPJ_CNPF', name: 'CNPJ_CNPF' },
  { data: 'IE_RG', name: 'IE_RG' },
  { data: 'SITUACAO', name: 'SITUACAO' },
  { data: 'CIDADE', name: 'CIDADE' },
  { data: 'BAIRRO', name: 'BAIRRO' },
  { data: 'UF', name: 'UF' },
  { data: 'CATEGORIA', name: 'CATEGORIA' },
  { data: 'VENDEDOR_NOME', name: 'VENDEDOR' },
]

/**
 * Fetch a single page of clients from Linvix ERP
 */
export async function fetchLinvixClients(
  cookies: string,
  page: number = 0,
  pageSize: number = 200
): Promise<LinvixDatatableResponse> {
  const url = `${LINVIX_BASE_URL}/cadastros/clientes/ajax/ajax-clientes-datatable.php`
  const params = buildDatatableParams({
    draw: page + 1,
    start: page * pageSize,
    length: pageSize,
    columns: CLIENT_COLUMNS,
  })

  const response = await fetchWithTimeout(`${url}?${params.toString()}`, {
    headers: {
      Cookie: cookies,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${LINVIX_BASE_URL}/cadastros/clientes/`,
    },
  })

  if (!response.ok) {
    throw new Error(`Linvix API returned ${response.status}: ${await response.text().then(t => t.substring(0, 200))}`)
  }

  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Linvix API returned invalid JSON: ${text.substring(0, 200)}`)
  }
}

/**
 * Fetch ALL clients from Linvix (handles pagination automatically)
 */
export async function fetchAllLinvixClients(
  cookies: string,
  pageSize: number = 200,
  maxPages: number = 50
): Promise<LinvixClient[]> {
  const allClients: LinvixClient[] = []
  let page = 0

  while (page < maxPages) {
    console.debug(`[LinvixSync] Fetching page ${page + 1}...`)
    const result = await fetchLinvixClients(cookies, page, pageSize)

    if (result.data && result.data.length > 0) {
      allClients.push(...result.data)
    }

    // Check if we've retrieved all records
    const totalFetched = (page + 1) * pageSize
    if (totalFetched >= result.recordsTotal || result.data.length === 0) {
      break
    }

    page++
  }

  console.debug(`[LinvixSync] Fetched ${allClients.length} clients total`)
  return allClients
}

/**
 * Full sync: Login -> Fetch clients -> Batch upsert into database
 *
 * Optimizations:
 * - Bulk fetch existing contacts (1 query instead of N)
 * - Batch createMany for new contacts
 * - Batch updates in groups
 * - DB warm-up for Neon cold starts
 */
export async function syncLinvixClients(db: any): Promise<{
  total: number
  synced: number
  skipped: number
  errors: string[]
}> {
  const errors: string[] = []

  // 0. DB warm-up for Neon cold starts
  console.debug('[LinvixSync] Warming up DB connection...')
  try {
    await db.$queryRaw`SELECT 1`
    console.debug('[LinvixSync] DB warm-up successful')
  } catch (dbError: any) {
    console.warn('[LinvixSync] DB warm-up failed, retrying in 1s...', dbError.message)
    await new Promise(resolve => setTimeout(resolve, 1000))
    try {
      await db.$queryRaw`SELECT 1`
      console.debug('[LinvixSync] DB warm-up retry successful')
    } catch (retryError: any) {
      return {
        total: 0,
        synced: 0,
        skipped: 0,
        errors: [`DB connection failed after retry: ${retryError.message}`],
      }
    }
  }

  // 1. Login
  if (!LINVIX_USER || !LINVIX_PASS) {
    return {
      total: 0,
      synced: 0,
      skipped: 0,
      errors: ['LINVIX_USER and LINVIX_PASS environment variables are not configured'],
    }
  }

  let cookies: string
  try {
    cookies = await linvixLogin()
  } catch (error: any) {
    return {
      total: 0,
      synced: 0,
      skipped: 0,
      errors: [`Login failed: ${error.message}`],
    }
  }

  // 2. Fetch all clients
  let clients: LinvixClient[]
  try {
    clients = await fetchAllLinvixClients(cookies)
  } catch (error: any) {
    return {
      total: 0,
      synced: 0,
      skipped: 0,
      errors: [`Fetch failed: ${error.message}`],
    }
  }

  // 3. Find or create "Linvix - Clientes" contact list
  let contactList = await db.contactList.findFirst({
    where: { name: 'Linvix - Clientes' },
  })

  if (!contactList) {
    contactList = await db.contactList.create({
      data: {
        name: 'Linvix - Clientes',
        columns: JSON.stringify({
          Codigo: 'codigo',
          Fantasia: 'fantasia',
          CNPJ: 'cnpj_cpf',
          'IE/RG': 'ie_rg',
          Cidade: 'cidade',
          UF: 'uf',
          Categoria: 'categoria',
          Vendedor: 'vendedor',
        }),
      },
    })
  }

  // 4. Filter and prepare valid contacts
  const validContacts: Array<{
    phone: string
    nome: string
    customFields: string
    codigo: string
    vendedorNome: string
  }> = []

  let skipped = 0

  for (const client of clients) {
    try {
      const phone = normalizePhone(client.CELULAR || client.TELEFONE || client.FAX || '')
      const nome = cleanName(client.NOME || client.FANTASIA || '')

      if (!phone || phone.length < 10) {
        skipped++
        continue
      }

      if (!nome) {
        skipped++
        continue
      }

      // Skip inactive clients
      if (client.SITUACAO === 'Inativo') {
        skipped++
        continue
      }

      const customFields = JSON.stringify({
        codigo: client.CODIGO || '',
        fantasia: client.FANTASIA || '',
        cnpj_cpf: client.CNPJ_CNPF || '',
        ie_rg: client.IE_RG || '',
        cidade: client.CIDADE || '',
        bairro: client.BAIRRO || '',
        uf: client.UF || '',
        categoria: client.CATEGORIA || '',
        vendedor: client.VENDEDOR_NOME || '',
        email: client.EMAIL || '',
        situacao: client.SITUACAO || '',
        linvix_uuid: client.UUID || '',
      })

      validContacts.push({
        phone,
        nome,
        customFields,
        codigo: client.CODIGO || '',
        vendedorNome: client.VENDEDOR_NOME || '',
      })
    } catch (error: any) {
      errors.push(`Client ${client.CODIGO}: ${error.message}`)
    }
  }

  console.debug(`[LinvixSync] ${validContacts.length} valid contacts out of ${clients.length} total (${skipped} skipped)`)

  // 5. BULK UPSERT — fetch all existing contacts by phone in one query
  const phones = validContacts.map(c => c.phone)

  // Fetch existing contacts in batches to avoid query size limits
  const existingContactMap = new Map<string, { id: string; phone: string }>()

  for (let i = 0; i < phones.length; i += DB_BATCH_SIZE) {
    const batchPhones = phones.slice(i, i + DB_BATCH_SIZE)
    const existing = await db.contact.findMany({
      where: { phone: { in: batchPhones } },
      select: { id: true, phone: true },
    })
    for (const c of existing) {
      existingContactMap.set(c.phone, c)
    }
  }

  console.debug(`[LinvixSync] Found ${existingContactMap.size} existing contacts in DB`)

  // 6. Separate into updates and creates
  const toUpdate: Array<{ id: string; phone: string; nome: string; customFields: string }> = []
  const toCreate: Array<{ phone: string; nome: string; customFields: string; contactListId: string }> = []

  for (const contact of validContacts) {
    const existing = existingContactMap.get(contact.phone)
    if (existing) {
      toUpdate.push({
        id: existing.id,
        phone: contact.phone,
        nome: contact.nome,
        customFields: contact.customFields,
      })
    } else {
      toCreate.push({
        phone: contact.phone,
        nome: contact.nome,
        customFields: contact.customFields,
        contactListId: contactList.id,
      })
    }
  }

  console.debug(`[LinvixSync] ${toCreate.length} new contacts, ${toUpdate.length} to update`)

  // 7. Batch create new contacts
  let created = 0
  for (let i = 0; i < toCreate.length; i += DB_BATCH_SIZE) {
    const batch = toCreate.slice(i, i + DB_BATCH_SIZE)
    try {
      const result = await db.contact.createMany({
        data: batch,
        skipDuplicates: true,
      })
      created += result.count
    } catch (error: any) {
      // Fallback to individual creates if batch fails
      console.warn(`[LinvixSync] Batch create failed, falling back to individual: ${error.message}`)
      for (const contact of batch) {
        try {
          await db.contact.create({ data: contact })
          created++
        } catch (e: any) {
          if (!e.message?.includes('Unique constraint')) {
            errors.push(`Create ${contact.phone}: ${e.message}`)
          }
        }
      }
    }
  }

  // 8. Batch update existing contacts
  let updated = 0
  for (let i = 0; i < toUpdate.length; i += DB_BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + DB_BATCH_SIZE)
    // Run updates in parallel within each batch
    const updatePromises = batch.map(contact =>
      db.contact.update({
        where: { id: contact.id },
        data: {
          name: contact.nome,
          customFields: contact.customFields,
          contactListId: contactList.id,
        },
      }).catch((e: any) => {
        errors.push(`Update ${contact.phone}: ${e.message}`)
        return null
      })
    )
    const results = await Promise.all(updatePromises)
    updated += results.filter(Boolean).length
  }

  // 9. Sync vendedores (batch)
  const vendedorNames = [...new Set(clients.map(c => c.VENDEDOR_NOME).filter(Boolean))]
  console.debug(`[LinvixSync] Syncing ${vendedorNames.length} vendedores...`)

  // Bulk fetch existing vendedores
  const existingVendedores = await db.vendedor.findMany({
    where: { nome: { in: vendedorNames } },
    select: { nome: true },
  })
  const existingVendedorNames = new Set(existingVendedores.map((v: any) => v.nome))

  const newVendedores = vendedorNames.filter(name => !existingVendedorNames.has(name))

  if (newVendedores.length > 0) {
    try {
      await db.vendedor.createMany({
        data: newVendedores.map(nome => ({
          nome,
          empresa: 'Mtech Distribuidora',
          ativo: true,
        })),
        skipDuplicates: true,
      })
    } catch (error: any) {
      errors.push(`Vendedores batch create: ${error.message}`)
    }
  }

  const synced = created + updated

  return {
    total: clients.length,
    synced,
    skipped,
    errors: errors.slice(0, 20),
  }
}

/**
 * Normalize phone number to Brazilian format
 */
function normalizePhone(phone: string): string {
  if (!phone) return ''
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '')
  // Add country code if missing
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits
  }
  // Remove leading 0
  if (digits.startsWith('550')) {
    digits = '55' + digits.substring(3)
  }
  return digits
}

/**
 * Clean name from Linvix format (often includes CPF/CNPJ prefix like "00.067.453 NAME")
 */
function cleanName(name: string): string {
  if (!name) return ''
  // Remove patterns like "00.067.453 " at the beginning (CPF/CNPJ prefix)
  const cleaned = name.replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '')
  return cleaned.trim() || name.trim()
}
