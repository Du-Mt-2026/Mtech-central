// Reconnection Queue — Anti-Ban Safe Multi-Chip Reconnection
// ============================================================
// When multiple chips disconnect simultaneously (server restart, network
// outage, Evolution API restart), this queue ensures they reconnect ONE
// AT A TIME with proper delays, preventing:
//   1. API call storms that crash Evolution API
//   2. WhatsApp detection of mass reconnection patterns → bans
//   3. Race conditions in DB status updates
//   4. QR code request floods
//
// Features:
//   - Priority queue: chips in active campaigns reconnect first
//   - Configurable concurrency (default: 2 simultaneous reconnections)
//   - Exponential backoff with jitter (5s → 15s → 45s → 2min → 5min → 10min)
//   - Global rate limiting (max N reconnections per time window)
//   - Ban detection before each reconnect attempt
//   - Sending window awareness (don't reconnect outside business hours)
//   - Circuit breaker (pause reconnections if Evolution API is down)
//   - Auto-resume paused campaigns when chips come back online
//
// Serverless-compatible: uses in-memory state within a single Vercel
// function invocation. Cross-invocation coordination via DB locks.

import { db } from './db'
import {
  connectInstance as routerConnectInstance,
  getInstanceQRCode as routerGetQRCode,
  getConnectionState,
  resolveChipProxy,
  getGlobalProxy,
  setWebhook,
  createInstance,
  findInstanceByName,
  testAllConnections as testConnection,
} from './evolution-router'
import { toMins, getCurrentMinutes } from './time-utils'

// ============================================================
// TYPES
// ============================================================

export interface ReconnectionEntry {
  chipId: string
  chipName: string
  instanceName: string
  priority: number          // Lower = higher priority. 0 = critical (in active campaign), 10 = normal
  attemptCount: number
  nextAttemptAt: Date       // When to try next reconnection
  lastAttemptAt: Date | null
  lastError: string | null
  status: 'queued' | 'in_progress' | 'waiting_backoff' | 'connected' | 'failed' | 'banned'
  addedAt: Date
  campaignIds: string[]     // Campaigns that need this chip
}

export interface ReconnectionStats {
  queueLength: number
  inProgress: number
  totalReconnected: number
  totalFailed: number
  totalBanned: number
  circuitBreakerOpen: boolean
  lastReconnectAt: Date | null
}

// ============================================================
// CONFIGURATION
// ============================================================

// Default config — used as fallback when DB is not available
const DEFAULT_CONFIG = {
  MAX_CONCURRENT: 2,
  BACKOFF_MS: [5_000, 15_000, 45_000, 120_000, 300_000, 600_000],
  JITTER_FACTOR: 0.5,
  MAX_ATTEMPTS: 10,
  RATE_LIMIT_COUNT: 5,
  RATE_LIMIT_WINDOW_MS: 10 * 60 * 1000,
  CIRCUIT_BREAKER_THRESHOLD: 3,
  CIRCUIT_BREAKER_RESET_MS: 5 * 60 * 1000,
  RESPECT_SENDING_WINDOW: false,
  INTER_RECONNECT_DELAY_MS: 15_000,
  CONNECT_TIMEOUT_MS: 60_000,
}

/**
 * Load reconnection config from AntiBanSettings in DB.
 * Falls back to defaults if DB is unavailable.
 * Caches for 60 seconds to avoid excessive DB queries.
 */
let configCache: { data: typeof DEFAULT_CONFIG; expiresAt: number } | null = null

