// Warming Engine — Aquecimento de Chips
// ==============================================
// Motor de aquecimento que faz chips "conversarem entre si" para gerar
// histórico positivo nos servidores do WhatsApp antes de irem para operação.
//
// COMO FUNCIONA:
//   1. Seleciona N chips para a sessão de aquecimento
//   2. Os chips trocam mensagens entre si (texto, imagem, áudio)
//   3. Chip A manda para Chip B, que responde para Chip C, etc.
//   4. Tudo com delays gaussianos, presença humanizada, typing realista
//   5. Resultado: chips com histórico de conversas bidirecionais
//
// ESTRATÉGIAS DE CONVERSAÇÃO:
//   - round_robin: A→B, B→C, C→D, D→A (cada um fala com o próximo)
//   - pairs: A↔B, C↔D (diálogos entre pares fixos)
//   - random: pares aleatórios a cada mensagem
//   - group: rotação livre, todos conversam com todos
//
// ANTI-BAN INTEGRADO:
//   - Todos os delays são gaussianos (Box-Muller)
//   - Presença humanizada (available→composing→send→delayed offline)
//   - Janela de envio respeitada (horário comercial)
//   - Break windows (almoço, reunião)
//   - Intervalos mais conservadores que campanhas normais
//   - Typing proporcional ao tamanho da mensagem
//   - Offline com jitter (não sai instantaneamente)
//
// v1.0 — Initial implementation

import { sendTextMessage, sendMediaMessage, setPresence, formatPhoneNumber, getConnectionState } from './evolution-api'
import { db } from './db'
import { toMins, getCurrentMinutes } from './time-utils'
import { NURSERY_SCHEDULE, PREWARM_SCHEDULE, type ScheduleEntry, type AntiBanSettings } from './constants'

// ============================================================
// TYPES
// ============================================================

interface WarmingMessageTemplate {
  type: 'text' | 'image' | 'audio'
  content: string
  variations: string[]
  mediaUrl?: string | null
  caption?: string | null
  weight: number  // peso relativo para distribuição
}

interface WarmingChipProgress {
  sent: number
  received: number
  lastSentAt: string | null
  lastReceivedAt: string | null
}

interface WarmingLastPair {
  lastSenderIdx: number
  lastRecipientIdx: number
}

interface MessageTypeDistribution {
  text: number
  image: number
  audio: number
}

interface WarmingBreakWindow {
  start: number
  end: number
  label: string
}

// ============================================================
// CONSTANTS
// ============================================================

// Intervalos mais conservadores que campanhas normais
// Chips em aquecimento são chips NOVOS — precisam ser tratados com mais cuidado
const WARMING_INTERVAL_MIN = 45   // segundos (campanhas normais: 30)
const WARMING_INTERVAL_MAX = 120  // segundos (campanhas normais: 90)

// Typing speed — same as sending engine
const TYPING_SPEED_MIN = 6
const TYPING_SPEED_MAX = 14
const TYPING_MIN_MS = 3000
const TYPING_MAX_MS = 25000

// Presence constants — same as sending engine
const OFFLINE_DELAY_MIN_MS = 3000
const OFFLINE_DELAY_MAX_MS = 15000

// Mínimo de chips para uma sessão de aquecimento
const MIN_CHIPS_FOR_WARMING = 2

// Máximo de mensagens enviadas por tick do cron (para não estourar timeout)
const MAX_MESSAGES_PER_TICK = 5

// Templates padrão de mensagens para aquecimento
// Estes são usados quando o usuário não configura templates customizados
const DEFAULT_WARMING_TEMPLATES: WarmingMessageTemplate[] = [
  // SAUDAÇÕES (texto)
  { type: 'text', content: '', variations: [
    'Oi, tudo bem?',
    'E aí, como vai?',
    'Fala! Tudo certo?',
    'Opa, bom dia! Tudo bem?',
    'Eii, como que tá?',
    'Oiee! Tudo tranquilo?',
    'Fala mano, tudo certo?',
    'Oi! Como estão as coisas?',
    'E aí, firmeza?',
    'Opa, e aí! Tudo na paz?',
  ], weight: 1.0 },
  // CONVERSA CASUAL (texto)
  { type: 'text', content: '', variations: [
    'Cara, que calor hoje viu',
    'Você viu o jogo ontem?',
    'To precisando de uma indicação boa',
    'Conseguiu resolver aquela parada?',
    'Mano, que dia longo',
    'Acabei de almoçar, tomei um susto com o preço',
    'Passei no mercado, tava lotado',
    'Você acredita que esqueci o celular em casa?',
    'Tô precisando de férias já',
    'Que semana corrida viu',
    'Vi uma notícia absurda agora',
    'O trânsito tava um caos hoje',
    'Fui dormir tarde ontem, to morto',
    'Preciso comprar um presente pro aniversário do Pedro',
    'Achei um restaurante novo,tava bom demais',
  ], weight: 1.5 },
  // RESPOSTAS (texto)
  { type: 'text', content: '', variations: [
    'Haha sério??',
    'Nossa, que legal!',
    'Fala sério!',
    'Ah é mesmo?',
    'Que demais!',
    'Vish, complicado',
    'Ah que bom!',
    'Sério isso??',
    'Não acredito',
    'Manda mais detalhes',
    'Show de bola!',
    'Pior que é mesmo',
    'Concordo totalmente',
    'Hahaha boa!',
  ], weight: 1.2 },
  // CONFIRMAÇÕES / ACORDOS (texto)
  { type: 'text', content: '', variations: [
    'Beleza, combinado!',
    'Fechou!',
    'Top!',
    'Pode contar comigo',
    'Combinado então',
    'Fechou, depois a gente se fala',
    'Bora!',
    'Tranquilo, pode ser',
    'Combinado, te aviso',
    'Beleza, depois te mando',
  ], weight: 0.8 },
  // PERGUNTAS (texto)
  { type: 'text', content: '', variations: [
    'Você sabe se vai chover amanhã?',
    'Qual o horário mesmo?',
    'Onde fica esse lugar?',
    'Quanto custou?',
    'Você vai na reunião?',
    'Já terminou aquele projeto?',
    'Como chegou lá?',
    'Tem como me mandar o endereço?',
  ], weight: 0.8 },
  // IMAGEM com legenda
  { type: 'image', content: '', variations: [], mediaUrl: '', caption: '', weight: 0.5 },
  // ÁUDIO (voice message)
  { type: 'audio', content: '', variations: [], mediaUrl: '', weight: 0.5 },
]

