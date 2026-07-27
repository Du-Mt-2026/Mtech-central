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
import { NURSERY_SCHEDULE, PREWARM_SCHEDULE, DEFAULT_HUMAN_BEHAVIOR, FIELD_DEFAULTS, type ScheduleEntry, type AntiBanSettings, type HumanBehaviorConfig, type TypingSimulationConfig, type PresenceConfig } from './constants'

// ============================================================
// AI BOT STRATEGY CONSTANTS (estratégia "ai_bot")
// ============================================================
// Default Duda phone (Brazil, no 55 prefix — Evolution formatPhoneNumber adds it).
const DEFAULT_AI_BOT_PHONE = '4899670797'
// Default 5-minute timeout for Duda's reply before counting as missed.
const DEFAULT_AI_BOT_REPLY_TIMEOUT_SEC = 300
// After 2 consecutive missed replies, the chip's day ends.
const DEFAULT_AI_BOT_MAX_MISSED_REPLIES = 2
// When Duda replies, wait a random human delay in this range before sending next message.
const AI_BOT_REPLY_DELAY_MIN_SEC = 30
const AI_BOT_REPLY_DELAY_MAX_SEC = 120
// All 8 categories — kept in sync with seed-warming-message-pool.ts
const AI_BOT_CATEGORIES = [
  'saudacao',
  'emoji_unico',
  'emoji_combo',
  'pergunta_geral',
  'declaracao_casual',
  'produto_mtech',
  'info_pedido',
  'conversa_fiada',
] as const

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
  // --- ai_bot strategy fields (only used when session.strategy === 'ai_bot') ---
  // Consecutive missed replies (Duda didn't answer within aiBotReplyTimeoutSec).
  // Reset to 0 whenever Duda replies. When reaches aiBotMaxMissedReplies,
  // the chip's conversation for the day is paused.
  aiBotMissedCount?: number
  // Last pool category used by this chip — avoids repeating back-to-back.
  aiBotLastCategory?: string | null
  // ISO timestamp of when the chip last sent a message and is now waiting
  // for Duda's reply. null when not waiting (idle, already answered, etc.).
  aiBotWaitingReplySince?: string | null
  // ISO timestamp of Duda's last reply to this chip. Used to compute next
  // send time (we don't fire next message immediately — we wait a human delay).
  aiBotLastReplyAt?: string | null
  // ISO date (YYYY-MM-DD) of the chip's last conversation day. When the
  // chip hits aiBotMaxMissedReplies, this is set to today. The engine skips
  // sending to this chip until the date changes (next day).
  aiBotConversationDayEndedAt?: string | null
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

// FALLBACK intervals — only used when AntiBanSettings is not available.
// The UI/DB is the source of truth. These exist as safety defaults.
// Chips em aquecimento são chips NOVOS — precisam ser tratados com mais cuidado
const WARMING_INTERVAL_MIN = 45   // segundos (fallback)
const WARMING_INTERVAL_MAX = 120  // segundos (fallback)

// FALLBACK typing/presence constants — only used when humanBehaviorConfig is unavailable.
// The UI/DB is the source of truth. These exist as safety defaults.
const TYPING_SPEED_MIN = 6
const TYPING_SPEED_MAX = 14
const TYPING_MIN_MS = 3000
const TYPING_MAX_MS = 25000

const OFFLINE_DELAY_MIN_MS = 3000
const OFFLINE_DELAY_MAX_MS = 15000

// Mínimo de chips para uma sessão de aquecimento
// IMPORTANTE: Mínimo de 3 chips para evitar detecção pelo Meta.
// Apenas 2 chips trocando todas as msgs entre si cria um padrão de grafo social
// artificial (2 números que SÓ falam entre si = bot network detectável).
// Com 3+ chips, cada chip conversa com múltiplos contatos = comportamento natural.
const MIN_CHIPS_FOR_WARMING = 3
const MIN_CHIPS_FOR_AI_BOT = 1

/**
 * Returns the minimum number of chips required for a given warming strategy.
 * - round_robin / random / group / pairs: 3 (grafo social natural — Meta detection)
 * - ai_bot: 1 (chips → Duda, sem grafo inter-chip)
 */
function minChipsFor(strategy: string | null | undefined): number {
  return strategy === 'ai_bot' ? MIN_CHIPS_FOR_AI_BOT : MIN_CHIPS_FOR_WARMING
}

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
 * Get typing config from AntiBanSettings (UI) with fallback to constants.
 * Mirrors sending-engine's getTypingConfig() — ensures UI is the source of truth.
 */
function getWarmingTypingConfig(antiBanSettings: AntiBanSettings | null) {
  const ts = parseHumanBehaviorConfig(antiBanSettings).typingSimulation
  return {
    speedMin: ts?.speedMin ?? TYPING_SPEED_MIN,
    speedMax: ts?.speedMax ?? TYPING_SPEED_MAX,
    pauseChance: (ts?.pauseChance ?? 30) / 100,
    pauseMinMs: ts?.pauseMinMs ?? 1000,
    pauseMaxMs: ts?.pauseMaxMs ?? 4000,
    longMsgPauseChance: (ts?.longMsgPauseChance ?? 40) / 100,
    longMsgThreshold: ts?.longMsgThreshold ?? 100,
  }
}

/**
 * Get presence config from AntiBanSettings (UI) with fallback to constants.
 * Mirrors sending-engine's getPresenceConfig() — ensures UI is the source of truth.
 */
function getWarmingPresenceConfig(antiBanSettings: AntiBanSettings | null) {
  const p = parseHumanBehaviorConfig(antiBanSettings).presence
  return {
    offlineDelayMinMs: p?.offlineDelayMinMs ?? OFFLINE_DELAY_MIN_MS,
    offlineDelayMaxMs: p?.offlineDelayMaxMs ?? OFFLINE_DELAY_MAX_MS,
    preComposePauseMinMs: p?.preComposePauseMinMs ?? 800,
    preComposePauseMaxMs: p?.preComposePauseMaxMs ?? 3000,
    mediaRecordingMinMs: p?.mediaRecordingMinMs ?? 2000,
    mediaRecordingMaxMs: p?.mediaRecordingMaxMs ?? 4000,
  }
}

