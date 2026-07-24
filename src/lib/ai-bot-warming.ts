// AI Bot Warming — Chips conversam com o bot Duda
// ====================================================
//
// Estratégia "ai_bot" do warming engine:
//   1. Chip do OctupusZap sorteia uma mensagem do pool global (WarmingMessagePool)
//   2. Sorteia categoria (≠ última usada) + mensagem dentro da categoria
//   3. Performa presença humanizada (typing) e envia para o número do Duda
//   4. Marca chip como "aguardando reply" (aiBotWaitingReplySince = now)
//   5. Quando o Duda responde (via webhook Evolution), handleDudaReply() limpa
//      o estado de espera e reseta o contador de "missed"
//   6. Próximo tick do cron: se respeita anti-ban, manda próxima mensagem
//   7. Se passar do timeout (aiBotReplyTimeoutSec) sem resposta:
//      - aiBotMissedCount++
//      - Se >= aiBotMaxMissedReplies: encerra conversa do dia
//   8. Meia-noite: reseta estado, chip pode conversar de novo
//
// O bot Duda roda externamente (n8n + Meta Official API) e NÃO é modificado.
// Esta estratégia só cuida do lado OctupusZap (envio + detecção de reply).
//
// Anti-ban: herda TODAS as regras do warming engine atual:
//   - Sending window (activeHoursStart/End)
//   - Break windows (almoço)
//   - Intervalo mínimo entre mensagens (messageIntervalMin/Max)
//   - Typing simulation (typingMinDelay/Max + humanBehaviorConfig)
//   - Daily limit por fase (nursery/prewarm/ready)
//   - Presence stagger, delayed offline com jitter

import { sendTextMessage, setPresence, formatPhoneNumber } from './evolution-api'
import { db } from './db'
import { getCurrentMinutes, toMins } from './time-utils'
import { type AntiBanSettings } from './constants'
import {
  type WarmingChipProgress,
  type WarmingBreakWindow,
  parseJsonField,
  gaussianRandom,
  randomInt,
  isWithinSendingWindow,
  getActiveBreakWindow,
  performWarmingPresence,
  delayedOfflineWithJitter,
  loadAntiBanSettings,
  getChipEffectiveDailyLimit,
  isValidPhoneNumber,
} from './warming-engine'

// ============================================================
// TYPES
// ============================================================

/**
 * Extensão de WarmingChipProgress com campos específicos da estratégia ai_bot.
 * Os campos extras são opcionais para manter retrocompatibilidade com chips
 * que já estão em outras estratégias (pairs, round_robin, etc).
 */
export interface AIBotChipProgress extends WarmingChipProgress {
  // Quantas respostas consecutivas sem reply do Duda
  aiBotMissedCount?: number
  // Última categoria usada (pra não repetir seguida)
  aiBotLastCategory?: string | null
  // ISO timestamp desde quando está esperando reply do Duda
  aiBotWaitingReplySince?: string | null
  // ISO timestamp do último reply recebido
  aiBotLastReplyAt?: string | null
  // Se a conversa foi encerrada hoje (após 2+ misses consecutivos)
  aiBotConversationEnded?: boolean
  // ISO timestamp de quando a conversa foi encerrada
  aiBotConversationEndedAt?: string | null
  // Data (YYYY-MM-DD) do último reset diário — pra saber quando resetar
  aiBotLastResetDate?: string | null
}

// ============================================================
// CONSTANTS
// ============================================================

// Categorias válidas do pool — usadas para validação e sorteio
export const AI_BOT_CATEGORIES = [
  'saudacao',
  'emoji_unico',
  'emoji_combo',
  'pergunta_geral',
  'declaracao_casual',
  'produto_mtech',
  'info_pedido',
  'conversa_fiada',
] as const

// Máximo de mensagens enviadas por tick do cron (mesma constante do warming-engine)
const MAX_MESSAGES_PER_TICK = 5

// Máximo de ticks para checar timeouts antes de processar nova mensagem
const MAX_TIMEOUT_CHECKS_PER_TICK = 10

// ============================================================
// POOL CACHE — Evita queries repetidas dentro do mesmo tick
// ============================================================

interface PoolCacheEntry {
  ts: number
  byCategory: Map<string, { id: string; content: string; weight: number }[]>
}

