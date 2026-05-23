/**
 * Linvix ERP Integration Library
 * 
 * Connects to the Linvix (Linx Microvix) ERP via its DataTable AJAX endpoints.
 * Uses cookie-based authentication (PHP session).
 * 
 * Data available:
 * - Clients (Clientes): CODIGO, NOME, FANTASIA, TELEFONE, CELULAR, FAX, EMAIL,
 *   CNPJ_CNPF, IE_RG, SITUACAO, CIDADE, BAIRRO, UF, CATEGORIA, VENDEDOR_NOME
 * - Orders (Pedidos): retrieved via reports
 */

const LINVIX_BASE_URL = process.env.LINVIX_URL || 'https://rp.erp.linvix.com'
const LINVIX_USER = process.env.LINVIX_USER || ''
const LINVIX_PASS = process.env.LINVIX_PASS || ''

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
 * Login to Linvix ERP and return session cookies
 */
async function linvixLogin(): Promise<string> {
  const loginUrl = `${LINVIX_BASE_URL}/login.php`

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: 'manual', // Don't follow redirects - we need the Set-Cookie header
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
    throw new Error('Linvix login failed: no cookies returned')
  }

  // If we got redirected (302), the login was successful
  const location = response.headers.get('location')
  if (response.status === 302 || location) {
    // Need to follow redirect to establish full session
    const followResponse = await fetch(`${LINVIX_BASE_URL}${location || '/'}`, {
      headers: { Cookie: allCookies.join('; ') },
      redirect: 'manual',
    })

    // Get any additional cookies from the redirect
    const moreCookies = followResponse.headers.getSetCookie?.() || []
    for (const cookie of moreCookies) {
      const match = cookie.match(/^([^;]+)/)
      if (match) allCookies.push(match[1])
    }
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
 * Fetch all clients from Linvix ERP (paginated)
 */
export async function fetchLinvixClients(
  cookies: string,
  page: number = 0,
  pageSize: number = 100
): Promise<LinvixDatatableResponse> {
  const url = `${LINVIX_BASE_URL}/cadastros/clientes/ajax/ajax-clientes-datatable.php`
  const params = buildDatatableParams({
    draw: page + 1,
    start: page * pageSize,
    length: pageSize,
    columns: CLIENT_COLUMNS,
  })

  const response = await fetch(`${url}?${params.toString()}`, {
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

  return allClients
}

/**
 * Full sync: Login → Fetch clients → Upsert into database
 */
export async function syncLinvixClients(db: any): Promise<{
  total: number
  synced: number
  skipped: number
  errors: string[]
}> {
  const errors: string[] = []

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

  // 3. Find or create a "Linvix Sync" contact list
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

  // 4. Upsert clients as contacts
  let synced = 0
  let skipped = 0

  for (const client of clients) {
    try {
      // Normalize phone number
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

      // Build custom fields from Linvix data
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

      // Upsert by phone number (unique identifier)
      const existing = await db.contact.findFirst({
        where: { phone },
      })

      if (existing) {
        await db.contact.update({
          where: { id: existing.id },
          data: {
            name: nome,
            customFields,
            contactListId: contactList.id,
          },
        })
      } else {
        await db.contact.create({
          data: {
            name: nome,
            phone,
            customFields,
            contactListId: contactList.id,
          },
        })
      }

      synced++
    } catch (error: any) {
      errors.push(`Client ${client.CODIGO}: ${error.message}`)
    }
  }

  // 5. Sync vendedores
  const vendedorNames = [...new Set(clients.map(c => c.VENDEDOR_NOME).filter(Boolean))]
  let vendedoresSynced = 0

  for (const vendedorNome of vendedorNames) {
    try {
      const existing = await db.vendedor.findFirst({
        where: { nome: vendedorNome },
      })

      if (!existing) {
        await db.vendedor.create({
          data: {
            nome: vendedorNome,
            empresa: 'Mtech Distribuidora',
            ativo: true,
          },
        })
        vendedoresSynced++
      }
    } catch (error: any) {
      errors.push(`Vendedor ${vendedorNome}: ${error.message}`)
    }
  }

  return {
    total: clients.length,
    synced,
    skipped,
    errors: errors.slice(0, 20), // Limit error messages
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