async function getConfig(): Promise<typeof DEFAULT_CONFIG> {
  const now = Date.now()
  if (configCache && configCache.expiresAt > now) {
    return configCache.data
  }

  try {
    const settings = await db.antiBanSettings.findFirst()
    if (settings) {
      let backoffMs = DEFAULT_CONFIG.BACKOFF_MS
      try {
        const parsed = typeof settings.reconnectBackoffMs === 'string'
          ? JSON.parse(settings.reconnectBackoffMs)
          : settings.reconnectBackoffMs
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
          backoffMs = parsed
        }
      } catch { /* use default */ }

      const config = {
        MAX_CONCURRENT: settings.reconnectMaxConcurrent ?? DEFAULT_CONFIG.MAX_CONCURRENT,
        BACKOFF_MS: backoffMs,
        JITTER_FACTOR: 0.5, // Keep jitter as constant (not user-configurable)
        MAX_ATTEMPTS: settings.reconnectMaxAttempts ?? DEFAULT_CONFIG.MAX_ATTEMPTS,
        RATE_LIMIT_COUNT: settings.reconnectRateLimit ?? DEFAULT_CONFIG.RATE_LIMIT_COUNT,
        RATE_LIMIT_WINDOW_MS: (settings.reconnectRateWindowMin ?? 10) * 60 * 1000,
        CIRCUIT_BREAKER_THRESHOLD: settings.circuitBreakerThreshold ?? DEFAULT_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
        CIRCUIT_BREAKER_RESET_MS: 5 * 60 * 1000, // Keep as constant
        RESPECT_SENDING_WINDOW: settings.reconnectRespectWindow ?? DEFAULT_CONFIG.RESPECT_SENDING_WINDOW,
        INTER_RECONNECT_DELAY_MS: settings.reconnectInterDelayMs ?? DEFAULT_CONFIG.INTER_RECONNECT_DELAY_MS,
        CONNECT_TIMEOUT_MS: settings.reconnectConnectTimeoutMs ?? DEFAULT_CONFIG.CONNECT_TIMEOUT_MS,
      }
      configCache = { data: config, expiresAt: now + 60_000 }
      return config
    }
  } catch { /* fallback to defaults */ }

  configCache = { data: DEFAULT_CONFIG, expiresAt: now + 60_000 }
  return DEFAULT_CONFIG
}

// ============================================================
// IN-MEMORY STATE (within single serverless invocation)
// ============================================================

let reconnectionQueue: Map<string, ReconnectionEntry> = new Map()
let currentlyReconnecting: Set<string> = new Set() // chipIds being processed right now
let recentReconnections: Date[] = [] // timestamps of recent reconnects (for rate limiting)
let consecutiveApiFailures = 0
let circuitBreakerOpen = false
let circuitBreakerOpenedAt: Date | null = null
let totalReconnected = 0
let totalFailed = 0
let totalBanned = 0
let lastReconnectAt: Date | null = null

// Processing lock — prevents multiple concurrent processQueue() calls
let isProcessing = false

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Add a chip to the reconnection queue.
 * Called by the webhook handler when a chip disconnects.
 *
 * If the chip is already in the queue, this resets its backoff
 * (new disconnection = fresh start, but keeps attempt count for backoff).
 */
export async function enqueueReconnection(
  chipId: string,
  options?: { immediate?: boolean; reason?: string }
): Promise<void> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) {
    console.warn(`[ReconnectQueue] Chip ${chipId} not found, skipping`)
    return
  }

  // Don't queue banned chips — they need manual intervention
  const BAN_CODES = [401, 403, 428, 440]
  if (chip.disconnectionReasonCode && BAN_CODES.includes(chip.disconnectionReasonCode)) {
    console.log(`[ReconnectQueue] Chip ${chip.name} has ban code ${chip.disconnectionReasonCode}, NOT queueing`)
    return
  }

  if (chip.status === 'banned') {
    console.log(`[ReconnectQueue] Chip ${chip.name} is banned, NOT queueing`)
    return
  }

  // Already connected? Skip
  if (chip.status === 'connected') {
    console.log(`[ReconnectQueue] Chip ${chip.name} is already connected, skipping`)
    return
  }

  // Already being reconnected right now? Skip
  if (currentlyReconnecting.has(chipId)) {
    console.log(`[ReconnectQueue] Chip ${chip.name} is already being reconnected, skipping`)
    return
  }

  // Find campaigns that need this chip (for priority calculation)
  const campaignChips = await db.campaignChip.findMany({
    where: { chipId },
    include: { campaign: { select: { id: true, status: true } } },
  })
  const activeCampaignIds = campaignChips
    .filter(cc => cc.campaign.status === 'running' || cc.campaign.status === 'paused')
    .map(cc => cc.campaign.id)

  // Priority: 0 = chip in active campaign (reconnect ASAP), 10 = idle chip
  const priority = activeCampaignIds.length > 0 ? 0 : 10

  const existing = reconnectionQueue.get(chipId)
  const attemptCount = existing ? existing.attemptCount : 0

  const entry: ReconnectionEntry = {
    chipId,
    chipName: chip.name,
    instanceName: chip.evolutionInstance || '',
    priority,
    attemptCount,
    nextAttemptAt: options?.immediate ? new Date() : calculateNextAttempt(attemptCount, await getConfig()),
    lastAttemptAt: existing?.lastAttemptAt || null,
    lastError: existing?.lastError || null,
    status: 'queued',
    addedAt: existing?.addedAt || new Date(),
    campaignIds: activeCampaignIds,
  }

  reconnectionQueue.set(chipId, entry)
  console.log(`[ReconnectQueue] Enqueued chip ${chip.name} (priority=${priority}, campaigns=${activeCampaignIds.length}, attempt=${attemptCount}, next=${entry.nextAttemptAt.toISOString()})`)

  // Trigger processing
  processQueue()
}

