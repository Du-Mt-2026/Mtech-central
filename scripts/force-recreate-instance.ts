/**
 * force-recreate-instance.ts — Force delete + recreate Evolution Go instance.
 *
 * USE CASE:
 *   When a chip has a stale jid (jid in Evolution Go's DB but session is dead),
 *   scanning a new QR code fails with the WhatsApp mobile app error:
 *     "Não foi possível conectar o dispositivo. Tente novamente mais tarde"
 *
 *   This script:
 *     1. Finds the chip in DB by phone number
 *     2. Disconnects + deletes the Evolution Go instance (clears the stale jid)
 *     3. Creates a fresh instance with the SAME name (proxy preserved)
 *     4. Calls /instance/connect to start a new WhatsApp client
 *     5. Waits for the QR code (with retries)
 *     6. Updates the DB
 *
 *   After running, the user should be able to scan the QR code in OctopusZap
 *   and successfully connect.
 *
 * Usage:
 *   docker compose exec app tsx scripts/force-recreate-instance.ts <phone>
 *
 * Example:
 *   docker compose exec app tsx scripts/force-recreate-instance.ts 48999331752
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ============================================================
// Evolution Go direct HTTP client (self-contained)
// ============================================================

async function getEvoCreds() {
  const settings = await db.settings.findMany({
    where: { key: { in: ['evolution_api_url', 'evolution_api_key'] } },
  })
  const map = new Map(settings.map(s => [s.key, s.value]))

  const apiUrl = map.get('evolution_api_url') || process.env.EVOLUTION_API_URL || ''
  const apiKey = map.get('evolution_api_key') || process.env.EVOLUTION_API_KEY || ''

  if (!apiUrl || !apiKey) {
    throw new Error('Evolution Go API não configurada.')
  }
  return { apiUrl: apiUrl.replace(/\/$/, ''), apiKey }
}

async function evoFetch(creds: any, endpoint: string, opts: RequestInit = {}, instanceId?: string, instanceToken?: string) {
  const url = `${creds.apiUrl}${endpoint}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: instanceToken || creds.apiKey,
    ...(instanceId ? { instanceId } : {}),
    ...(opts.headers as Record<string, string> || {}),
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { ...opts, headers, signal: controller.signal })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function findInstance(creds: any, name: string) {
  const data = await evoFetch(creds, '/instance/all')
  const arr = data.data || data
  if (!Array.isArray(arr)) return null
  return arr.find((i: any) => i.name === name) || null
}

async function disconnectInstance(creds: any, instanceId: string, instanceToken: string) {
  await evoFetch(creds, '/instance/disconnect', { method: 'POST' }, instanceId, instanceToken)
}

async function deleteInstance(creds: any, instanceId: string, instanceToken: string) {
  await evoFetch(creds, `/instance/delete/${instanceId}`, { method: 'DELETE' }, instanceId, instanceToken)
}

async function createInstance(creds: any, name: string, proxyConfig?: any) {
  const body: any = { name, token: '', webhook: '' }
  if (proxyConfig) {
    body.proxy = proxyConfig
  }
  const data = await evoFetch(creds, '/instance/create', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data.instance || data.data || data
}

async function connectInstance(creds: any, instanceId: string, instanceToken: string, webhookUrl?: string) {
  const body = webhookUrl ? { webhook: webhookUrl } : {}
  const data = await evoFetch(creds, '/instance/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceId, instanceToken)
  return data
}

async function fetchQRCode(creds: any, instanceId: string, instanceToken: string) {
  const data = await evoFetch(creds, '/instance/qr', {}, instanceId, instanceToken)
  return data
}

// ============================================================
// Resolve proxy (mirrors resolveChipProxy logic)
// ============================================================

function resolveProxy(chip: any): any | null {
  if (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Port && chip.socks5Pass) {
    return {
      enabled: true,
      host: chip.socks5Host,
      port: String(chip.socks5Port),
      username: chip.socks5User || '',
      password: chip.socks5Pass,
      protocol: 'socks5',
    }
  }
  if (chip.wireguardIp) {
    return {
      enabled: true,
      host: chip.wireguardIp,
      port: String(chip.socksPort || 8084),
      username: chip.socks5User || '',
      password: chip.socks5Pass || '',
      protocol: 'socks5',
    }
  }
  return null
}

// ============================================================
// Main
// ============================================================

async function main() {
  const phone = process.argv[2]?.replace(/\D/g, '')

  if (!phone) {
    console.error('Usage: tsx scripts/force-recreate-instance.ts <phone>')
    console.error('Example: tsx scripts/force-recreate-instance.ts 48999331752')
    process.exit(1)
  }

  console.log(`\n🔧 Force-recreate Evolution Go instance for chip ${phone}\n`)

  const chip = await db.chip.findFirst({ where: { phoneNumber: phone } })
  if (!chip) {
    console.error(`❌ Chip with phone ${phone} not found in DB.`)
    process.exit(1)
  }

  console.log(`  Chip ID:             ${chip.id}`)
  console.log(`  Chip name:           ${chip.name}`)
  console.log(`  Evolution instance:  ${chip.evolutionInstance || '(none)'}`)
  console.log(`  WireGuard IP:        ${chip.wireguardIp || '(none)'}`)
  console.log(`  Status:              ${chip.status}`)

  const creds = await getEvoCreds()
  console.log(`\n  Evolution API URL:   ${creds.apiUrl}`)

  // Build instance name (same logic as /api/whatsapp/connect/route.ts)
  const { getInstanceName } = await import('../src/lib/evolution-api')
  const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)
  console.log(`  Target instance:     ${instanceName}`)

  // Build webhook URL (same logic as /api/whatsapp/connect/route.ts)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookToken = process.env.EVOLUTION_API_KEY || ''
  const webhookUrl = webhookToken
    ? `${appUrl}/api/whatsapp/webhook?token=${webhookToken}`
    : `${appUrl}/api/whatsapp/webhook`
  console.log(`  Webhook URL:         ${webhookUrl}`)

  const proxyConfig = resolveProxy(chip)
  if (proxyConfig) {
    console.log(`  Proxy:               ${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`)
  } else {
    console.log(`  Proxy:               (none — direct connection)`)
  }

  // ── STEP 1: Find existing instance ─────────────────────────────
  console.log('\n── STEP 1: Find existing instance ──')
  const existing = await findInstance(creds, instanceName)
  if (!existing) {
    console.log(`  No existing instance named "${instanceName}" — skipping delete.`)
  } else {
    console.log(`  Found: id=${existing.id}, jid=${existing.jid || '(none)'}, connected=${existing.connected}`)
    if (existing.jid) {
      console.log(`  ⚠️  Instance has jid=${existing.jid} — this is the STALE jid causing the error.`)
    }
  }

  // ── STEP 2: Disconnect + Delete ────────────────────────────────
  if (existing) {
    console.log('\n── STEP 2: Disconnect + Delete existing instance ──')
    try {
      await disconnectInstance(creds, existing.id, existing.token)
      console.log('  ✅ Disconnected')
    } catch (e: any) {
      console.log(`  ⚠️  Disconnect failed (continuing): ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 1000))
    try {
      await deleteInstance(creds, existing.id, existing.token)
      console.log('  ✅ Deleted (stale jid cleared)')
    } catch (e: any) {
      console.error(`  ❌ Delete failed: ${e.message}`)
      console.error('  Cannot continue — manual intervention required.')
      process.exit(1)
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  // ── STEP 3: Create fresh instance ──────────────────────────────
  console.log('\n── STEP 3: Create fresh instance ──')
  let newInstance: any
  try {
    newInstance = await createInstance(creds, instanceName, proxyConfig)
    console.log(`  ✅ Created: name=${newInstance.name || instanceName}, id=${newInstance.id || '(?)'}`)
  } catch (e: any) {
    console.error(`  ❌ Create failed: ${e.message}`)
    process.exit(1)
  }

  const newName = newInstance.name || instanceName
  const newId = newInstance.id
  const newToken = newInstance.token

  if (!newId || !newToken) {
    console.error('  ❌ New instance missing id or token — cannot proceed.')
    console.error('  Response:', JSON.stringify(newInstance, null, 2).slice(0, 500))
    process.exit(1)
  }

  // ── STEP 4: Connect + wait for QR ──────────────────────────────
  console.log('\n── STEP 4: Connect + wait for QR code ──')
  try {
    await connectInstance(creds, newId, newToken, webhookUrl)
    console.log('  ✅ /instance/connect called — goroutine started')
  } catch (e: any) {
    console.log(`  ⚠️  Connect call returned: ${e.message}`)
  }

  // CRITICAL: wait 4s before fetching QR to avoid the race condition
  // (see evolution-router.ts connectInstance() comment)
  console.log('  Waiting 4s for client goroutine to start...')
  await new Promise(r => setTimeout(r, 4000))

  // Retry QR fetch up to 5 times with 3s delay
  let qrData: any = null
  for (let i = 1; i <= 5; i++) {
    console.log(`  Fetching QR (attempt ${i}/5)...`)
    try {
      const qr = await fetchQRCode(creds, newId, newToken)
      if (qr?.qrcode || qr?.code) {
        qrData = qr
        console.log(`  ✅ QR code obtained!`)
        break
      }
      if (qr?.state === 'open') {
        console.log('  ✅ Instance is already open — session auto-restored!')
        qrData = { state: 'open' }
        break
      }
      console.log(`  No QR yet, waiting 3s...`)
    } catch (e: any) {
      console.log(`  Attempt ${i} failed: ${e.message}`)
    }
    if (i < 5) await new Promise(r => setTimeout(r, 3000))
  }

  // ── STEP 5: Update DB ──────────────────────────────────────────
  console.log('\n── STEP 5: Update DB ──')
  const state = qrData?.state || 'close'
  const isConnected = state === 'open'

  await db.chip.update({
    where: { id: chip.id },
    data: {
      status: isConnected ? 'connected' : 'connecting',
      evolutionInstance: newName,
      qrPairingCode: qrData?.code || null,
      lastSeen: isConnected ? new Date() : chip.lastSeen,
      ...(isConnected ? { isQrPaired: true } : {}),
    },
  })

  console.log(`  ✅ DB updated — status=${isConnected ? 'connected' : 'connecting'}`)
  console.log(`     evolutionInstance=${newName}`)
  console.log(`     qrPairingCode=${qrData?.code || '(none)'}`)

  // ── Done ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80))
  if (isConnected) {
    console.log('  ✅ Session auto-restored — chip is connected!')
  } else if (qrData?.qrcode) {
    console.log('  ✅ Fresh QR code generated.')
    console.log('  → Open OctopusZap, go to Chips tab, click "Conectar" for this chip.')
    console.log('  → The QR code displayed should now scan successfully.')
    console.log('  → If you still see "Não foi possível conectar o dispositivo",')
    console.log('    the issue is on the WhatsApp mobile side — try:')
    console.log('    - Scan from a different phone')
    console.log('    - Wait 24h (WhatsApp may have flagged the number)')
  } else {
    console.log('  ⚠️  No QR code generated. Check Evolution Go logs:')
    console.log('     docker compose logs evolution-go --tail 50')
  }
  console.log('═'.repeat(80) + '\n')
}

main()
  .catch(e => {
    console.error('Force-recreate failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