let poolCache: PoolCacheEntry | null = null
const POOL_CACHE_TTL_MS = 60_000 // 1 minuto

/**
 * Carrega mensagens ativas do pool agrupadas por categoria.
 * Usa cache em memória (60s TTL) pra evitar N queries por tick.
 */
async function getPoolByCategory(): Promise<Map<string, { id: string; content: string; weight: number }[]>> {
  if (poolCache && Date.now() - poolCache.ts < POOL_CACHE_TTL_MS) {
    return poolCache.byCategory
  }

  try {
    const messages = await db.warmingMessagePool.findMany({
      where: { active: true },
      select: { id: true, category: true, content: true, weight: true },
    })

    const byCat = new Map<string, { id: string; content: string; weight: number }[]>()
    for (const m of messages) {
      if (!byCat.has(m.category)) byCat.set(m.category, [])
      byCat.get(m.category)!.push({ id: m.id, content: m.content, weight: m.weight })
    }

    poolCache = { ts: Date.now(), byCategory: byCat }
    return byCat
  } catch (error) {
    console.error('[AIBotWarming] Failed to load pool:', error)
    return new Map()
  }
}

/**
 * Invalida o cache do pool — chamar após mutações no admin (insert/update/delete).
 */
export function invalidatePoolCache(): void {
  poolCache = null
}

// ============================================================
// SORTING UTILITIES
// ============================================================

/**
 * Sorteio ponderado genérico.
 * weights[i] é o peso de items[i]. Retorna um item aleatório proporcional ao peso.
 */
function weightedRandom<T>(items: T[], weights: number[]): T {
  if (items.length === 0) throw new Error('weightedRandom: empty items')
  if (items.length !== weights.length) throw new Error('weightedRandom: items/weights length mismatch')

  const total = weights.reduce((s, w) => s + Math.max(0, w), 0)
  if (total === 0) return items[Math.floor(Math.random() * items.length)]

  let roll = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    roll -= Math.max(0, weights[i])
    if (roll <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Sorteia uma categoria do pool, evitando repetir a última usada.
 * Pondera pelo número de mensagens ativas em cada categoria (categorias maiores têm mais chance).
 *
 * @param pool Mapa categoria → mensagens
 * @param lastCategory Última categoria usada pelo chip (para evitar repetição seguida)
 * @returns Nome da categoria sorteada, ou null se pool estiver vazio
 */
function pickCategory(
  pool: Map<string, { id: string; content: string; weight: number }[]>,
  lastCategory: string | null
): string | null {
  const allCategories = Array.from(pool.keys()).filter(c => pool.get(c)!.length > 0)
  if (allCategories.length === 0) return null

  // Se só tem 1 categoria, não tem como evitar repetição
  if (allCategories.length === 1) return allCategories[0]

  // Filtra fora a última categoria usada
  const candidates = allCategories.filter(c => c !== lastCategory)
  if (candidates.length === 0) return allCategories[0]

  // Pondera pelo número de mensagens ativas em cada categoria
  const weights = candidates.map(c => pool.get(c)!.length)
  return weightedRandom(candidates, weights)
}

/**
 * Sorteia uma mensagem dentro de uma categoria, ponderada pelo peso de cada mensagem.
 */
function pickMessageFromCategory(
  messages: { id: string; content: string; weight: number }[]
): { id: string; content: string; weight: number } | null {
  if (messages.length === 0) return null
  const weights = messages.map(m => m.weight)
  return weightedRandom(messages, weights)
}

// ============================================================
// DATE HELPERS
// ============================================================

/**
 * Retorna a data atual no timezone America/Sao_Paulo no formato YYYY-MM-DD.
 * Usado para detectar mudança de dia e resetar estado de "conversa encerrada".
 */
function getTodayInSaoPaulo(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
  return formatter.format(new Date())
}

/**
 * Verifica se um ISO timestamp é de um dia anterior ao de hoje (timezone SP).
 */
function isFromYesterdayOrEarlier(isoTs: string | null | undefined): boolean {
  if (!isoTs) return false
  try {
    const date = new Date(isoTs)
    const formatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      timeZone: 'America/Sao_Paulo',
    })
    const tsDate = formatter.format(date)
    return tsDate < getTodayInSaoPaulo()
  } catch {
    return false
  }
}