/**
 * Remove a chip from the reconnection queue.
 * Called when a chip successfully connects via webhook.
 */
export function dequeueReconnection(chipId: string): void {
  const entry = reconnectionQueue.get(chipId)
  if (entry) {
    console.log(`[ReconnectQueue] Dequeued chip ${entry.chipName} (was ${entry.status})`)
    reconnectionQueue.delete(chipId)
  }
  currentlyReconnecting.delete(chipId)
}

/**
 * Mark a chip as successfully reconnected.
 * Called by the webhook handler on Connected event.
 */
export async function markChipReconnected(chipId: string): Promise<void> {
  dequeueReconnection(chipId)
  totalReconnected++
  lastReconnectAt = new Date()
  consecutiveApiFailures = 0 // Reset circuit breaker on success
  recentReconnections.push(new Date())

  // Auto-resume campaigns that were paused because this chip disconnected
  await autoResumeCampaigns(chipId)
}

/**
 * Process the reconnection queue.
 * This is the main loop that picks the next chip to reconnect
 * and initiates the reconnection process.
 *
 * Safe to call multiple times — has a lock to prevent concurrent processing.
 */
export async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true
  const CONFIG = await getConfig()

  try {
    // Check circuit breaker
    if (circuitBreakerOpen) {
      if (circuitBreakerOpenedAt && Date.now() - circuitBreakerOpenedAt.getTime() > CONFIG.CIRCUIT_BREAKER_RESET_MS) {
        console.log('[ReconnectQueue] Circuit breaker reset, trying again')
        circuitBreakerOpen = false
        circuitBreakerOpenedAt = null
      } else {
        console.log('[ReconnectQueue] Circuit breaker open, skipping processing')
        return
      }
    }

    // Check rate limit
    const windowStart = Date.now() - CONFIG.RATE_LIMIT_WINDOW_MS
    recentReconnections = recentReconnections.filter(d => d.getTime() > windowStart)
    if (recentReconnections.length >= CONFIG.RATE_LIMIT_COUNT) {
      console.log(`[ReconnectQueue] Rate limit reached (${recentReconnections.length}/${CONFIG.RATE_LIMIT_COUNT} in last ${CONFIG.RATE_LIMIT_WINDOW_MS / 1000}s)`)
      return
    }

    // Check concurrency limit
    if (currentlyReconnecting.size >= CONFIG.MAX_CONCURRENT) {
      console.log(`[ReconnectQueue] Max concurrent reconnections reached (${currentlyReconnecting.size}/${CONFIG.MAX_CONCURRENT})`)
      return
    }

    // Get sorted queue entries (by priority, then by nextAttemptAt)
    const sortedEntries = Array.from(reconnectionQueue.values())
      .filter(entry => {
        // Only process entries that are ready (nextAttemptAt has passed)
        if (entry.status === 'banned' || entry.status === 'failed' || entry.status === 'connected') return false
        if (new Date() < entry.nextAttemptAt) return false
        if (currentlyReconnecting.has(entry.chipId)) return false
        return true
      })
      .sort((a, b) => {
        // Sort by priority first (lower = higher priority)
        if (a.priority !== b.priority) return a.priority - b.priority
        // Then by nextAttemptAt (earlier = higher priority)
        return a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime()
      })

    if (sortedEntries.length === 0) return

    // Process the next entry
    const entry = sortedEntries[0]

    // Optional: Check sending window
    if (CONFIG.RESPECT_SENDING_WINDOW) {
      const settings = await db.antiBanSettings.findFirst()
      if (settings) {
        const currentMins = getCurrentMinutes(settings.timezone)
        const start = toMins(settings.sendingWindowStart)
        const end = toMins(settings.sendingWindowEnd)
        // All-day window (0-1440) means always in window
        const inWindow = (start === 0 && end >= 1440) ? true
          : start <= end
            ? (currentMins >= start && currentMins < end)
            : (currentMins >= start || currentMins < end)
        if (!inWindow) {
          console.log(`[ReconnectQueue] Outside sending window, delaying reconnection for ${entry.chipName}`)
          return
        }
      }
    }

    await attemptReconnection(entry)

  } finally {
    isProcessing = false
  }
}