/**
 * Parse human behavior config from AntiBanSettings JSON string.
 * Falls back to DEFAULT_HUMAN_BEHAVIOR on any error.
 */
function parseHumanBehaviorConfig(antiBanSettings: AntiBanSettings | null): HumanBehaviorConfig {
  if (!antiBanSettings?.humanBehaviorConfig) return DEFAULT_HUMAN_BEHAVIOR
  try {
    const parsed = JSON.parse(antiBanSettings.humanBehaviorConfig)
    if (parsed && typeof parsed === 'object') return parsed as HumanBehaviorConfig
  } catch { /* ignore */ }
  return DEFAULT_HUMAN_BEHAVIOR
}

/**
 * Calculate realistic typing duration based on message length.
 * NOW reads from AntiBanSettings (UI) instead of hardcoded constants.
 */
function calculateTypingDuration(text: string, antiBanSettings: AntiBanSettings | null = null): number {
  const tc = getWarmingTypingConfig(antiBanSettings)
  const charCount = text.length
  const typingSpeed = gaussianRandomFloat(10, 2.5, tc.speedMin, tc.speedMax)
  let durationMs = (charCount / typingSpeed) * 1000
  const minMs = antiBanSettings?.typingMinDelay ?? TYPING_MIN_MS
  const maxMs = antiBanSettings?.typingMaxDelay ?? TYPING_MAX_MS
  durationMs = Math.max(minMs, Math.min(maxMs, durationMs))
  if (Math.random() < tc.pauseChance) {
    durationMs += randomInt(tc.pauseMinMs, tc.pauseMaxMs)
  }
  return Math.round(durationMs)
}

/**
 * Check if current time is within the sending window.
 * Handles overnight windows where start > end (e.g., 18:00 to 05:00).
 *
 * Normal window (start <= end): current >= start AND current <= end
 * Overnight window (start > end): current >= start OR current <= end
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
    // Normal window: e.g., 08:00 to 18:00
    return currentMins >= start && currentMins <= end
  } else {
    // Overnight window: e.g., 18:00 to 05:00
    // Current is within if it's after start OR before/at end (wraps past midnight)
    return currentMins >= start || currentMins <= end
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
 * Validate that a phone number looks like a real phone number.
 * Rejects auto-generated placeholder values like "auto-1780251167130".
 * A valid phone number must start with a digit and be at least 8 characters long.
 */