// ============================================================
// GAUSSIAN UTILITIES (same as sending-engine.ts)
// ============================================================

function gaussianRandom(mean: number, stddev: number, min: number, max: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2)
  const value = mean + z0 * stddev
  return Math.max(min, Math.min(max, Math.round(value)))
}

function gaussianRandomFloat(mean: number, stddev: number, min: number, max: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2)
  const value = mean + z0 * stddev
  return Math.max(min, Math.min(max, value))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Calculate realistic typing duration based on message length
 */
function calculateTypingDuration(text: string): number {
  const charCount = text.length
  const typingSpeed = gaussianRandomFloat(10, 2.5, TYPING_SPEED_MIN, TYPING_SPEED_MAX)
  let durationMs = (charCount / typingSpeed) * 1000
  durationMs = Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, durationMs))
  if (Math.random() < 0.3) {
    durationMs += randomInt(1000, 4000)
  }
  return Math.round(durationMs)
}

/**
 * Check if current time is within the sending window
 */
function isWithinSendingWindow(
  activeHoursStart: number,
  activeHoursEnd: number,
  timezone: string
): boolean {
  const currentMins = getCurrentMinutes(timezone)
  const start = toMins(activeHoursStart)
  const end = toMins(activeHoursEnd)

  if (start <= end) {
    return currentMins >= start && currentMins < end
  } else {
    return currentMins >= start || currentMins < end
  }
}

/**
 * Check if current time is within any break window
 */
function getActiveBreakWindow(
  breakWindows: WarmingBreakWindow[],
  timezone: string
): WarmingBreakWindow | null {
  const currentMins = getCurrentMinutes(timezone)
  for (const bw of breakWindows) {
    const bwStart = toMins(bw.start)
    const bwEnd = toMins(bw.end)
    if (currentMins >= bwStart && currentMins < bwEnd) {
      return bw
    }
  }
  return null
}

/**
 * Parse JSON field from WarmingSession, with fallback
 */
function parseJsonField<T>(jsonStr: string | null | undefined, fallback: T): T {
  if (!jsonStr) return fallback
  try {
    return JSON.parse(jsonStr)
  } catch {
    return fallback
  }
}

/**
 * Pick a random variation from a template, with consecutive dedup
 */
const lastUsedVariation = new Map<string, number>()

function pickVariation(variations: string[], cacheKey: string): string {
  if (variations.length === 0) return ''
  if (variations.length === 1) return variations[0]

  const lastIdx = lastUsedVariation.get(cacheKey)
  let chosenIdx: number

  if (lastIdx !== undefined) {
    const available = variations.map((_, i) => i).filter(i => i !== lastIdx)
    chosenIdx = available[Math.floor(Math.random() * available.length)]
  } else {
    chosenIdx = Math.floor(Math.random() * variations.length)
  }

  lastUsedVariation.set(cacheKey, chosenIdx)
  return variations[chosenIdx]
}

/**
 * Pick a message type based on the configured distribution.
 * Uses weighted random selection.
 */
function pickMessageType(distribution: MessageTypeDistribution): 'text' | 'image' | 'audio' {
  const total = distribution.text + distribution.image + distribution.audio
  if (total === 0) return 'text'

  const roll = Math.random() * total
  if (roll < distribution.text) return 'text'
  if (roll < distribution.text + distribution.image) return 'image'
  return 'audio'
}

/**
 * Select sender and recipient chips based on the strategy.
 * Returns [senderIdx, recipientIdx] indices into the chipIds array.
 */