/**
 * Get current reconnection queue status.
 */
export function getReconnectionStats(): ReconnectionStats {
  return {
    queueLength: reconnectionQueue.size,
    inProgress: currentlyReconnecting.size,
    totalReconnected,
    totalFailed,
    totalBanned,
    circuitBreakerOpen,
    lastReconnectAt,
  }
}

/**
 * Get all entries in the queue (for monitoring UI).
 */
export function getQueueEntries(): ReconnectionEntry[] {
  return Array.from(reconnectionQueue.values()).sort((a, b) => a.priority - b.priority)
}

/**
 * Manually trigger a reconnection for a specific chip.
 * Resets the attempt count and immediately queues it.
 */
export async function forceReconnect(chipId: string): Promise<{ queued: boolean; reason?: string }> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return { queued: false, reason: 'Chip não encontrado' }
  if (chip.status === 'connected') return { queued: false, reason: 'Chip já está conectado' }
  if (chip.status === 'banned') return { queued: false, reason: 'Chip está banido' }

  // Reset attempt count for forced reconnect
  const existing = reconnectionQueue.get(chipId)
  const entry: ReconnectionEntry = {
    chipId,
    chipName: chip.name,
    instanceName: chip.evolutionInstance || '',
    priority: 0, // Force = highest priority
    attemptCount: 0,
    nextAttemptAt: new Date(),
    lastAttemptAt: null,
    lastError: null,
    status: 'queued',
    addedAt: existing?.addedAt || new Date(),
    campaignIds: existing?.campaignIds || [],
  }

  reconnectionQueue.set(chipId, entry)
  processQueue()
  return { queued: true }
}

/**
 * Check all disconnected chips and queue them for reconnection.
 * Called by the health check cron.
 */
export async function healthCheckDisconnectedChips(): Promise<{ checked: number; queued: number; alreadyQueued: number }> {
  try {
    // First, test if Evolution API is reachable
    const apiTest = await testConnection()
    if (!apiTest.success) {
      console.log(`[ReconnectQueue] Evolution API unreachable: ${apiTest.error}`)
      if (!circuitBreakerOpen) {
        circuitBreakerOpen = true
        circuitBreakerOpenedAt = new Date()
        console.log('[ReconnectQueue] Circuit breaker OPENED — Evolution API is down')
      }
      return { checked: 0, queued: 0, alreadyQueued: 0 }
    }

    // Reset circuit breaker if API is back
    if (circuitBreakerOpen) {
      circuitBreakerOpen = false
      circuitBreakerOpenedAt = null
      console.log('[ReconnectQueue] Circuit breaker CLOSED — Evolution API is back')
    }

    // Find all disconnected chips (not banned)
    const disconnectedChips = await db.chip.findMany({
      where: {
        status: { in: ['disconnected', 'connecting'] },
        disconnectionReasonCode: { notIn: [401, 403, 428, 440] },
        evolutionInstance: { not: null },
      },
    })

    let queued = 0
    let alreadyQueued = 0

    for (const chip of disconnectedChips) {
      if (reconnectionQueue.has(chip.id) || currentlyReconnecting.has(chip.id)) {
        alreadyQueued++
        continue
      }
      await enqueueReconnection(chip.id)
      queued++
    }

    console.log(`[ReconnectQueue] Health check: ${disconnectedChips.length} disconnected, ${queued} newly queued, ${alreadyQueued} already in queue`)

    // Also process the queue
    await processQueue()

    return { checked: disconnectedChips.length, queued, alreadyQueued }
  } catch (error: any) {
    console.error(`[ReconnectQueue] Health check error: ${error.message}`)
    return { checked: 0, queued: 0, alreadyQueued: 0 }
  }
}

/**
 * Clear all queue state (for testing or reset).
 */
export function resetQueue(): void {
  reconnectionQueue.clear()
  currentlyReconnecting.clear()
  recentReconnections = []
  consecutiveApiFailures = 0
  circuitBreakerOpen = false
  circuitBreakerOpenedAt = null
}

// ============================================================
// INTERNAL FUNCTIONS
// ============================================================

/**
 * Attempt to reconnect a single chip.
 * This is the core reconnection logic with full error handling.
 */
