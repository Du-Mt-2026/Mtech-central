/**
 * diag-qr-fail.ts — SELF-CONTAINED diagnostic for QR code failure.
 *
 * Cross-references 3 data sources:
 *   1. OctopusZap DB (Chip table) — what the app thinks the state is
 *   2. Evolution Go /instance/all — what the Evolution API actually has
 *   3. Evolution Go /instance/status — real-time connection state per instance
 *
 * Then prints a clear verdict pointing at the most likely cause of:
 *   "Não foi possível conectar o dispositivo. Tente novamente mais tarde"
 *
 * Usage:
 *   docker compose exec app tsx scripts/diag-qr-fail.ts [phone1] [phone2] ...
 *
 * If no phones given, shows ALL chips.
 *
 * Example:
 *   docker compose exec app tsx scripts/diag-qr-fail.ts 48998232865 48999331752 48996077755
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ============================================================
// Evolution Go direct HTTP client (self-contained — no @/lib/* deps)
// ============================================================

interface EvoCreds {
  apiUrl: string
  apiKey: string
}

async function getEvoCreds(): Promise<EvoCreds> {
  // Priority: DB Settings > env
  const settings = await db.settings.findMany({
    where: { key: { in: ['evolution_api_url', 'evolution_api_key'] } },
  })
  const map = new Map(settings.map(s => [s.key, s.value]))

  const apiUrl =
    map.get('evolution_api_url') ||
    process.env.EVOLUTION_API_URL ||
    ''
  const apiKey =
    map.get('evolution_api_key') ||
    process.env.EVOLUTION_API_KEY ||
    ''

  if (!apiUrl || !apiKey) {
    throw new Error(
      'Evolution Go API não configurada. Defina evolution_api_url e evolution_api_key ' +
      'no banco (Settings) ou no .env do container app.'
    )
  }
  return { apiUrl: apiUrl.replace(/\/$/, ''), apiKey }
}

async function evoFetch(
  creds: EvoCreds,
  endpoint: string,
  opts: RequestInit = {},
  instanceId?: string,
  instanceToken?: string
): Promise<any> {
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
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt.slice(0, 200)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

interface EvoInstance {
  id: string
  name: string
  token: string
  connected: boolean
  jid: string
  proxy: string
  connectionStatus: string
  ownerJid: string | null
  disconnect_reason?: string
}

async function fetchAllInstances(creds: EvoCreds): Promise<EvoInstance[]> {
  const data = await evoFetch(creds, '/instance/all')
  const arr = data.data || data
  if (!Array.isArray(arr)) return []
  return arr.map((i: any) => ({
    id: i.id || '',
    name: i.name || '',
    token: i.token || '',
    connected: !!i.connected,
    jid: i.jid || '',
    proxy: i.proxy || '',
    connectionStatus: i.connectionStatus || (i.connected ? 'open' : 'close'),
    ownerJid: i.jid || null,
    disconnect_reason: i.disconnect_reason || '',
  }))
}

async function fetchRealState(creds: EvoCreds, inst: EvoInstance): Promise<string> {
  try {
    const data = await evoFetch(creds, '/instance/status', {}, inst.id, inst.token)
    const status = data.data || data
    // Matches getConnectionState() logic in src/lib/evolution-api.ts:
    // open only if BOTH Connected AND LoggedIn are true.
    if (status.Connected && status.LoggedIn) return 'open'
    return 'close'
  } catch (e: any) {
    return `ERROR: ${e.message}`
  }
}

// ============================================================
// DB chip type
// ============================================================

interface DBChip {
  id: string
  name: string
  phoneNumber: string
  status: string
  evolutionInstance: string | null
  isQrPaired: boolean
  qrPairingCode: string | null
  wireguardIp: string
  socksPort: number
  proxyMode: string
  socks5Host: string
  socks5Port: number
  socks5User: string
  socks5Pass: string
  lastSeen: Date | null
  updatedAt: Date
}

// ============================================================
// Helpers
// ============================================================

const SEP = '═'.repeat(100)
const SUBSEP = '─'.repeat(100)

function fmtProxy(chip: DBChip): string {
  if (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Port && chip.socks5Pass) {
    return `SOCKS5 ${chip.socks5Host}:${chip.socks5Port} (user=${chip.socks5User || 'none'})`
  }
  if (chip.wireguardIp) {
    return `WireGuard ${chip.wireguardIp}:${chip.socksPort || 8084} (user=${chip.socks5User || 'none'}, pass=${chip.socks5Pass ? 'set' : 'empty'})`
  }
  return '❌ NO PROXY (direct connection)'
}

function verdict(chip: DBChip, evoInst: EvoInstance | undefined, realState: string): string[] {
  const out: string[] = []

  if (!evoInst) {
    out.push('❗ INSTANCE MISSING in Evolution Go — DB has evolutionInstance=' + chip.evolutionInstance)
    out.push('   → Generate QR again; connect flow will create a fresh instance.')
    return out
  }

  // Stale jid detection — the documented cause of the exact error message
  const jid = evoInst.jid || evoInst.ownerJid || ''
  if (jid && realState !== 'open') {
    out.push(`🚨 STALE JID DETECTED — Evolution Go has jid=${jid} but state=${realState}`)
    out.push('   → This is THE documented cause of:')
    out.push('     "Não foi possível conectar o dispositivo. Tente novamente mais tarde"')
    out.push('   → WhatsApp servers see the stale jid as an "active session" and reject the new QR scan.')
    out.push('   → Fix: force delete+recreate the instance to clear the stale jid.')
    return out
  }

  if (!chip.wireguardIp && chip.proxyMode !== 'socks5') {
    out.push('⚠️  NO PROXY — this chip connects via direct server IP')
    out.push('   → If multiple chips share the same IP, WhatsApp may flag sequential connections.')
  }

  if (realState === 'open') {
    out.push('✅ State=open — instance is actually connected.')
    out.push('   → If user still sees error, the QR they scanned was already invalidated.')
    out.push('   → Fix: close and reopen the QR dialog to force a fresh QR.')
  } else if (realState === 'connecting') {
    out.push('⏳ State=connecting — Evolution Go is trying to (re)establish the session.')
    out.push('   → Wait ~10s and re-run this script. If persists, instance is stuck.')
  } else {
    out.push(`ℹ️  State=${realState} — no active session. QR code scan should work.`)
    out.push('   → If user still sees the error, the QR may have expired (TTL ~20s) or was invalidated by a second client.')
  }

  return out
}

// ============================================================
// Main
// ============================================================

async function main() {
  const phones = process.argv.slice(2).map(p => p.replace(/\D/g, ''))

  console.log('\n' + SEP)
  console.log('  QR CODE FAILURE DIAGNOSTIC')
  console.log('  ' + new Date().toISOString())
  console.log(SEP)

  // ── 1. Load chips from DB ────────────────────────────────────────
  console.log('\n1. Loading chips from OctopusZap DB...')
  const chips: DBChip[] = await db.chip.findMany({
    where: phones.length > 0 ? { phoneNumber: { in: phones } } : undefined,
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      status: true,
      evolutionInstance: true,
      isQrPaired: true,
      qrPairingCode: true,
      wireguardIp: true,
      socksPort: true,
      proxyMode: true,
      socks5Host: true,
      socks5Port: true,
      socks5User: true,
      socks5Pass: true,
      lastSeen: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (chips.length === 0) {
    console.log('  No chips found matching the criteria.')
    if (phones.length > 0) console.log('  Phones queried:', phones.join(', '))
    return
  }
  console.log(`  Found ${chips.length} chip(s).`)

  // ── 2. Load all instances from Evolution Go ─────────────────────
  console.log('\n2. Fetching instances from Evolution Go...')
  let evoInstances: EvoInstance[] = []
  try {
    const creds = await getEvoCreds()
    evoInstances = await fetchAllInstances(creds)
    console.log(`  Found ${evoInstances.length} instance(s) in Evolution Go.`)
  } catch (e: any) {
    console.error('  ❌ Failed to fetch instances from Evolution Go:', e.message)
    console.error('  Check EVOLUTION_API_URL and EVOLUTION_API_KEY in your env or DB Settings.')
    return
  }

  // ── 3. Per-chip report ──────────────────────────────────────────
  console.log('\n' + SEP)
  console.log('  PER-CHIP REPORT')
  console.log(SEP)

  const creds = await getEvoCreds()
  const staleJidChips: string[] = []

  for (const chip of chips) {
    const evoInst = evoInstances.find(i => i.name === chip.evolutionInstance)

    console.log('\n' + SUBSEP)
    console.log(`  Chip: ${chip.name}  |  Phone: ${chip.phoneNumber}`)
    console.log(SUBSEP)
    console.log(`  DB status:              ${chip.status}`)
    console.log(`  DB isQrPaired:          ${chip.isQrPaired}`)
    console.log(`  DB qrPairingCode:       ${chip.qrPairingCode || '(none)'}`)
    console.log(`  DB evolutionInstance:   ${chip.evolutionInstance || '(none)'}`)
    console.log(`  DB lastSeen:            ${chip.lastSeen?.toISOString() || '(never)'}`)
    console.log(`  DB updatedAt:           ${chip.updatedAt.toISOString()}`)
    console.log(`  Effective proxy:        ${fmtProxy(chip)}`)

    if (evoInst) {
      console.log('\n  Evolution Go instance:')
      console.log(`    id:                   ${evoInst.id}`)
      console.log(`    name:                 ${evoInst.name}`)
      console.log(`    connected:            ${evoInst.connected}`)
      console.log(`    jid:                  ${evoInst.jid || '(empty — no session)'}`)
      console.log(`    connectionStatus:     ${evoInst.connectionStatus}`)
      console.log(`    proxy:                ${evoInst.proxy || '(none)'}`)
      if (evoInst.disconnect_reason) {
        console.log(`    disconnect_reason:    ${evoInst.disconnect_reason}`)
      }
    } else {
      console.log('\n  Evolution Go instance:  ❌ NOT FOUND (missing in Evolution Go)')
    }

    let realState = 'close'
    if (evoInst) {
      realState = await fetchRealState(creds, evoInst)
      console.log(`    Real-time state:      ${realState}`)
    }

    if (evoInst && (evoInst.jid || evoInst.ownerJid) && realState !== 'open') {
      staleJidChips.push(
        `${chip.phoneNumber} (instance=${evoInst.name}, jid=${evoInst.jid || evoInst.ownerJid})`
      )
    }

    console.log('\n  ── VERDICT ──')
    const lines = verdict(chip, evoInst, realState)
    for (const line of lines) console.log('  ' + line)
  }

  // ── 4. Cross-chip analysis ──────────────────────────────────────
  if (chips.length > 1) {
    console.log('\n' + SEP)
    console.log('  CROSS-CHIP ANALYSIS')
    console.log(SEP)

    const byProxy = new Map<string, DBChip[]>()
    for (const chip of chips) {
      const key = fmtProxy(chip)
      if (!byProxy.has(key)) byProxy.set(key, [])
      byProxy.get(key)!.push(chip)
    }

    console.log('\n  Chips grouped by outbound proxy/IP:')
    for (const [proxy, group] of byProxy) {
      console.log(`\n    ${proxy}`)
      for (const c of group) {
        console.log(`      └─ ${c.phoneNumber} (${c.name}) — status=${c.status}`)
      }
      if (proxy.includes('NO PROXY') && group.length > 1) {
        console.log(`      ⚠️  ${group.length} chips sharing the same direct IP — high anti-abuse risk!`)
      }
    }
  }

  // ── 5. Stale jid summary ────────────────────────────────────────
  console.log('\n' + SEP)
  console.log('  STALE JID SUMMARY')
  console.log(SEP)
  if (staleJidChips.length > 0) {
    console.log('  🚨 Chips with stale jid (likely cause of the error):')
    for (const c of staleJidChips) console.log('    └─ ' + c)
    console.log('\n  RECOMMENDED ACTION:')
    console.log('    Run force-recreate-instance.ts for each affected chip:')
    console.log('      docker compose exec app tsx scripts/force-recreate-instance.ts <phone>')
  } else {
    console.log('  ✅ No stale jids detected among the queried chips.')
    console.log('  → The error is NOT caused by stale sessions in Evolution Go.')
    console.log('  → Other causes to investigate:')
    console.log('    - QR code expired (TTL ~20s) before user scanned')
    console.log('    - Race condition: Evolution Go started a second client and invalidated the first QR')
    console.log('    - WhatsApp anti-abuse on the phone number itself (try from a different phone)')
  }

  // ── 6. Orphan instances ─────────────────────────────────────────
  console.log('\n' + SEP)
  console.log('  ORPHAN INSTANCES (in Evolution Go but not in DB)')
  console.log(SEP)
  const dbInstanceNames = new Set(chips.map(c => c.evolutionInstance).filter(Boolean))
  const orphans = evoInstances.filter(i => !dbInstanceNames.has(i.name))
  if (orphans.length === 0) {
    console.log('  (none)')
  } else {
    for (const o of orphans) {
      console.log(`  └─ ${o.name} (jid=${o.jid || 'none'}, state=${o.connectionStatus})`)
    }
    console.log(`\n  Total orphans: ${orphans.length}`)
  }

  console.log('\n' + SEP)
  console.log('  END OF REPORT')
  console.log(SEP + '\n')
}

main()
  .catch(e => {
    console.error('Diagnostic failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