function selectPair(
  strategy: string,
  chipIds: string[],
  lastPair: WarmingLastPair,
  chipProgress: Record<string, WarmingChipProgress>
): [number, number] {
  const n = chipIds.length
  if (n < 2) throw new Error('Precisa de pelo menos 2 chips para aquecimento')

  switch (strategy) {
    case 'pairs': {
      // Pair chips: (0,1), (2,3), (4,5), etc.
      // Alternate who sends in each pair
      const pairIdx = lastPair.lastSenderIdx < n ? Math.floor(lastPair.lastSenderIdx / 2) : 0
      const base = (pairIdx * 2) % n
      const nextPair = ((pairIdx + 1) * 2) % n

      // Alternate sender/recipient in the pair
      if (lastPair.lastSenderIdx === base) {
        return [base + 1, base]
      }
      // Move to next pair
      return [nextPair, nextPair + 1 < n ? nextPair + 1 : 0]
    }

    case 'round_robin': {
      // Each chip sends to the next one: A→B, B→C, C→D, D→A
      let senderIdx = (lastPair.lastSenderIdx + 1) % n
      let recipientIdx = (senderIdx + 1) % n

      // Skip chips that already hit their target
      const maxAttempts = n
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const senderId = chipIds[senderIdx]
        const senderProgress = chipProgress[senderId]
        if (!senderProgress || senderProgress.sent < (senderProgress.received + 20)) {
          // Sender hasn't sent too many more than received — good to go
          break
        }
        senderIdx = (senderIdx + 1) % n
        recipientIdx = (recipientIdx + 1) % n
      }

      return [senderIdx, recipientIdx]
    }

    case 'random': {
      let senderIdx = randomInt(0, n - 1)
      let recipientIdx = randomInt(0, n - 2)
      if (recipientIdx >= senderIdx) recipientIdx++
      return [senderIdx, recipientIdx]
    }

    case 'group': {
      // Free rotation — prefer chips with fewer sent messages
      const sortedBySent = chipIds
        .map((id, idx) => ({ id, idx, sent: chipProgress[id]?.sent || 0 }))
        .sort((a, b) => a.sent - b.sent)

      // Pick the chip with fewest sent as sender
      const sender = sortedBySent[0]

      // Pick a recipient that's NOT the sender (prefer different recipient from last time)
      const candidates = sortedBySent.filter(c => c.idx !== sender.idx)
      const recipient = candidates[Math.floor(Math.random() * candidates.length)]

      return [sender.idx, recipient.idx]
    }

    default:
      // Fallback to round_robin
      return selectPair('round_robin', chipIds, lastPair, chipProgress)
  }
}

// ============================================================
// PRESENCE HUMANIZATION (reused from sending-engine patterns)
// ============================================================

/**
 * Delayed offline with jitter — human doesn't go offline instantly after sending
 */
async function delayedOfflineWithJitter(instanceName: string, jid: string): Promise<number> {
  const delayMs = gaussianRandom(
    (OFFLINE_DELAY_MIN_MS + OFFLINE_DELAY_MAX_MS) / 2,
    (OFFLINE_DELAY_MAX_MS - OFFLINE_DELAY_MIN_MS) / 6,
    OFFLINE_DELAY_MIN_MS,
    OFFLINE_DELAY_MAX_MS
  )

  await new Promise(resolve => setTimeout(resolve, delayMs))

  try {
    await setPresence(instanceName, jid, 'unavailable', 0)
  } catch {
    // Non-fatal
  }

  return delayMs
}

/**
 * Full anti-ban presence simulation for a warming message.
 * This mirrors the sending-engine's presence flow:
 *   available → (delay) → composing/recording → (typing time) → send → (delayed offline)
 */
async function performWarmingPresence(
  instanceName: string,
  jid: string,
  messageType: 'text' | 'image' | 'audio',
  content: string
): Promise<number> {
  let totalPresenceMs = 0

  // 1. Signal "available" before composing
  try {
    await setPresence(instanceName, jid, 'available', 1000)
  } catch { /* non-fatal */ }
  const availableDelay = gaussianRandom(1500, 500, 800, 3000)
  await new Promise(resolve => setTimeout(resolve, availableDelay))
  totalPresenceMs += availableDelay

  // 2. Composing/Recording presence
  if (messageType === 'audio') {
    // Audio: "recording" presence
    const recordingMs = gaussianRandom(4000, 1500, 2000, 10000)
    try {
      await setPresence(instanceName, jid, 'recording', recordingMs)
    } catch { /* non-fatal */ }
    await new Promise(resolve => setTimeout(resolve, recordingMs))
    totalPresenceMs += recordingMs
  } else if (messageType === 'image') {
    // Image: brief "recording" (camera icon)
    const captureMs = randomInt(2000, 4000)
    try {
      await setPresence(instanceName, jid, 'recording', captureMs)
    } catch { /* non-fatal */ }
    await new Promise(resolve => setTimeout(resolve, captureMs))
    totalPresenceMs += captureMs
  } else {
    // Text: "composing" with optional mid-composition pauses
    const totalTypingMs = calculateTypingDuration(content)

    const shouldPause = content.length > 80 && Math.random() < 0.35

    if (shouldPause && totalTypingMs > 6000) {
      const segments = Math.random() < 0.3 ? 3 : 2
      const perSegment = Math.floor(totalTypingMs / segments)

      for (let seg = 0; seg < segments; seg++) {
        try {
          await setPresence(instanceName, jid, 'composing', perSegment)
        } catch { /* non-fatal */ }
        await new Promise(resolve => setTimeout(resolve, perSegment))
        totalPresenceMs += perSegment

        if (seg < segments - 1) {
          const pauseMs = gaussianRandom(2000, 800, 800, 5000)
          try {
            await setPresence(instanceName, jid, 'unavailable', pauseMs)
          } catch { /* non-fatal */ }
          await new Promise(resolve => setTimeout(resolve, pauseMs))
          totalPresenceMs += pauseMs
        }
      }
    } else {
      try {
        await setPresence(instanceName, jid, 'composing', totalTypingMs)
      } catch { /* non-fatal */ }
      await new Promise(resolve => setTimeout(resolve, totalTypingMs))
      totalPresenceMs += totalTypingMs
    }
  }

  return totalPresenceMs
}