async function attemptReconnection(entry: ReconnectionEntry): Promise<void> {
  const CONFIG = await getConfig()
  const { chipId, chipName, instanceName } = entry

  // Mark as in progress
  currentlyReconnecting.add(chipId)
  const updatedEntry = { ...entry, status: 'in_progress' as const, lastAttemptAt: new Date() }
  reconnectionQueue.set(chipId, updatedEntry)

  console.log(`[ReconnectQueue] Attempting reconnection for ${chipName} (attempt ${entry.attemptCount + 1}/${CONFIG.MAX_ATTEMPTS})`)

  try {
    // 1. Check if chip is still disconnected (might have reconnected elsewhere)
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      console.log(`[ReconnectQueue] Chip ${chipName} no longer exists, removing from queue`)
      reconnectionQueue.delete(chipId)
      currentlyReconnecting.delete(chipId)
      return
    }

    if (chip.status === 'connected') {
      console.log(`[ReconnectQueue] Chip ${chipName} is already connected! Removing from queue`)
      await markChipReconnected(chipId)
      return
    }

    // 2. Check for ban codes (might have been banned since we queued it)
    const BAN_CODES = [401, 403, 428, 440]
    if (chip.disconnectionReasonCode && BAN_CODES.includes(chip.disconnectionReasonCode)) {
      console.log(`[ReconnectQueue] Chip ${chipName} has ban code ${chip.disconnectionReasonCode}, marking as banned`)
      reconnectionQueue.set(chipId, { ...updatedEntry, status: 'banned', lastError: `Ban code: ${chip.disconnectionReasonCode}` })
      currentlyReconnecting.delete(chipId)
      totalBanned++
      return
    }

    // 3. Check live connection state from Evolution API
    if (instanceName) {
      try {
        const state = await getConnectionState(instanceName)
        const instanceState = state?.state
        if (instanceState === 'open') {
          console.log(`[ReconnectQueue] Chip ${chipName} is actually connected in Evolution API! Updating DB`)
          await db.chip.update({
            where: { id: chipId },
            data: { status: 'connected', lastSeen: new Date(), isQrPaired: true },
          })
          await markChipReconnected(chipId)
          return
        }
      } catch {
        // Can't reach Evolution API — count as failure
        consecutiveApiFailures++
        if (consecutiveApiFailures >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
          circuitBreakerOpen = true
          circuitBreakerOpenedAt = new Date()
          console.log('[ReconnectQueue] Circuit breaker OPENED — too many Evolution API failures')
        }
        throw new Error('Evolution API unreachable')
      }
    }

    // 4. Set chip status to "connecting" in DB
    await db.chip.update({
      where: { id: chipId },
      data: { status: 'connecting' },
    })

    // 5. Attempt reconnection via Evolution API (v3-only)
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`

    let effectiveInstanceName = instanceName

    // Check if instance still exists, recreate if needed
    const existing = await findInstanceByName(instanceName)

    if (!existing) {
      // Instance was deleted — need to recreate WITH proxy if available.
      // Previously we recreated WITHOUT proxy because we thought proxy blocked QR codes,
      // but iptables rules now allow the Evolution Go container to reach WireGuard IPs.
      // Creating WITH proxy means the first connection goes through the proxy from the start.
      console.log(`[ReconnectQueue] Instance ${instanceName} no longer exists, recreating with proxy`)
      const globalProxy = await getGlobalProxy()
      const proxyConfig = resolveChipProxy(chip, globalProxy) || undefined
      const newInstance = await createInstance(instanceName, proxyConfig)
      effectiveInstanceName = newInstance.name || instanceName
    }

    // Connect via router (v3-only)
    const connectResult = await routerConnectInstance(effectiveInstanceName, webhookUrl)

    // 6. Check connection result
    if (connectResult.state === 'open') {
      // Successfully reconnected!
      console.log(`[ReconnectQueue] Chip ${chipName} reconnected successfully!`)
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: 'connected',
          lastSeen: new Date(),
          isQrPaired: true,
          evolutionInstance: effectiveInstanceName,
          qrPairingCode: null,
        },
      })
      await markChipReconnected(chipId)
      return
    }

    // 7. Not connected yet — QR code needed (needs human to scan)
    // Update chip with QR/pairing code and mark as "connecting"
    // The webhook will notify us when it connects
    if (connectResult.code || connectResult.pairingCode) {
      console.log(`[ReconnectQueue] Chip ${chipName} needs QR scan — pairing code: ${connectResult.code || connectResult.pairingCode}`)
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: 'connecting',
          qrPairingCode: connectResult.code || connectResult.pairingCode || null,
          evolutionInstance: effectiveInstanceName,
        },
      })

      // Keep in queue but with long backoff (needs human interaction)
      const newEntry: ReconnectionEntry = {
        ...updatedEntry,
        attemptCount: entry.attemptCount + 1,
        nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000), // Check again in 2 minutes
        status: 'waiting_backoff',
        lastError: 'Waiting for QR scan',
      }
      reconnectionQueue.set(chipId, newEntry)
      currentlyReconnecting.delete(chipId)
      return
    }

    // 8. Connection attempt failed — apply backoff
    throw new Error(`Connect returned state: ${connectResult.state}`)

  } catch (error: any) {
    console.error(`[ReconnectQueue] Reconnection failed for ${chipName}: ${error.message}`)

    consecutiveApiFailures++
    if (consecutiveApiFailures >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreakerOpen = true
      circuitBreakerOpenedAt = new Date()
      console.log('[ReconnectQueue] Circuit breaker OPENED')
    }

    const newAttemptCount = entry.attemptCount + 1

    if (newAttemptCount >= CONFIG.MAX_ATTEMPTS) {
      console.log(`[ReconnectQueue] Chip ${chipName} exceeded max attempts (${CONFIG.MAX_ATTEMPTS}), marking as failed`)
      reconnectionQueue.set(chipId, {
        ...updatedEntry,
        attemptCount: newAttemptCount,
        status: 'failed',
        lastError: error.message,
      })
      currentlyReconnecting.delete(chipId)
      totalFailed++

      // Reset chip status to disconnected
      await db.chip.update({
        where: { id: chipId },
        data: { status: 'disconnected' },
      }).catch(() => {})
      return
    }

    // Queue for retry with backoff
    const nextAttempt = calculateNextAttempt(newAttemptCount, CONFIG)
    console.log(`[ReconnectQueue] Chip ${chipName} will retry at ${nextAttempt.toISOString()} (attempt ${newAttemptCount})`)

    reconnectionQueue.set(chipId, {
      ...updatedEntry,
      attemptCount: newAttemptCount,
      nextAttemptAt: nextAttempt,
      status: 'waiting_backoff',
      lastError: error.message,
    })
    currentlyReconnecting.delete(chipId)

    // Reset chip status to disconnected while waiting for retry
    await db.chip.update({
      where: { id: chipId },
      data: { status: 'disconnected' },
    }).catch(() => {})
  }
}

/**
 * Calculate next reconnection attempt time with exponential backoff + jitter.
 * Backoff: 5s → 15s → 45s → 2min → 5min → 10min (capped)
 */
function calculateNextAttempt(attemptCount: number, config: typeof DEFAULT_CONFIG): Date {
  const backoffIndex = Math.min(attemptCount, config.BACKOFF_MS.length - 1)
  const baseDelay = config.BACKOFF_MS[backoffIndex]
  const jitter = Math.random() * baseDelay * config.JITTER_FACTOR
  const totalDelay = baseDelay + jitter
  const interDelay = attemptCount === 0 ? config.INTER_RECONNECT_DELAY_MS : 0
  return new Date(Date.now() + totalDelay + interDelay)
}

/**
 * Auto-resume campaigns that were paused because a chip disconnected.
 * When a chip reconnects, check if any paused campaigns can now be resumed.
 */
async function autoResumeCampaigns(chipId: string): Promise<void> {
  try {
    // Find campaigns that were auto-paused due to this chip's disconnection
    const pausedCampaigns = await db.campaign.findMany({
      where: {
        status: 'paused',
        statusReason: { contains: 'desconect' }, // matches "Chip desconectou" reason
      },
      include: {
        chips: { include: { chip: true } },
      },
    })

    for (const campaign of pausedCampaigns) {
      // Check if this campaign now has enough connected chips
      const connectedChips = campaign.chips.filter(cc => cc.chip.status === 'connected')
      const hasThisChip = campaign.chips.some(cc => cc.chipId === chipId)

      if (hasThisChip && connectedChips.length > 0) {
        console.log(`[ReconnectQueue] Auto-resuming campaign ${campaign.name} — ${connectedChips.length} chips now connected`)

        await db.campaign.update({
          where: { id: campaign.id },
          data: {
            status: 'running',
            statusReason: null,
          },
        })
      }
    }
  } catch (error: any) {
    console.error(`[ReconnectQueue] Error auto-resuming campaigns: ${error.message}`)
  }
}