// ============================================================
// PROGRESS HELPERS
// ============================================================

/**
 * Garante que um progress de chip tem os campos ai_bot inicializados.
 * Não muta o original; retorna um novo objeto.
 */
function ensureAIBotFields(progress: WarmingChipProgress | undefined): AIBotChipProgress {
  const base: WarmingChipProgress = progress ?? {
    sent: 0,
    received: 0,
    lastSentAt: null,
    lastReceivedAt: null,
  }
  return {
    ...base,
    aiBotMissedCount: (base as AIBotChipProgress).aiBotMissedCount ?? 0,
    aiBotLastCategory: (base as AIBotChipProgress).aiBotLastCategory ?? null,
    aiBotWaitingReplySince: (base as AIBotChipProgress).aiBotWaitingReplySince ?? null,
    aiBotLastReplyAt: (base as AIBotChipProgress).aiBotLastReplyAt ?? null,
    aiBotConversationEnded: (base as AIBotChipProgress).aiBotConversationEnded ?? false,
    aiBotConversationEndedAt: (base as AIBotChipProgress).aiBotConversationEndedAt ?? null,
    aiBotLastResetDate: (base as AIBotChipProgress).aiBotLastResetDate ?? null,
  }
}

/**
 * Reseta estado diário de um chip ai_bot se mudou de dia.
 * Retorna o progress atualizado (ou o original se não precisou resetar).
 */
function maybeResetDailyState(progress: AIBotChipProgress): AIBotChipProgress {
  const today = getTodayInSaoPaulo()
  if (progress.aiBotLastResetDate === today) return progress

  // Virou o dia — reseta estado de "conversa encerrada"
  return {
    ...progress,
    aiBotConversationEnded: false,
    aiBotConversationEndedAt: null,
    aiBotMissedCount: 0,
    aiBotLastResetDate: today,
    // Mantém aiBotLastCategory pra não repetir categoria entre dias
    // Mantém aiBotWaitingReplySince (se estava esperando reply à meia-noite, ainda pode chegar)
    // Mantém sent/received (acumulados da sessão)
  }
}

// ============================================================
// NORMALIZE PHONE — para comparar números
// ============================================================

/**
 * Normaliza um número de telefone removendo tudo que não é dígito.
 * Remove o prefixo 55 (Brasil) se presente, pra comparação.
 * Ex: "+55 48 99174-2716" → "48991742716"
 *     "5548991742716"     → "48991742716"
 *     "48991742716"       → "48991742716"
 */
function normalizePhone(phone: string): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  // Remove prefixo 55 do Brasil (pode estar presente em formato E.164)
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.substring(2)
  }
  return digits
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Detecta reply do Duda para um chip em sessão ai_bot ativa.
 * Chamado pelo webhook handler (handlers.ts, case 'Message') quando uma
 * mensagem é recebida por um chip do sistema.
 *
 * @param recipientChipId ID do chip que recebeu a mensagem
 * @param senderPhone Telefone de quem enviou (deve bater com aiBotPhoneNumber de alguma sessão)
 * @param _messageContent Conteúdo da mensagem recebida (não usado hoje, mas mantido pra logs futuros)
 */