// ============================================================
// CHIP PHASE LIMITS — Anti-Ban Integration
// ============================================================

/**
 * Get the effective daily limit for a chip based on its warming phase.
 * This mirrors the sending-engine's getEffectiveDailyLimit logic
 * so that the warming engine respects the same anti-ban rules.
 *
 * Chips in nursery (berçário): 10-80 msgs/day depending on day
 * Chips in prewarm: 11-200 msgs/day depending on day
 * Chips ready (aquecido): full daily limit (200 by default)
 */
async function getChipEffectiveDailyLimit(
  chip: { warmingPhase: string | null; warmingEnabled: boolean; dailyLimit: number; warmingStartedAt: string | Date | null; createdAt: string | Date; sentToday: number },
  antiBanSettings: AntiBanSettings | null
): Promise<{ limit: number; phase: string; dayInPhase: number; remaining: number }> {
  const defaultLimit = chip.dailyLimit || 200
  const phase = chip.warmingPhase || 'nursery'

  // If anti-ban warming is disabled or chip warming is disabled, use chip's dailyLimit
  if (!antiBanSettings?.warmingEnabled || !chip.warmingEnabled) {
    return { limit: defaultLimit, phase, dayInPhase: 0, remaining: Math.max(0, defaultLimit - chip.sentToday) }
  }

  if (phase === 'ready') {
    const limit = antiBanSettings.readyDailyLimit || defaultLimit
    return { limit, phase, dayInPhase: 0, remaining: Math.max(0, limit - chip.sentToday) }
  }

  // Calculate day within phase (using Brasília timezone)
  const now = new Date()
  let dayInPhase = 1
  const warmingStart = chip.warmingStartedAt
    ? new Date(chip.warmingStartedAt)
    : chip.createdAt
      ? new Date(chip.createdAt)
      : null

  if (warmingStart) {
    const spFormatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      timeZone: 'America/Sao_Paulo',
    })
    const nowStr = spFormatter.format(now)
    const startStr = spFormatter.format(warmingStart)
    const [nm, nd, ny] = nowStr.split('/').map(Number)
    const [sm, sd, sy] = startStr.split('/').map(Number)
    const nowDate = new Date(ny, nm - 1, nd)
    const startDate = new Date(sy, sm - 1, sd)
    dayInPhase = Math.max(1, Math.floor((nowDate.getTime() - startDate.getTime()) / 86400000) + 1)
  }

  // Parse schedule for the phase
  let schedule: ScheduleEntry[] = []
  try {
    if (phase === 'nursery') {
      schedule = JSON.parse(antiBanSettings.nurserySchedule || '[]')
      if (schedule.length === 0) schedule = NURSERY_SCHEDULE
    } else if (phase === 'prewarm') {
      schedule = JSON.parse(antiBanSettings.prewarmSchedule || '[]')
      if (schedule.length === 0) schedule = PREWARM_SCHEDULE
    }
  } catch { /* fallback to defaults */ }

  if (schedule.length === 0) {
    if (phase === 'nursery') schedule = NURSERY_SCHEDULE
    else if (phase === 'prewarm') schedule = PREWARM_SCHEDULE
  }

  // Find limit for current day
  let limit = 10
  for (const entry of schedule) {
    if (dayInPhase >= entry.days[0] && dayInPhase <= entry.days[1]) {
      limit = entry.limit
      break
    }
  }
  // If beyond schedule, use last entry's limit
  if (schedule.length > 0 && dayInPhase > schedule[schedule.length - 1].days[1]) {
    limit = schedule[schedule.length - 1].limit
  }

  // Cap at chip's dailyLimit
  limit = Math.min(limit, chip.dailyLimit || antiBanSettings.dailyLimitPerChip)

  const remaining = Math.max(0, limit - chip.sentToday)
  return { limit, phase, dayInPhase, remaining }
}