function isValidPhoneNumber(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false
  const trimmed = phone.trim()
  // Must start with a digit (after optional + prefix)
  if (!/^\+?\d/.test(trimmed)) return false
  // Must have at least 8 digit characters
  const digitCount = trimmed.replace(/\D/g, '').length
  return digitCount >= 8
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
 * Pick a random variation from a template, with consecutive dedup.
 * C4/C5 FIX: Cap the map size to prevent unbounded memory growth
 * in serverless warm starts (Vercel reuses function instances).
 */
const MAX_VARIATION_CACHE_SIZE = 200
const lastUsedVariation = new Map<string, number>()

function pickVariation(variations: string[], cacheKey: string): string {
  if (variations.length === 0) return ''
  if (variations.length === 1) return variations[0]

  // C4/C5 FIX: Evict oldest entries when cache grows too large
  if (lastUsedVariation.size > MAX_VARIATION_CACHE_SIZE) {
    const keysIter = lastUsedVariation.keys()
    for (let i = 0; i < MAX_VARIATION_CACHE_SIZE / 2; i++) {
      const oldest = keysIter.next().value
      if (oldest !== undefined) lastUsedVariation.delete(oldest)
    }
  }

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
 * Delayed offline with jitter — human doesn't go offline instantly after sending.
 * NOW reads from AntiBanSettings (UI) for offline delay config.
 */
async function delayedOfflineWithJitter(instanceName: string, jid: string, antiBanSettings: AntiBanSettings | null = null): Promise<number> {
  const pc = getWarmingPresenceConfig(antiBanSettings)
  const delayMs = gaussianRandom(
    (pc.offlineDelayMinMs + pc.offlineDelayMaxMs) / 2,
    (pc.offlineDelayMaxMs - pc.offlineDelayMinMs) / 6,
    pc.offlineDelayMinMs,
    pc.offlineDelayMaxMs
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
 *
 * NOW reads from AntiBanSettings (UI) instead of hardcoded constants.
 */
async function performWarmingPresence(
  instanceName: string,
  jid: string,
  messageType: 'text' | 'image' | 'audio',
  content: string,
  antiBanSettings: AntiBanSettings | null = null
): Promise<number> {
  let totalPresenceMs = 0
  const pc = getWarmingPresenceConfig(antiBanSettings)
  const tc = getWarmingTypingConfig(antiBanSettings)

  // 1. Signal "available" before composing
  try {
    await setPresence(instanceName, jid, 'available', 1000)
  } catch { /* non-fatal */ }
  const availableDelay = gaussianRandom(
    (pc.preComposePauseMinMs + pc.preComposePauseMaxMs) / 2,
    (pc.preComposePauseMaxMs - pc.preComposePauseMinMs) / 6,
    pc.preComposePauseMinMs,
    pc.preComposePauseMaxMs
  )
  await new Promise(resolve => setTimeout(resolve, availableDelay))
  totalPresenceMs += availableDelay

  // 2. Composing/Recording presence
  if (messageType === 'audio') {
    // Audio: "recording" presence — reads from UI config
    const recordingMs = gaussianRandom(
      (pc.mediaRecordingMinMs + pc.mediaRecordingMaxMs) / 2,
      (pc.mediaRecordingMaxMs - pc.mediaRecordingMinMs) / 6,
      pc.mediaRecordingMinMs,
      pc.mediaRecordingMaxMs
    )
    try {
      await setPresence(instanceName, jid, 'recording', recordingMs)
    } catch { /* non-fatal */ }
    await new Promise(resolve => setTimeout(resolve, recordingMs))
    totalPresenceMs += recordingMs
  } else if (messageType === 'image') {
    // Image: brief "recording" (camera icon) — reads from UI config
    const captureMs = randomInt(pc.mediaRecordingMinMs, pc.mediaRecordingMaxMs)
    try {
      await setPresence(instanceName, jid, 'recording', captureMs)
    } catch { /* non-fatal */ }
    await new Promise(resolve => setTimeout(resolve, captureMs))
    totalPresenceMs += captureMs
  } else {
    // Text: "composing" with optional mid-composition pauses — reads from UI config
    const totalTypingMs = calculateTypingDuration(content, antiBanSettings)

    const shouldPause = content.length > tc.longMsgThreshold && Math.random() < tc.longMsgPauseChance

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
          const pauseMs = gaussianRandom(
            (tc.pauseMinMs + tc.pauseMaxMs) / 2,
            (tc.pauseMaxMs - tc.pauseMinMs) / 6,
            tc.pauseMinMs,
            tc.pauseMaxMs
          )
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
  const minChips = minChipsFor(session.strategy)
  if (chipIds.length < minChips) {
    throw new Error(`Precisa de pelo menos ${minChips} chips para aquecimento (estratégia: ${session.strategy})`)
  }

  // Validate that all chips exist and are connected
  const chips = await db.chip.findMany({
    where: { id: { in: chipIds } },
  })

  const connectedChips = chips.filter(c => c.status === 'connected' && c.evolutionInstance)
  if (connectedChips.length < minChips) {
    const disconnectedNames = chips
      .filter(c => c.status !== 'connected' || !c.evolutionInstance)
      .map(c => `${c.name} (${c.status}${!c.evolutionInstance ? ', sem instância' : ''})`)
      .join(', ')
    throw new Error(
      `Apenas ${connectedChips.length} de ${chips.length} chips estão conectados. Mínimo: ${minChips} (estratégia: ${session.strategy}). ` +
      `Chips desconectados: ${disconnectedNames}. Conecte-os antes de iniciar.`
    )
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

  // Check if we have enough chips (1 for ai_bot, 3 otherwise)
  const minChipsRuntime = minChipsFor(session.strategy)
  if (chipIds.length < minChipsRuntime) {
    await db.warmingSession.update({
      where: { id: sessionId },
      data: { status: 'cancelled', lastError: `Chips insuficientes (mínimo ${minChipsRuntime} para estratégia ${session.strategy})` },
    })
    return { processed: false, delayMs: 0, completed: true, reason: 'insufficient_chips' }
  }

  // Check sending window
  if (!isWithinSendingWindow(session.activeHoursStart, session.activeHoursEnd, session.timezone)) {
    console.log(`[WarmingEngine] Session "${session.name}" outside sending window (start=${session.activeHoursStart}, end=${session.activeHoursEnd}, tz=${session.timezone})`)
    return { processed: false, delayMs: 60000, completed: false, reason: 'outside_sending_window' }
  }

  // Check break windows
  const activeBreak = getActiveBreakWindow(breakWindows, session.timezone)
  if (activeBreak) {
    console.log(`[WarmingEngine] Session "${session.name}" in break window: ${activeBreak.label}`)
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

  // ============================================================
  // Load ALL chips upfront to validate and filter out invalid ones.
  // This prevents selecting a pair with an invalid recipient and
  // then failing silently — we skip invalid chips and try another pair.
  // ============================================================
  const allChips = await db.chip.findMany({
    where: { id: { in: chipIds } },
  })
  const chipMap = new Map(allChips.map(c => [c.id, c]))

  // Identify valid chips: connected + has valid phone number
  const validChipIds = chipIds.filter(chipId => {
    const chip = chipMap.get(chipId)
    return chip && chip.status === 'connected' && chip.evolutionInstance && chip.phoneNumber && isValidPhoneNumber(chip.phoneNumber)
  })

  if (validChipIds.length < minChipsRuntime) {
    const invalidChips = chipIds.filter(id => !validChipIds.includes(id)).map(id => {
      const c = chipMap.get(id)
      if (!c) return `${id}: not found`
      if (c.status !== 'connected') return `${c.name}: disconnected`
      if (!c.evolutionInstance) return `${c.name}: no instance`
      if (!c.phoneNumber) return `${c.name}: no phone`
      if (!isValidPhoneNumber(c.phoneNumber)) return `${c.name}: invalid phone (${c.phoneNumber})`
      return `${c.name}: unknown`
    })
    const errorMsg = `Chips válidos insuficientes (${validChipIds.length}/${chipIds.length}). Inválidos: ${invalidChips.join('; ')}`
    console.warn(`[WarmingEngine] Session "${session.name}" ${errorMsg}`)
    await db.warmingSession.update({
      where: { id: sessionId },
      data: { lastError: errorMsg.substring(0, 500) },
    })
    return { processed: false, delayMs: 60000, completed: false, reason: 'insufficient_valid_chips' }
  }

  // Try to select a valid sender→recipient pair.
  // CRITICAL FIX: Use validChipIds (not chipIds) for selectPair so invalid chips
  // (disconnected, invalid phone) are NEVER in the selection pool. The old code
  // used chipIds which included Artur (invalid phone), causing selectPair to
  // repeatedly pick Artur as recipient, resulting in 0 messages sent.
  //
  // We map lastPair indices from chipIds space → validChipIds space for continuity.
  let senderChip: Awaited<ReturnType<typeof db.chip.findUnique>> = null
  let recipientChip: Awaited<ReturnType<typeof db.chip.findUnique>> = null
  let senderChipId = ''
  let recipientChipId = ''
  let senderIdx = -1
  let recipientIdx = -1
  let senderProgress: WarmingChipProgress = { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }

  // Load anti-ban settings once for all attempts
  const antiBanSettings = await loadAntiBanSettings()

  // Map lastPair from chipIds indices to validChipIds indices
  const validChipIdToIdx = new Map(validChipIds.map((id, i) => [id, i]))
  const lastSenderChipId = lastPair.lastSenderIdx >= 0 && lastPair.lastSenderIdx < chipIds.length ? chipIds[lastPair.lastSenderIdx] : ''
  const lastRecipientChipId = lastPair.lastRecipientIdx >= 0 && lastPair.lastRecipientIdx < chipIds.length ? chipIds[lastPair.lastRecipientIdx] : ''
  const mappedLastSenderIdx = validChipIdToIdx.has(lastSenderChipId) ? validChipIdToIdx.get(lastSenderChipId)! : -1
  const mappedLastRecipientIdx = validChipIdToIdx.has(lastRecipientChipId) ? validChipIdToIdx.get(lastRecipientChipId)! : -1

  console.log(`[WarmingEngine] Session "${session.name}" pair selection: validChips=${validChipIds.length}, strategy=${session.strategy}, lastPair=(${lastPair.lastSenderIdx},${lastPair.lastRecipientIdx})→mapped(${mappedLastSenderIdx},${mappedLastRecipientIdx}), chipIds=[${chipIds.map((id, i) => { const c = chipMap.get(id); return `${i}:${c?.name || '?'}` }).join(',')}]`)

  for (let pairAttempt = 0; pairAttempt < validChipIds.length; pairAttempt++) {
    const [trySenderIdx, tryRecipientIdx] = selectPair(session.strategy, validChipIds, {
      lastSenderIdx: mappedLastSenderIdx + pairAttempt,
      lastRecipientIdx: mappedLastRecipientIdx + pairAttempt,
    }, chipProgress)
    const trySenderChipId = validChipIds[trySenderIdx]
    const tryRecipientChipId = validChipIds[tryRecipientIdx]

    // Must be different chips
    if (trySenderChipId === tryRecipientChipId) {
      console.log(`[WarmingEngine] Session "${session.name}" attempt ${pairAttempt}: sender===recipient (${trySenderChipId}), skipping`)
      continue
    }

    const trySenderChip = chipMap.get(trySenderChipId) || null
    const tryRecipientChip = chipMap.get(tryRecipientChipId) || null

    // Sender must be connected with instance (should always pass since validChipIds filters this, but double-check)
    if (!trySenderChip?.evolutionInstance || trySenderChip.status !== 'connected') {
      console.log(`[WarmingEngine] Session "${session.name}" attempt ${pairAttempt}: sender ${trySenderChip?.name || trySenderChipId} not connected (status=${trySenderChip?.status}, instance=${trySenderChip?.evolutionInstance || 'none'}), skipping`)
      continue
    }

    // Sender must not have reached target
    const trySenderProgress = chipProgress[trySenderChipId] || { sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null }
    if (trySenderProgress.sent >= session.messagesPerChip / 2) {
      console.log(`[WarmingEngine] Session "${session.name}" attempt ${pairAttempt}: sender ${trySenderChip.name} reached target (${trySenderProgress.sent}/${session.messagesPerChip / 2}), skipping`)
      continue
    }

    // Sender must not have hit daily limit
    const senderLimitInfo = await getChipEffectiveDailyLimit(trySenderChip, antiBanSettings)
    if (senderLimitInfo.remaining <= 0) {
      console.log(`[WarmingEngine] Session "${session.name}" attempt ${pairAttempt}: sender ${trySenderChip.name} hit daily limit (sent=${trySenderChip.sentToday}, limit=${senderLimitInfo.limit}, remaining=${senderLimitInfo.remaining}, phase=${senderLimitInfo.phase}, day=${senderLimitInfo.dayInPhase}), skipping`)
      continue
    }

    // Recipient phone validation (should always pass since validChipIds filters this, but double-check)
    if (!tryRecipientChip?.phoneNumber || !isValidPhoneNumber(tryRecipientChip.phoneNumber)) {
      console.log(`[WarmingEngine] Session "${session.name}" attempt ${pairAttempt}: recipient ${tryRecipientChip?.name || tryRecipientChipId} invalid phone (${tryRecipientChip?.phoneNumber || 'none'}), skipping`)
      continue
    }

    // Found a valid pair!
    senderChip = trySenderChip
    recipientChip = tryRecipientChip
    senderChipId = trySenderChipId
    recipientChipId = tryRecipientChipId
    // Map back to chipIds indices for lastPair storage in DB
    senderIdx = chipIds.indexOf(trySenderChipId)
    recipientIdx = chipIds.indexOf(tryRecipientChipId)
    senderProgress = trySenderProgress
    console.log(`[WarmingEngine] Session "${session.name}" found valid pair: ${trySenderChip.name} → ${tryRecipientChip.name} (attempt ${pairAttempt})`)
    break
  }

  // If no valid pair found, check why
  if (!senderChip || !recipientChip) {
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

    // Check if any senders are just in cooldown
    const anySenderInCooldown = chipIds.some(id => {
      const chip = chipMap.get(id)
      const progress = chipProgress[id]
      if (!chip || chip.status !== 'connected' || !chip.evolutionInstance) return false
      if (!progress?.lastSentAt) return false
      const elapsed = (Date.now() - new Date(progress.lastSentAt).getTime()) / 1000
      const minInterval = session.intervalMin || antiBanSettings?.messageIntervalMin || WARMING_INTERVAL_MIN
      return elapsed < minInterval
    })

    if (anySenderInCooldown) {
      return { processed: false, delayMs: 5000, completed: false, reason: 'all_senders_in_cooldown' }
    }

    // All valid senders reached target
    const anySenderBelowTarget = validChipIds.some(id => {
      const progress = chipProgress[id]
      return !progress || progress.sent < session.messagesPerChip / 2
    })

    if (!anySenderBelowTarget) {
      return { processed: false, delayMs: 5000, completed: false, reason: 'all_senders_target_reached' }
    }

    // Generic — no valid pair available right now
    console.log(`[WarmingEngine] Session "${session.name}" no valid sender→recipient pair found this tick (validChips=${validChipIds.length}/${chipIds.length})`)
    return { processed: false, delayMs: 15000, completed: false, reason: 'no_valid_pair' }
  }

  // TypeScript: after the null check above, senderChip and recipientChip are guaranteed non-null
  // Re-assign with non-null assertion for cleaner downstream access
  const sender = senderChip!
  const recipient = recipientChip!

  // Check minimum interval for this sender
  // Use session interval if set, otherwise fall back to anti-ban settings,
  // then to hardcoded constants as last resort.
  if (senderProgress.lastSentAt) {
    const lastSentTime = new Date(senderProgress.lastSentAt).getTime()
    const elapsed = (Date.now() - lastSentTime) / 1000
    const minInterval = session.intervalMin || antiBanSettings?.messageIntervalMin || WARMING_INTERVAL_MIN

    if (elapsed < minInterval) {
      const waitSeconds = Math.ceil(minInterval - elapsed)
      console.log(`[WarmingEngine] Session "${session.name}" sender ${sender.name} min interval not reached (elapsed=${Math.round(elapsed)}s, need=${minInterval}s, wait=${waitSeconds}s)`)
      return {
        processed: false,
        delayMs: waitSeconds * 1000,
        completed: false,
        reason: `min_interval_sender_${sender.name}`,
      }
    }
  }

  // Pick message type and content
  // FIX: If image/audio is selected but no media is available, fallback to text.
  // The default templates have image/audio entries with empty mediaUrl,
  // which causes "message body is required" errors when sent as text fallback.
  let messageType = pickMessageType(distribution)
  if ((messageType === 'image' || messageType === 'audio')) {
    // Check if any template for this type has a valid mediaUrl
    const hasMedia = templates.some(t => t.type === messageType && t.mediaUrl)
    if (!hasMedia) {
      // No media available — fallback to text
      messageType = 'text'
    }
  }
  const messageContent = generateWarmingMessage(templates, messageType, sender.name || '', recipient.name || '')

  // Safety net: if content is empty, use a fallback message
  if (!messageContent.content || messageContent.content.trim() === '') {
    if (messageType === 'text') {
      messageContent.content = 'Oi, tudo bem?'
    } else if (!messageContent.mediaUrl) {
      // Media type with no content AND no mediaUrl — definitely fallback to text
      messageType = 'text'
      messageContent.content = 'Oi, tudo bem?'
      messageContent.mediaUrl = undefined
    }
  }

  // ============================================================
  // SEND THE MESSAGE WITH FULL ANTI-BAN PRESENCE
  // ============================================================
  const instanceName = sender.evolutionInstance!
  const formattedPhone = formatPhoneNumber(recipient.phoneNumber!)
  const jid = `${formattedPhone}@s.whatsapp.net`

  try {
    // Perform presence simulation — reads from AntiBanSettings (UI)
    await performWarmingPresence(instanceName, jid, messageType, messageContent.content, antiBanSettings)

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
        linkPreview: antiBanSettings?.linkPreviewEnabled ?? false,
      })
    }

    // Delayed offline with jitter — reads from AntiBanSettings (UI)
    const offlineDelayMs = await delayedOfflineWithJitter(instanceName, jid, antiBanSettings)

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
      },
    })

    console.debug(`[WarmingEngine] ${sender.name} → ${recipient.name}: [${messageType}] "${messageContent.content.substring(0, 50)}..." (sent: ${senderProgress.sent}, received: ${recipientProgress.received})`)

    // Calculate next delay (gaussian)
    // Use session interval if set, otherwise fall back to anti-ban settings,
    // then to hardcoded constants as last resort.
    const intervalMin = session.intervalMin || antiBanSettings?.messageIntervalMin || WARMING_INTERVAL_MIN
    const intervalMax = session.intervalMax || antiBanSettings?.messageIntervalMax || WARMING_INTERVAL_MAX
    const nextDelay = gaussianRandom(
      (intervalMin + intervalMax) / 2,
      (intervalMax - intervalMin) / 6,
      intervalMin,
      intervalMax
    )

    // Return the full delay — don't subtract offlineDelayMs.
    // The interval is the minimum time between messages, and humanization
    // (offline delay, typing) is ADDITIONAL time on top of it.
    // Subtracting it collapses the interval, defeating anti-ban.
    const effectiveMinMs = (antiBanSettings?.messageIntervalMin || WARMING_INTERVAL_MIN) * 1000
    return {
      processed: true,
      delayMs: Math.max(nextDelay * 1000, effectiveMinMs),
      completed: false,
    }

  } catch (error: any) {
    const errorMsg = error?.message || String(error)
    console.error(`[WarmingEngine] Session "${session.name}" error sending message from ${sender?.name || senderChipId} to ${recipient?.name || recipientChipId}: ${errorMsg}`)

    await db.warmingSession.update({
      where: { id: sessionId },
      data: {
        errorCount: { increment: 1 },
        messagesFailed: { increment: 1 },
        lastError: `Erro ao enviar de ${sender?.name || senderChipId} para ${recipient?.name || recipientChipId}: ${errorMsg}`.substring(0, 500),
      },
    })

    // If too many errors, pause the session
    // Note: errorCount was just incremented in DB (line above), but session var is stale (pre-increment).
    // So session.errorCount + 1 is the actual current count in DB.
    const currentErrorCount = session.errorCount + 1
    let maxErrors: number = (FIELD_DEFAULTS.warmingAutoPauseErrors as number) ?? 10
    try {
      const dbSettings = await db.antiBanSettings.findFirst()
      if (dbSettings?.warmingAutoPauseErrors) maxErrors = Number(dbSettings.warmingAutoPauseErrors)
    } catch { /* use default */ }
    if (currentErrorCount >= maxErrors) {
      await db.warmingSession.update({
        where: { id: sessionId },
        data: {
          status: 'paused',
          lastError: `Pausado automaticamente após ${currentErrorCount} erros: ${error.message?.substring(0, 200)}`,
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
    // Pré-carrega a sessão para determinar a estratégia
    const session = await db.warmingSession.findUnique({
      where: { id: sessionId },
      select: { strategy: true, status: true },
    })

    if (!session || session.status !== 'running') continue

    // ============================================================
    // Roteamento por estratégia
    // ============================================================
    // "ai_bot" tem seu próprio processador (1 chamada por tick — varre todos os chips)
    // Outras estratégias usam processNextWarmingMessage com até MAX_MESSAGES_PER_TICK
    //    tentativas internas (delay entre cada).
    // ============================================================
    if (session.strategy === 'ai_bot') {
      try {
        const result = await processNextAIBotMessage(sessionId)
        totalSent += result.sentCount
        if (result.reason === 'session_not_running') {
          totalErrors++
        }
      } catch (error: any) {
        console.error(`[WarmingEngine] Error processing ai_bot session ${sessionId}:`, error.message)
        totalErrors++
      }
      continue
    }

    // Estratégias tradicionais (round_robin, pairs, random, group)
    for (let attempt = 0; attempt < MAX_MESSAGES_PER_TICK; attempt++) {
      try {
        const result = await processNextWarmingMessage(sessionId)

        if (result.processed) {
          totalSent++
        } else if (result.completed) {
          break // Session is done
        }

        // Wait the delay between messages — respect the anti-ban interval.
        // Previously capped at 4s which truncated 45-120s intervals to 4s,
        // completely defeating the anti-ban purpose. Now:
        // - If delay fits within the tick budget, wait the full amount
        // - If delay is too long, don't send more messages this tick
        //   (the next cron tick will handle it via nextSendAt persistence)
        if (result.delayMs > 0) {
          // Don't cap the delay — respect the anti-ban interval from UI settings.
          // If the delay is longer than a tick, just wait what we can and let
          // the next tick continue. But for warming, we process 1 message per
          // attempt, so the delay is the interval to wait before the next message.
          // We only wait within the tick if delay is reasonable (< 30s).
          const maxWaitMs = 30000 // 30s max wait within a tick (leaves time for other sessions)
          if (result.delayMs <= maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, result.delayMs))
          } else {
            // Delay is too long for this tick — stop processing this session.
            // The next cron tick will pick it up after the delay elapses.
            break
          }
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

// ============================================================
// AI BOT STRATEGY (estratégia "ai_bot")
// ============================================================
// Nesta estratégia, os chips do warming mandam mensagens do pool global
// (WarmingMessagePool) para um operador humano (Duda). O Duda responde
// manualmente no WhatsApp; o webhook detecta a resposta e o motor envia
// a próxima mensagem do pool.
//
// Fluxo:
//   1. Cron tick (a cada 60s) chama processAllWarmingSessions()
//   2. Para cada sessão running com strategy='ai_bot', chama
//      processNextAIBotMessage() que:
//        a. Verifica se algum chip está esperando reply há mais de
//           aiBotReplyTimeoutSec → checkAIBotTimeouts()
//        b. Para cada chip elegível (conversa do dia não encerrada),
//           se não está esperando reply, escolhe uma categoria ≠ da última,
//           sorteia mensagem ponderada, simula typing, envia para o Duda,
//           marca aiBotWaitingReplySince = now()
//   3. Duda responde → webhook (handlers.ts) chama handleDudaReply()
//      → reseta aiBotWaitingReplySince = null
//      → reseta aiBotMissedCount = 0
//      → marca aiBotLastReplyAt = now
//   4. No próximo tick, o motor vê que aiBotLastReplyAt + humanDelay < now
//      e dispara a próxima mensagem
//   5. Se 5min passarem sem reply → aiBotMissedCount++
//      → se aiBotMissedCount >= aiBotMaxMissedReplies → marca o dia do chip
//         como encerrado (aiBotConversationDayEndedAt = YYYY-MM-DD hoje)
//         → chip não recebe novas mensagens até a meia-noite

/**
 * Sorteia uma categoria do pool, evitando repetir a última usada pelo chip.
 * Sempre retorna uma categoria válida — fallback para a primeira se algo der errado.
 */
function pickNextCategory(lastCategoryUsed: string | null | undefined): string {
  const available = AI_BOT_CATEGORIES.filter(c => c !== lastCategoryUsed)
  if (available.length === 0) return AI_BOT_CATEGORIES[0]
  return available[Math.floor(Math.random() * available.length)]
}

/**
 * Sorteia uma mensagem do pool ponderada por `weight`, dentro da categoria.
 * Retorna null se não houver mensagens ativas nessa categoria.
 */
async function pickMessageFromPool(category: string): Promise<{ id: string; content: string } | null> {
  const messages = await db.warmingMessagePool.findMany({
    where: { category, active: true },
    select: { id: true, content: true, weight: true },
  })
  if (messages.length === 0) return null

  const totalWeight = messages.reduce((sum, m) => sum + m.weight, 0)
  if (totalWeight <= 0) {
    // All weights are zero — pick uniformly
    const m = messages[Math.floor(Math.random() * messages.length)]
    return { id: m.id, content: m.content }
  }

  let roll = Math.random() * totalWeight
  for (const m of messages) {
    roll -= m.weight
    if (roll <= 0) return { id: m.id, content: m.content }
  }
  // Fallback (shouldn't happen)
  const m = messages[messages.length - 1]
  return { id: m.id, content: m.content }
}

/**
 * Helper: retorna a data atual (YYYY-MM-DD) no timezone da sessão.
 * Usado para verificar se o dia já virou (libera chip para conversar de novo).
 */
function getTodayString(timezone: string = 'America/Sao_Paulo'): string {
  try {
    const now = new Date()
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return fmt.format(now) // "YYYY-MM-DD" (sv-SE locale format)
  } catch {
    // Fallback para UTC se timezone inválido
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * Processa o próximo tick para uma sessão "ai_bot".
 *
 * Diferente da estratégia round_robin (que envia uma mensagem por chamada),
 * aqui varremos TODOS os chips elegíveis em cada tick e disparamos uma mensagem
 * para cada um que está pronto para enviar (não está esperando reply e o delay
 * humano desde a última reply já passou).
 *
 * @returns número de mensagens enviadas neste tick
 */
export async function processNextAIBotMessage(
  sessionId: string
): Promise<{ processed: boolean; delayMs: number; completed: boolean; reason?: string; sentCount: number }> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session || session.status !== 'running') {
    return { processed: false, delayMs: 5000, completed: false, reason: 'session_not_running', sentCount: 0 }
  }

  if (session.strategy !== 'ai_bot') {
    // Não é estratégia ai_bot — ignora (deve ser tratado pelo processNextWarmingMessage)
    return { processed: false, delayMs: 0, completed: false, reason: 'wrong_strategy', sentCount: 0 }
  }

  const chipIds: string[] = parseJsonField(session.chipIds, [])
  const chipProgress: Record<string, WarmingChipProgress> = parseJsonField(session.chipProgress, {})
  const breakWindows: WarmingBreakWindow[] = parseJsonField(session.breakWindows, [])

  // Config ai_bot com defaults
  const dudaPhone = session.aiBotPhoneNumber || DEFAULT_AI_BOT_PHONE
  const replyTimeoutSec = session.aiBotReplyTimeoutSec || DEFAULT_AI_BOT_REPLY_TIMEOUT_SEC
  const maxMissed = session.aiBotMaxMissedReplies || DEFAULT_AI_BOT_MAX_MISSED_REPLIES

  // Verificações de janela (iguais ao round_robin)
  if (!isWithinSendingWindow(session.activeHoursStart, session.activeHoursEnd, session.timezone)) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'outside_sending_window', sentCount: 0 }
  }
  const activeBreak = getActiveBreakWindow(breakWindows, session.timezone)
  if (activeBreak) {
    return { processed: false, delayMs: 60000, completed: false, reason: `break_window_${activeBreak.label}`, sentCount: 0 }
  }

  // Carrega todos os chips
  const allChips = await db.chip.findMany({ where: { id: { in: chipIds } } })
  const today = getTodayString(session.timezone)
  const antiBanSettings = await loadAntiBanSettings()
  const now = Date.now()

  let sentCount = 0
  let updatedProgress = false
  const sessionUpdates: { messagesSent?: number; lastMessageAt?: Date; chipProgress?: string } = {}

  for (const chip of allChips) {
    // Validações básicas
    if (chip.status !== 'connected' || !chip.evolutionInstance || !chip.phoneNumber || !isValidPhoneNumber(chip.phoneNumber)) {
      continue
    }

    const progress = chipProgress[chip.id] || {
      sent: 0, received: 0, lastSentAt: null, lastReceivedAt: null,
      aiBotMissedCount: 0, aiBotLastCategory: null,
      aiBotWaitingReplySince: null, aiBotLastReplyAt: null,
      aiBotConversationDayEndedAt: null,
    }

    // Verifica se o chip já atingiu a meta de mensagens
    if ((progress.sent + progress.received) >= session.messagesPerChip) {
      continue
    }

    // Verifica se o dia do chip já encerrou
    if (progress.aiBotConversationDayEndedAt === today) {
      continue
    }

    // Se está esperando reply, NÃO enviar (espera o Duda responder ou o timeout)
    if (progress.aiBotWaitingReplySince) {
      continue
    }

    // Verifica o delay humano desde a última reply do Duda (se já houve reply)
    if (progress.aiBotLastReplyAt) {
      const lastReplyMs = new Date(progress.aiBotLastReplyAt).getTime()
      const humanDelaySec = gaussianRandom(
        (AI_BOT_REPLY_DELAY_MIN_SEC + AI_BOT_REPLY_DELAY_MAX_SEC) / 2,
        (AI_BOT_REPLY_DELAY_MAX_SEC - AI_BOT_REPLY_DELAY_MIN_SEC) / 6,
        AI_BOT_REPLY_DELAY_MIN_SEC,
        AI_BOT_REPLY_DELAY_MAX_SEC
      )
      const elapsedSec = (now - lastReplyMs) / 1000
      if (elapsedSec < humanDelaySec) {
        continue // Ainda não está na hora de enviar a próxima
      }
    } else if (progress.lastSentAt) {
      // Primeira reply ainda não chegou — respeita o intervalo normal da sessão
      const lastSentMs = new Date(progress.lastSentAt).getTime()
      const intervalMin = session.intervalMin || WARMING_INTERVAL_MIN
      const elapsedSec = (now - lastSentMs) / 1000
      if (elapsedSec < intervalMin) {
        continue
      }
    }

    // Tudo OK — escolhe categoria e mensagem
    const category = pickNextCategory(progress.aiBotLastCategory)
    const message = await pickMessageFromPool(category)
    if (!message) {
      console.warn(`[WarmingEngine][ai_bot] Sem mensagens ativas na categoria "${category}" — pulando chip ${chip.name}`)
      continue
    }

    // Envia a mensagem com presença humanizada (igual ao round_robin)
    const instanceName = chip.evolutionInstance
    const formattedPhone = formatPhoneNumber(dudaPhone)
    const jid = `${formattedPhone}@s.whatsapp.net`

    try {
      await performWarmingPresence(instanceName, jid, 'text', message.content, antiBanSettings)
      await sendTextMessage(instanceName, formattedPhone, message.content, {
        delay: 0,
        linkPreview: antiBanSettings?.linkPreviewEnabled ?? false,
      })
      await delayedOfflineWithJitter(instanceName, jid, antiBanSettings)

      // Atualiza progresso do chip
      progress.sent++
      progress.lastSentAt = new Date().toISOString()
      progress.aiBotLastCategory = category
      progress.aiBotWaitingReplySince = new Date().toISOString()

      chipProgress[chip.id] = progress
      updatedProgress = true
      sentCount++

      console.debug(`[WarmingEngine][ai_bot] ${chip.name} → Duda (${dudaPhone}): [${category}] "${message.content.substring(0, 50)}..."`)
    } catch (error: any) {
      console.error(`[WarmingEngine][ai_bot] Erro enviando de ${chip.name} para Duda: ${error.message}`)
      // Marca erro na sessão mas continua com próximos chips
      sessionUpdates.messagesSent = (sessionUpdates.messagesSent || 0) // no-op
    }

    // Limita a 1 envio por chip por tick (para não saturar)
    // — mas permite múltiplos chips enviarem no mesmo tick
  }

  // Persiste progresso se houve mudanças
  if (updatedProgress) {
    await db.warmingSession.update({
      where: { id: sessionId },
      data: {
        messagesSent: { increment: sentCount },
        lastMessageAt: new Date(),
        chipProgress: JSON.stringify(chipProgress),
      },
    })
  }

  // Verifica timeouts (chips esperando reply há mais de replyTimeoutSec)
  const timeoutResult = await checkAIBotTimeouts(sessionId, chipProgress, today, replyTimeoutSec, maxMissed)

  // Se não enviou nada e não há timeouts, retorna com delay normal
  return {
    processed: sentCount > 0,
    delayMs: 60000, // próximo tick em 60s
    completed: false,
    reason: sentCount > 0 ? undefined : 'no_chips_ready',
    sentCount,
  }
}

/**
 * Verifica se algum chip está esperando reply do Duda há mais que o timeout.
 * Se sim, incrementa aiBotMissedCount e, se atingir o limite, encerra o dia do chip.
 *
 * @returns número de chips que tiveram missed reply incrementado neste tick
 */
export async function checkAIBotTimeouts(
  sessionId: string,
  chipProgressOverride?: Record<string, WarmingChipProgress>,
  todayOverride?: string,
  replyTimeoutSecOverride?: number,
  maxMissedOverride?: number
): Promise<{ missedCount: number; dayEndedCount: number }> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session || session.status !== 'running' || session.strategy !== 'ai_bot') {
    return { missedCount: 0, dayEndedCount: 0 }
  }

  const chipProgress = chipProgressOverride || parseJsonField(session.chipProgress, {})
  const today = todayOverride || getTodayString(session.timezone)
  const replyTimeoutSec = replyTimeoutSecOverride || session.aiBotReplyTimeoutSec || DEFAULT_AI_BOT_REPLY_TIMEOUT_SEC
  const maxMissed = maxMissedOverride || session.aiBotMaxMissedReplies || DEFAULT_AI_BOT_MAX_MISSED_REPLIES

  const now = Date.now()
  let missedCount = 0
  let dayEndedCount = 0
  let changed = false

  for (const chipId of Object.keys(chipProgress)) {
    const progress = chipProgress[chipId]
    if (!progress.aiBotWaitingReplySince) continue

    const waitingSinceMs = new Date(progress.aiBotWaitingReplySince).getTime()
    const elapsedSec = (now - waitingSinceMs) / 1000

    if (elapsedSec >= replyTimeoutSec) {
      // Timeout expirado — conta como missed
      progress.aiBotMissedCount = (progress.aiBotMissedCount || 0) + 1
      progress.aiBotWaitingReplySince = null // para de esperar
      missedCount++
      changed = true

      if (progress.aiBotMissedCount >= maxMissed) {
        // Encerra a conversa do dia do chip
        progress.aiBotConversationDayEndedAt = today
        dayEndedCount++
        console.warn(`[WarmingEngine][ai_bot] Chip ${chipId} atingiu ${maxMissed} missed replies consecutivos — conversa do dia encerrada (${today})`)
      } else {
        console.warn(`[WarmingEngine][ai_bot] Chip ${chipId} — missed reply ${progress.aiBotMissedCount}/${maxMissed}`)
      }
    }
  }

  if (changed && !chipProgressOverride) {
    // Só persiste se não foi passado override (caso contrário, quem chamou persiste)
    await db.warmingSession.update({
      where: { id: sessionId },
      data: { chipProgress: JSON.stringify(chipProgress) },
    })
  }

  return { missedCount, dayEndedCount }
}

/**
 * Handler chamado pelo webhook quando uma mensagem é recebida do Duda.
 *
 * Identifica qual chip estava esperando essa reply e:
 *   - reseta aiBotWaitingReplySince = null
 *   - reseta aiBotMissedCount = 0
 *   - marca aiBotLastReplyAt = now
 *   - incrementa received no progress
 *
 * @param recipientChipId — ID do chip que recebeu a reply (DEVE estar na sessão ai_bot)
 * @param dudaPhone — telefone do Duda (já normalizado, sem 55)
 */
export async function handleDudaReply(
  recipientChipId: string,
  dudaPhone: string
): Promise<{ matched: boolean; sessionId?: string }> {
  // Busca todas as sessões ai_bot running que incluem esse chip
  const sessions = await db.warmingSession.findMany({
    where: { status: 'running', strategy: 'ai_bot' },
    select: { id: true, chipIds: true, chipProgress: true, aiBotPhoneNumber: true },
  })

  for (const session of sessions) {
    const chipIds: string[] = parseJsonField(session.chipIds, [])
    if (!chipIds.includes(recipientChipId)) continue

    // Verifica se o telefone do remetente bate com o aiBotPhoneNumber configurado
    const expectedPhone = session.aiBotPhoneNumber || DEFAULT_AI_BOT_PHONE
    // Normaliza ambos para comparação (remove 55 prefix se presente)
    const normalizePhone = (p: string) => p.replace(/^55/, '').replace(/\D/g, '')
    if (normalizePhone(expectedPhone) !== normalizePhone(dudaPhone)) {
      continue
    }

    const chipProgress: Record<string, WarmingChipProgress> = parseJsonField(session.chipProgress, {})
    const progress = chipProgress[recipientChipId]
    if (!progress) continue

    // Só processa se estava realmente esperando reply
    if (!progress.aiBotWaitingReplySince) {
      // Mesmo assim, atualiza lastReplyAt (pode ser reply atrasada, ainda conta)
      progress.aiBotLastReplyAt = new Date().toISOString()
      progress.received = (progress.received || 0) + 1
      chipProgress[recipientChipId] = progress
      await db.warmingSession.update({
        where: { id: session.id },
        data: { chipProgress: JSON.stringify(chipProgress) },
      })
      return { matched: true, sessionId: session.id }
    }

    // Reseta estado de espera + missed count
    progress.aiBotWaitingReplySince = null
    progress.aiBotMissedCount = 0
    progress.aiBotLastReplyAt = new Date().toISOString()
    progress.received = (progress.received || 0) + 1
    progress.lastReceivedAt = new Date().toISOString()
    chipProgress[recipientChipId] = progress

    await db.warmingSession.update({
      where: { id: session.id },
      data: { chipProgress: JSON.stringify(chipProgress) },
    })

    console.log(`[WarmingEngine][ai_bot] Reply do Duda recebida para chip ${recipientChipId} — resetando estado de espera`)
    return { matched: true, sessionId: session.id }
  }

  return { matched: false }
}

// Export DEFAULT_WARMING_TEMPLATES for use in the UI
export { DEFAULT_WARMING_TEMPLATES }
export type { WarmingMessageTemplate, WarmingChipProgress, MessageTypeDistribution, WarmingBreakWindow }