export async function handleDudaReply(
  recipientChipId: string,
  senderPhone: string,
  _messageContent: string
): Promise<void> {
  if (!recipientChipId || !senderPhone) return

  const normalizedSender = normalizePhone(senderPhone)
  if (!normalizedSender) return

  try {
    // Busca sessões ai_bot ativas onde o número do bot bate com o senderPhone
    // Fazemos em duas etapas pra não depender de busca por substring no DB
    const runningSessions = await db.warmingSession.findMany({
      where: {
        status: 'running',
        strategy: 'ai_bot',
        aiBotPhoneNumber: { not: null },
      },
      select: {
        id: true,
        aiBotPhoneNumber: true,
        chipProgress: true,
        chipIds: true,
      },
    })

    // Filtra em memória pelas que têm o phoneNumber normalizado igual
    const matchingSessions = runningSessions.filter(s => {
      const storedPhone = s.aiBotPhoneNumber ?? ''
      return normalizePhone(storedPhone) === normalizedSender
    })

    if (matchingSessions.length === 0) return // não é reply de warming ai_bot

    for (const session of matchingSessions) {
      // Verifica se o chip recipient está nesta sessão
      const chipIds: string[] = parseJsonField(session.chipIds, [])
      if (!chipIds.includes(recipientChipId)) continue

      const chipProgress = parseJsonField<Record<string, WarmingChipProgress>>(session.chipProgress, {})
      const progress = ensureAIBotFields(chipProgress[recipientChipId])

      // Se não está esperando reply, ignora (já processou ou não estava esperando)
      if (!progress.aiBotWaitingReplySince) continue

      // Reset estado de espera
      const now = new Date().toISOString()
      const updatedProgress: AIBotChipProgress = {
        ...progress,
        aiBotWaitingReplySince: null,
        aiBotMissedCount: 0,
        aiBotLastReplyAt: now,
        received: progress.received + 1,
        lastReceivedAt: now,
      }

      chipProgress[recipientChipId] = updatedProgress

      await db.warmingSession.update({
        where: { id: session.id },
        data: {
          chipProgress: JSON.stringify(chipProgress),
        },
      })

      console.log(`[AIBotWarming] Reply detected for chip ${recipientChipId} in session ${session.id} — reset waiting state`)
    }
  } catch (error) {
    console.error('[AIBotWarming] handleDudaReply failed:', error)
    // Non-fatal — não propaga pra não quebrar o webhook handler
  }
}

/**
 * Verifica timeouts de chips ai_bot que estão esperando reply há mais tempo
 * que o configurado. Marca missed, e se atingir o limite, encerra conversa do dia.
 *
 * Deve ser chamado no início de processAllWarmingSessions, antes de processNextAIBotMessage.
 *
 * @param sessions Lista de sessões ai_bot ativas
 */
export async function checkAIBotTimeouts(
  sessions: Array<{ id: string; aiBotReplyTimeoutSec: number; aiBotMaxMissedReplies: number; chipProgress: string; chipIds: string }>
): Promise<void> {
  const now = Date.now()

  for (const session of sessions) {
    try {
      const chipIds: string[] = parseJsonField(session.chipIds, [])
      const chipProgress = parseJsonField<Record<string, WarmingChipProgress>>(session.chipProgress, {})

      let dirty = false

      for (const chipId of chipIds) {
        const progress = ensureAIBotFields(chipProgress[chipId])
        const resetProgress = maybeResetDailyState(progress)

        // Se resetou daily, marca dirty
        if (resetProgress !== progress) {
          chipProgress[chipId] = resetProgress
          dirty = true
        }

        const currentProgress = (chipProgress[chipId] as AIBotChipProgress) ?? resetProgress

        // Se não está esperando reply, pula
        if (!currentProgress.aiBotWaitingReplySince) continue

        // Verifica timeout
        const waitingSinceMs = new Date(currentProgress.aiBotWaitingReplySince).getTime()
        const elapsedMs = now - waitingSinceMs
        const timeoutMs = session.aiBotReplyTimeoutSec * 1000

        if (elapsedMs >= timeoutMs) {
          // Timeout atingido — conta como missed
          const newMissedCount = (currentProgress.aiBotMissedCount ?? 0) + 1
          const shouldEnd = newMissedCount >= session.aiBotMaxMissedReplies

          const updated: AIBotChipProgress = {
            ...currentProgress,
            aiBotWaitingReplySince: null,
            aiBotMissedCount: newMissedCount,
            aiBotConversationEnded: shouldEnd,
            aiBotConversationEndedAt: shouldEnd ? new Date().toISOString() : currentProgress.aiBotConversationEndedAt ?? null,
          }

          chipProgress[chipId] = updated
          dirty = true

          console.log(`[AIBotWarming] Timeout for chip ${chipId} in session ${session.id} — missed=${newMissedCount}, ended=${shouldEnd}`)
        }
      }

      if (dirty) {
        await db.warmingSession.update({
          where: { id: session.id },
          data: { chipProgress: JSON.stringify(chipProgress) },
        })
      }
    } catch (error) {
      console.error(`[AIBotWarming] checkAIBotTimeouts failed for session ${session.id}:`, error)
    }
  }
}