/**
 * Load anti-ban settings from DB (cached per invocation)
 */
async function loadAntiBanSettings(): Promise<AntiBanSettings | null> {
  try {
    const settings = await db.antiBanSettings.findFirst()
    return settings as unknown as AntiBanSettings | null
  } catch {
    return null
  }
}

/**
 * Check if ALL chips in a session have hit their daily phase limits.
 * Used to decide whether to pause the session for the rest of the day.
 */
async function checkAllChipsAtDailyLimit(
  chipIds: string[],
  antiBanSettings: AntiBanSettings | null
): Promise<boolean> {
  const chips = await db.chip.findMany({
    where: { id: { in: chipIds } },
    select: {
      id: true,
      warmingPhase: true,
      warmingEnabled: true,
      dailyLimit: true,
      warmingStartedAt: true,
      createdAt: true,
      sentToday: true,
    },
  })

  for (const chip of chips) {
    const limitInfo = await getChipEffectiveDailyLimit(chip, antiBanSettings)
    if (limitInfo.remaining > 0) {
      return false // At least one chip can still send
    }
  }

  return true // All chips are at their daily limit
}

// ============================================================
// CORE WARMING ENGINE
// ============================================================

/**
 * Get a warming session by ID with full data loaded
 */
export async function getWarmingSession(sessionId: string) {
  return db.warmingSession.findUnique({ where: { id: sessionId } })
}

/**
 * Get all running warming sessions
 */
export async function getRunningWarmingSessions(): Promise<string[]> {
  const sessions = await db.warmingSession.findMany({
    where: { status: 'running' },
    select: { id: true },
  })
  return sessions.map(s => s.id)
}

/**
 * Start a warming session — validates chips and transitions to 'running'
 */
export async function startWarmingSession(sessionId: string): Promise<void> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Sessão de aquecimento não encontrada')

  if (session.status !== 'draft' && session.status !== 'paused') {
    throw new Error(`Sessão não pode ser iniciada no status "${session.status}"`)
  }

  const chipIds: string[] = parseJsonField(session.chipIds, [])
  if (chipIds.length < MIN_CHIPS_FOR_WARMING) {
    throw new Error(`Precisa de pelo menos ${MIN_CHIPS_FOR_WARMING} chips para aquecimento`)
  }

  // Validate that all chips exist and are connected
  const chips = await db.chip.findMany({
    where: { id: { in: chipIds } },
  })

  const connectedChips = chips.filter(c => c.status === 'connected' && c.evolutionInstance)
  if (connectedChips.length < MIN_CHIPS_FOR_WARMING) {
    throw new Error(`Apenas ${connectedChips.length} chips estão conectados. Mínimo: ${MIN_CHIPS_FOR_WARMING}`)
  }

  // Update chipIds to only include connected chips
  const validChipIds = connectedChips.map(c => c.id)

  // Initialize progress for each chip
  const existingProgress: Record<string, WarmingChipProgress> = parseJsonField(session.chipProgress, {})
  const chipProgress: Record<string, WarmingChipProgress> = {}
  for (const chipId of validChipIds) {
    chipProgress[chipId] = existingProgress[chipId] || { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }
  }

  await db.warmingSession.update({
    where: { id: sessionId },
    data: {
      status: 'running',
      chipIds: JSON.stringify(validChipIds),
      chipProgress: JSON.stringify(chipProgress),
      startedAt: session.startedAt || new Date(),
      pausedAt: null,
    },
  })

  console.log(`[WarmingEngine] Session "${session.name}" started with ${validChipIds.length} chips`)
}

/**
 * Pause a warming session
 */
export async function pauseWarmingSession(sessionId: string): Promise<void> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Sessão de aquecimento não encontrada')
  if (session.status !== 'running') throw new Error('Sessão não está rodando')

  await db.warmingSession.update({
    where: { id: sessionId },
    data: { status: 'paused', pausedAt: new Date() },
  })

  console.log(`[WarmingEngine] Session "${session.name}" paused`)
}

/**
 * Resume a paused warming session
 */
export async function resumeWarmingSession(sessionId: string): Promise<void> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Sessão de aquecimento não encontrada')
  if (session.status !== 'paused') throw new Error('Sessão não está pausada')

  await db.warmingSession.update({
    where: { id: sessionId },
    data: { status: 'running', pausedAt: null },
  })

  console.log(`[WarmingEngine] Session "${session.name}" resumed`)
}

/**
 * Cancel a warming session
 */
export async function cancelWarmingSession(sessionId: string): Promise<void> {
  await db.warmingSession.update({
    where: { id: sessionId },
    data: { status: 'cancelled' },
  })
}

/**
 * Process the next warming message for a session.
 * Called by the cron tick (process-all) for each running session.
 *
 * Returns:
 *   processed: true if a message was sent
 *   delayMs: how long to wait before the next message
 *   completed: true if the session is done
 */
export async function processNextWarmingMessage(
  sessionId: string
): Promise<{ processed: boolean; delayMs: number; completed: boolean; reason?: string }> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session || session.status !== 'running') {
    return { processed: false, delayMs: 5000, completed: false, reason: 'session_not_running' }
  }

  // Parse session config
  const chipIds: string[] = parseJsonField(session.chipIds, [])
  const chipProgress: Record<string, WarmingChipProgress> = parseJsonField(session.chipProgress, {})
  const lastPair: WarmingLastPair = parseJsonField(session.lastPair, { lastSenderIdx: -1, lastRecipientIdx: -1 })
  const templates: WarmingMessageTemplate[] = parseJsonField(session.messageTemplates, DEFAULT_WARMING_TEMPLATES)
  const distribution: MessageTypeDistribution = parseJsonField(session.messageTypeDistribution, { text: 47, image: 27, audio: 26 })
  const breakWindows: WarmingBreakWindow[] = parseJsonField(session.breakWindows, [])

  // Check if we have enough chips
  if (chipIds.length < MIN_CHIPS_FOR_WARMING) {
    await db.warmingSession.update({
      where: { id: sessionId },
      data: { status: 'cancelled', lastError: 'Chips insuficientes' },
    })
    return { processed: false, delayMs: 0, completed: true, reason: 'insufficient_chips' }
  }

  // Check sending window
  if (!isWithinSendingWindow(session.activeHoursStart, session.activeHoursEnd, session.timezone)) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'outside_sending_window' }
  }

  // Check break windows
  const activeBreak = getActiveBreakWindow(breakWindows, session.timezone)
  if (activeBreak) {
    return {
      processed: false,
      delayMs: 60000,
      completed: false,
      reason: `break_window_${activeBreak.label}`,
    }
  }

  // Check if all chips have reached their target
  const allDone = chipIds.every(chipId => {
    const p = chipProgress[chipId]
    if (!p) return false
    return (p.sent + p.received) >= session.messagesPerChip
  })

  if (allDone) {
    await db.warmingSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    })
    console.log(`[WarmingEngine] Session "${session.name}" completed! All chips reached target.`)
    return { processed: false, delayMs: 0, completed: true, reason: 'all_chips_warmed' }
  }

  // Select sender and recipient
  const [senderIdx, recipientIdx] = selectPair(session.strategy, chipIds, lastPair, chipProgress)
  const senderChipId = chipIds[senderIdx]
  const recipientChipId = chipIds[recipientIdx]

  // Check if sender has reached target
  const senderProgress = chipProgress[senderChipId] || { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }
  if (senderProgress.sent >= session.messagesPerChip / 2) {
    // This chip has sent enough — try another sender
    // For now, just skip this tick
    return { processed: false, delayMs: 3000, completed: false, reason: 'sender_target_reached' }
  }

  // Load chips from DB
  const [senderChip, recipientChip] = await Promise.all([
    db.chip.findUnique({ where: { id: senderChipId } }),
    db.chip.findUnique({ where: { id: recipientChipId } }),
  ])

  if (!senderChip?.evolutionInstance || senderChip.status !== 'connected') {
    // Sender is not connected — update progress and try next tick
    await db.warmingSession.update({
      where: { id: sessionId },
      data: { lastError: `Chip remetente ${senderChip?.name || senderChipId} desconectado` },
    })
    return { processed: false, delayMs: 5000, completed: false, reason: 'sender_disconnected' }
  }

  // ============================================================
  // ANTI-BAN: Respect chip's warming phase daily limit
  // Chips in berçário (nursery) have much lower daily limits!
  // A chip on Day 1-2 in nursery can only send 10 msgs/day.
  // This is CRITICAL — sending 150 msgs to a Day 1 chip = instant ban.
  // ============================================================
  const antiBanSettings = await loadAntiBanSettings()
  const senderLimitInfo = await getChipEffectiveDailyLimit(senderChip, antiBanSettings)

  if (senderLimitInfo.remaining <= 0) {
    // Sender hit its daily limit for its phase — skip this tick
    // Check if ALL chips have hit their limits (session should pause for today)
    const allChipsAtLimit = await checkAllChipsAtDailyLimit(chipIds, antiBanSettings)
    if (allChipsAtLimit) {
      console.log(`[WarmingEngine] All chips hit their daily phase limits. Pausing session "${session.name}" until tomorrow.`)
      await db.warmingSession.update({
        where: { id: sessionId },
        data: { lastError: `Todos os chips atingiram o limite diário da fase. Retoma amanhã automaticamente.` },
      })
      return { processed: false, delayMs: 60000, completed: false, reason: 'all_chips_daily_limit_reached' }
    }

    return {
      processed: false,
      delayMs: 30000,
      completed: false,
      reason: `sender_daily_limit_${senderChip.name}_phase_${senderLimitInfo.phase}_day${senderLimitInfo.dayInPhase}`,
    }
  }

  if (!recipientChip?.phoneNumber) {
    return { processed: false, delayMs: 3000, completed: false, reason: 'recipient_no_phone' }
  }

  // Check minimum interval for this sender
  if (senderProgress.lastSentAt) {
    const lastSentTime = new Date(senderProgress.lastSentAt).getTime()
    const elapsed = (Date.now() - lastSentTime) / 1000
    const minInterval = session.intervalMin || WARMING_INTERVAL_MIN

    if (elapsed < minInterval) {
      const waitSeconds = Math.ceil(minInterval - elapsed)
      return {
        processed: false,
        delayMs: waitSeconds * 1000,
        completed: false,
        reason: `min_interval_sender_${senderChip.name}`,
      }
    }
  }

  // Pick message type and content
  const messageType = pickMessageType(distribution)
  const messageContent = generateWarmingMessage(templates, messageType, senderChip.name || '', recipientChip.name || '')

  // ============================================================
  // SEND THE MESSAGE WITH FULL ANTI-BAN PRESENCE
  // ============================================================
  const instanceName = senderChip.evolutionInstance
  const formattedPhone = formatPhoneNumber(recipientChip.phoneNumber)
  const jid = `${formattedPhone}@s.whatsapp.net`

  try {
    // Perform presence simulation
    await performWarmingPresence(instanceName, jid, messageType, messageContent.content)

    // Send the message
    if (messageType === 'image' && messageContent.mediaUrl) {
      await sendMediaMessage(instanceName, formattedPhone, messageContent.mediaUrl, 'image', {
        caption: messageContent.caption || messageContent.content || '',
        delay: 0,
      })
    } else if (messageType === 'audio' && messageContent.mediaUrl) {
      await sendMediaMessage(instanceName, formattedPhone, messageContent.mediaUrl, 'audio', {
        caption: '',
        delay: 0,
      })
    } else {
      await sendTextMessage(instanceName, formattedPhone, messageContent.content, {
        delay: 0,
        linkPreview: false,
      })
    }

    // Delayed offline with jitter
    const offlineDelayMs = await delayedOfflineWithJitter(instanceName, jid)

    // Update progress
    senderProgress.sent++
    senderProgress.lastSentAt = new Date().toISOString()

    const recipientProgress = chipProgress[recipientChipId] || { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }
    recipientProgress.received++
    recipientProgress.lastReceivedAt = new Date().toISOString()

    chipProgress[senderChipId] = senderProgress
    chipProgress[recipientChipId] = recipientProgress

    await db.warmingSession.update({
      where: { id: sessionId },
      data: {
        messagesSent: { increment: 1 },
        lastMessageAt: new Date(),
        chipProgress: JSON.stringify(chipProgress),
        lastPair: JSON.stringify({ lastSenderIdx: senderIdx, lastRecipientIdx: recipientIdx }),
        lastError: null,
      },
    })

    console.debug(`[WarmingEngine] ${senderChip.name} → ${recipientChip.name}: [${messageType}] "${messageContent.content.substring(0, 50)}..." (sent: ${senderProgress.sent}, received: ${recipientProgress.received})`)

    // Calculate next delay (gaussian)
    const intervalMin = session.intervalMin || WARMING_INTERVAL_MIN
    const intervalMax = session.intervalMax || WARMING_INTERVAL_MAX
    const nextDelay = gaussianRandom(
      (intervalMin + intervalMax) / 2,
      (intervalMax - intervalMin) / 6,
      intervalMin,
      intervalMax
    )

    return {
      processed: true,
      delayMs: nextDelay * 1000 - offlineDelayMs, // Subtract time already spent
      completed: false,
    }

  } catch (error: any) {
    console.error(`[WarmingEngine] Error sending message: ${error.message}`)

    await db.warmingSession.update({
      where: { id: sessionId },
      data: {
        errorCount: { increment: 1 },
        messagesFailed: { increment: 1 },
        lastError: error.message?.substring(0, 500),
      },
    })

    // If too many errors, pause the session
    if (session.errorCount >= 10) {
      await db.warmingSession.update({
        where: { id: sessionId },
        data: {
          status: 'paused',
          lastError: `Pausado automaticamente após ${session.errorCount + 1} erros: ${error.message?.substring(0, 200)}`,
        },
      })
      return { processed: false, delayMs: 0, completed: false, reason: 'auto_paused_errors' }
    }

    return {
      processed: false,
      delayMs: gaussianRandom(30, 10, 15, 60) * 1000,
      completed: false,
      reason: 'send_error',
    }
  }
}