/**
 * Processa a próxima mensagem de uma sessão ai_bot.
 *
 * Lógica:
 * 1. Carrega sessão e valida (status=running, aiBotPhoneNumber preenchido)
 * 2. Verifica sending window e break windows (anti-ban)
 * 3. Para cada chip elegível (não em waitingReply, não encerrado hoje, respeita intervalo, dentro do limite):
 *    a. Sorteia categoria (≠ última) + mensagem dentro da categoria
 *    b. Performa presença humanizada (typing)
 *    c. Envia mensagem pro Duda
 *    d. Marca waitingReplySince = now
 * 4. Atualiza chipProgress e persiste
 *
 * @returns Resultado com processed (enviou?), delayMs (próximo intervalo), completed, reason
 */
export async function processNextAIBotMessage(
  sessionId: string
): Promise<{ processed: boolean; delayMs: number; completed: boolean; reason?: string }> {
  const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
  if (!session) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'session_not_found' }
  }

  if (session.status !== 'running') {
    return { processed: false, delayMs: 60000, completed: false, reason: 'session_not_running' }
  }

  if (session.strategy !== 'ai_bot') {
    return { processed: false, delayMs: 60000, completed: false, reason: 'not_ai_bot_strategy' }
  }

  // Valida número do bot
  const botPhoneRaw = session.aiBotPhoneNumber
  if (!botPhoneRaw || !isValidPhoneNumber(botPhoneRaw)) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'ai_bot_phone_not_configured' }
  }

  // Carrega anti-ban settings
  const antiBanSettings = await loadAntiBanSettings()

  // Verifica sending window
  if (!isWithinSendingWindow(session.activeHoursStart, session.activeHoursEnd, session.timezone)) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'outside_sending_window' }
  }

  // Verifica break windows
  const breakWindows: WarmingBreakWindow[] = parseJsonField(session.breakWindows, [])
  const activeBreak = getActiveBreakWindow(breakWindows, session.timezone)
  if (activeBreak) {
    return { processed: false, delayMs: 60000, completed: false, reason: `break_window_${activeBreak.label}` }
  }

  // Carrega chips participantes
  const chipIds: string[] = parseJsonField(session.chipIds, [])
  if (chipIds.length === 0) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'no_chips' }
  }

  const chips = await db.chip.findMany({
    where: { id: { in: chipIds } },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      evolutionInstance: true,
      status: true,
      warmingPhase: true,
      warmingEnabled: true,
      dailyLimit: true,
      warmingStartedAt: true,
      createdAt: true,
      sentToday: true,
      nextSendAt: true,
      paused: true,
      pausedUntil: true,
    },
  })

  const now = Date.now()
  const chipProgress = parseJsonField<Record<string, WarmingChipProgress>>(session.chipProgress, {})

  // Intervalo mínimo entre mensagens (anti-ban)
  const intervalMin = session.intervalMin || antiBanSettings?.messageIntervalMin || 45
  const intervalMax = session.intervalMax || antiBanSettings?.messageIntervalMax || 120
  const intervalMinMs = intervalMin * 1000

  // Carrega pool
  const pool = await getPoolByCategory()
  if (pool.size === 0) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'pool_empty' }
  }

  // Itera chips procurando um elegível pra enviar agora
  for (const chip of chips) {
    const chipId = chip.id

    // Pula chip desconectado
    if (chip.status !== 'connected') continue
    if (!chip.evolutionInstance) continue
    if (!chip.phoneNumber || !isValidPhoneNumber(chip.phoneNumber)) continue

    // Pula chip pausado
    if (chip.paused) {
      if (chip.pausedUntil && new Date(chip.pausedUntil) > new Date()) continue
    }

    // Carrega progress e aplica reset diário se necessário
    let progress = ensureAIBotFields(chipProgress[chipId])
    progress = maybeResetDailyState(progress)

    // Pula chip com conversa encerrada hoje
    if (progress.aiBotConversationEnded) continue

    // Pula chip que está esperando reply (ainda dentro do timeout)
    if (progress.aiBotWaitingReplySince) {
      const waitingMs = now - new Date(progress.aiBotWaitingReplySince).getTime()
      if (waitingMs < session.aiBotReplyTimeoutSec * 1000) continue
      // Se passou do timeout, o checkAIBotTimeouts já deveria ter limpado;
      // mas por segurança, também limpamos aqui
      progress.aiBotWaitingReplySince = null
      progress.aiBotMissedCount = (progress.aiBotMissedCount ?? 0) + 1
      if (progress.aiBotMissedCount >= session.aiBotMaxMissedReplies) {
        progress.aiBotConversationEnded = true
        progress.aiBotConversationEndedAt = new Date().toISOString()
        chipProgress[chipId] = progress
        continue
      }
    }

    // Pula chip se não respeitou intervalo mínimo desde último envio
    if (progress.lastSentAt) {
      const sinceLastMs = now - new Date(progress.lastSentAt).getTime()
      if (sinceLastMs < intervalMinMs) {
        // Ainda não pode enviar — próximo chip
        continue
      }
    }

    // Pula chip se atingiu limite diário da fase
    const limitInfo = await getChipEffectiveDailyLimit(chip, antiBanSettings)
    if (limitInfo.remaining <= 0) continue

    // Pula chip se atingiu meta de mensagensPerChip
    if (progress.sent >= session.messagesPerChip) continue

    // Pula chip se tem nextSendAt no futuro (anti-ban persistido entre invocações)
    if (chip.nextSendAt && new Date(chip.nextSendAt) > new Date()) continue

    // ============================================================
    // CHIP ELEGÍVEL — SORTear MENSAGEM E ENVIAR
    // ============================================================

    const category = pickCategory(pool, progress.aiBotLastCategory ?? null)
    if (!category) {
      return { processed: false, delayMs: 60000, completed: false, reason: 'no_category_available' }
    }

    const categoryMessages = pool.get(category)!
    const pickedMessage = pickMessageFromCategory(categoryMessages)
    if (!pickedMessage) {
      return { processed: false, delayMs: 60000, completed: false, reason: 'no_message_in_category' }
    }

    const content = pickedMessage.content

    // ============================================================
    // ENVIO COM PRESENÇA HUMANIZADA (igual estratégia atual)
    // ============================================================
    const instanceName = chip.evolutionInstance
    const formattedPhone = formatPhoneNumber(botPhoneRaw)
    const jid = `${formattedPhone}@s.whatsapp.net`

    try {
      // Performa presença: available → composing → send
      await performWarmingPresence(instanceName, jid, 'text', content, antiBanSettings)

      // Envia mensagem de texto
      await sendTextMessage(instanceName, formattedPhone, content, {
        delay: 0,
        linkPreview: antiBanSettings?.linkPreviewEnabled ?? false,
      })

      // Fica offline com jitter (igual humano que sai do chat)
      await delayedOfflineWithJitter(instanceName, jid, antiBanSettings)

      // Atualiza progresso do chip
      const nowIso = new Date().toISOString()
      const updatedProgress: AIBotChipProgress = {
        ...progress,
        sent: progress.sent + 1,
        lastSentAt: nowIso,
        aiBotLastCategory: category,
        aiBotWaitingReplySince: nowIso,
      }

      chipProgress[chipId] = updatedProgress

      // Atualiza chip: incrementa sentToday e marca nextSendAt
      const nextDelaySec = Math.max(
        intervalMin,
        Math.round(gaussianRandom((intervalMin + intervalMax) / 2, (intervalMax - intervalMin) / 6, intervalMin, intervalMax))
      )
      const nextSendAt = new Date(now + nextDelaySec * 1000)

      await db.chip.update({
        where: { id: chipId },
        data: {
          sentToday: { increment: 1 },
          nextSendAt,
        },
      })

      // Persiste session
      await db.warmingSession.update({
        where: { id: sessionId },
        data: {
          messagesSent: { increment: 1 },
          lastMessageAt: new Date(),
          chipProgress: JSON.stringify(chipProgress),
        },
      })

      console.debug(`[AIBotWarming] ${chip.name} → Duda (${botPhoneRaw}): [${category}] "${content.substring(0, 50)}..." (sent: ${updatedProgress.sent})`)

      return {
        processed: true,
        delayMs: nextDelaySec * 1000,
        completed: false,
      }
    } catch (error: any) {
      console.error(`[AIBotWarming] Send failed for chip ${chip.name} → Duda:`, error.message)

      // Incrementa errorCount da session
      await db.warmingSession.update({
        where: { id: sessionId },
        data: {
          errorCount: { increment: 1 },
          messagesFailed: { increment: 1 },
          lastError: `ai_bot_send_failed: ${error.message?.substring(0, 200) || 'unknown'}`,
        },
      })

      // Auto-pausa se atingir warmingAutoPauseErrors
      const autoPauseThreshold = antiBanSettings?.warmingAutoPauseErrors ?? 10
      if (session.errorCount + 1 >= autoPauseThreshold) {
        await db.warmingSession.update({
          where: { id: sessionId },
          data: {
            status: 'paused',
            pausedAt: new Date(),
            lastError: `auto_paused_errors: ${session.errorCount + 1} errors`,
          },
        })
        return { processed: false, delayMs: 60000, completed: false, reason: 'auto_paused_errors' }
      }

      return { processed: false, delayMs: 15000, completed: false, reason: 'send_failed' }
    }
  }

  // Nenhum chip elegível neste tick
  // Determina o motivo para debug
  const allChipsEnded = chips.every(c => {
    const p = ensureAIBotFields(chipProgress[c.id])
    return p.aiBotConversationEnded
  })

  if (allChipsEnded && chips.length > 0) {
    return { processed: false, delayMs: 60000, completed: false, reason: 'all_chips_conversation_ended_today' }
  }

  const allChipsWaiting = chips.every(c => {
    const p = ensureAIBotFields(chipProgress[c.id])
    return p.aiBotWaitingReplySince !== null && p.aiBotWaitingReplySince !== undefined
  })

  if (allChipsWaiting && chips.length > 0) {
    return { processed: false, delayMs: 30000, completed: false, reason: 'all_chips_waiting_reply' }
  }

  // Verifica se todos chips atingiram messagesPerChip
  const allChipsAtTarget = chips.every(c => {
    const p = chipProgress[c.id]
    return p && p.sent >= session.messagesPerChip
  })

  if (allChipsAtTarget && chips.length > 0) {
    // Marca session como completed
    await db.warmingSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    })
    return { processed: false, delayMs: 60000, completed: true, reason: 'all_chips_target_reached' }
  }

  // Caso geral: algum chip ainda em cooldown/intervalo
  return { processed: false, delayMs: 30000, completed: false, reason: 'no_eligible_chip' }
}