/**
 * Generate warming message content from templates.
 * Picks a random variation from a matching template.
 */
function generateWarmingMessage(
  templates: WarmingMessageTemplate[],
  messageType: 'text' | 'image' | 'audio',
  senderName: string,
  recipientName: string
): { content: string; mediaUrl?: string; caption?: string } {
  // Filter templates by type
  const matchingTemplates = templates.filter(t => t.type === messageType)

  if (matchingTemplates.length === 0) {
    // Fallback: use a generic message
    if (messageType === 'text') {
      return { content: 'Oi, tudo bem?' }
    }
    return { content: '', mediaUrl: '', caption: '' }
  }

  // Weighted random selection of template
  const totalWeight = matchingTemplates.reduce((sum, t) => sum + t.weight, 0)
  let roll = Math.random() * totalWeight

  let selectedTemplate = matchingTemplates[0]
  for (const t of matchingTemplates) {
    roll -= t.weight
    if (roll <= 0) {
      selectedTemplate = t
      break
    }
  }

  // Pick a variation
  let content = ''
  if (selectedTemplate.variations.length > 0) {
    const cacheKey = `${messageType}_${selectedTemplate.content.substring(0, 30)}`
    content = pickVariation(selectedTemplate.variations, cacheKey)
  } else {
    content = selectedTemplate.content
  }

  // Resolve {{nome}} placeholders
  content = content
    .replace(/\{\{nome\}\}/g, recipientName || 'amigo')
    .replace(/\{\{remetente\}\}/g, senderName || 'eu')

  return {
    content,
    mediaUrl: selectedTemplate.mediaUrl || undefined,
    caption: selectedTemplate.caption || undefined,
  }
}

/**
 * Process all running warming sessions.
 * Called by the cron tick (process-all) every minute.
 *
 * For each running session, attempts to send up to MAX_MESSAGES_PER_TICK messages.
 * Respects the 25-second timeout of the cron function.
 */
export async function processAllWarmingSessions(): Promise<{
  sessions: number
  messagesSent: number
  errors: number
}> {
  const sessionIds = await getRunningWarmingSessions()

  if (sessionIds.length === 0) {
    return { sessions: 0, messagesSent: 0, errors: 0 }
  }

  let totalSent = 0
  let totalErrors = 0

  for (const sessionId of sessionIds) {
    for (let attempt = 0; attempt < MAX_MESSAGES_PER_TICK; attempt++) {
      try {
        const result = await processNextWarmingMessage(sessionId)

        if (result.processed) {
          totalSent++
        } else if (result.completed) {
          break // Session is done
        }

        // Wait the delay between messages (within tick budget)
        if (result.delayMs > 0) {
          const waitMs = Math.min(result.delayMs, 4000) // Cap at 4s within tick
          await new Promise(resolve => setTimeout(resolve, waitMs))
        }

        // Stop if hard-blocked reason
        if (['outside_sending_window', 'all_chips_warmed', 'auto_paused_errors'].some(r => result.reason?.includes(r))) {
          break
        }

      } catch (error: any) {
        console.error(`[WarmingEngine] Error processing session ${sessionId}:`, error.message)
        totalErrors++
        break
      }
    }
  }

  return { sessions: sessionIds.length, messagesSent: totalSent, errors: totalErrors }
}

/**
 * Get warming statistics for a session
 */
export async function getWarmingStats(sessionId: string) {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session) return null

  const chipIds: string[] = parseJsonField(session.chipIds, [])
  const chipProgress: Record<string, WarmingChipProgress> = parseJsonField(session.chipProgress, {})

  // Load chip details
  const chips = await db.chip.findMany({
    where: { id: { in: chipIds } },
    select: { id: true, name: true, phoneNumber: true, status: true, warmingPhase: true },
  })

  const chipStats = chipIds.map(chipId => {
    const chip = chips.find(c => c.id === chipId)
    const progress = chipProgress[chipId] || { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }
    const total = progress.sent + progress.received
    const target = session.messagesPerChip
    const percentage = target > 0 ? Math.round((total / target) * 100) : 0

    return {
      id: chipId,
      name: chip?.name || 'Unknown',
      phone: chip?.phoneNumber || '',
      status: chip?.status || 'unknown',
      warmingPhase: chip?.warmingPhase || 'nursery',
      sent: progress.sent,
      received: progress.received,
      total,
      target,
      percentage,
    }
  })

  return {
    id: session.id,
    name: session.name,
    status: session.status,
    strategy: session.strategy,
    messagesSent: session.messagesSent,
    messagesFailed: session.messagesFailed,
    messagesPerChip: session.messagesPerChip,
    totalTarget: session.messagesPerChip * chipIds.length,
    overallProgress: session.messagesSent,
    errorCount: session.errorCount,
    lastError: session.lastError,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    lastMessageAt: session.lastMessageAt,
    chipStats,
  }
}

/**
 * Auto-start scheduled warming sessions whose scheduledAt has passed
 */
export async function autoStartScheduledSessions(): Promise<string[]> {
  const now = new Date()
  const scheduled = await db.warmingSession.findMany({
    where: {
      status: 'draft',
      scheduledAt: { lte: now },
    },
  })

  const started: string[] = []
  for (const session of scheduled) {
    try {
      await startWarmingSession(session.id)
      started.push(session.id)
    } catch (error: any) {
      console.error(`[WarmingEngine] Failed to auto-start session ${session.name}:`, error.message)
    }
  }

  return started
}

// Export DEFAULT_WARMING_TEMPLATES for use in the UI
export { DEFAULT_WARMING_TEMPLATES }
export type { WarmingMessageTemplate, WarmingChipProgress, MessageTypeDistribution, WarmingBreakWindow }