/**
 * Processa todas as sessões ai_bot ativas.
 * Chamado por processAllWarmingSessions() do warming-engine.
 *
 * @returns Estatísticas agregadas
 */
export async function processAllAIBotSessions(): Promise<{
  sessions: number
  messagesSent: number
  errors: number
}> {
  // Busca sessões ai_bot ativas
  const sessions = await db.warmingSession.findMany({
    where: {
      status: 'running',
      strategy: 'ai_bot',
    },
    select: {
      id: true,
      aiBotReplyTimeoutSec: true,
      aiBotMaxMissedReplies: true,
      chipProgress: true,
      chipIds: true,
    },
  })

  if (sessions.length === 0) {
    return { sessions: 0, messagesSent: 0, errors: 0 }
  }

  // 1. Verifica timeouts primeiro (marca missed/encerra conversa)
  await checkAIBotTimeouts(sessions)

  // 2. Processa próxima mensagem de cada sessão
  let totalSent = 0
  let totalErrors = 0

  for (const session of sessions) {
    for (let attempt = 0; attempt < MAX_MESSAGES_PER_TICK; attempt++) {
      try {
        const result = await processNextAIBotMessage(session.id)

        if (result.processed) {
          totalSent++
        } else if (result.completed) {
          break // Sessão completou
        }

        // Espera o delay se for curto (< 30s), senão sai e próximo tick continua
        if (result.delayMs > 0) {
          const maxWaitMs = 30000
          if (result.delayMs <= maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, result.delayMs))
          } else {
            break
          }
        }

        // Para em razões hard-block
        if (['outside_sending_window', 'all_chips_conversation_ended_today', 'auto_paused_errors', 'pool_empty'].some(r => result.reason?.includes(r))) {
          break
        }
      } catch (error: any) {
        console.error(`[AIBotWarming] Error processing session ${session.id}:`, error.message)
        totalErrors++
        break
      }
    }
  }

  return { sessions: sessions.length, messagesSent: totalSent, errors: totalErrors }
}
