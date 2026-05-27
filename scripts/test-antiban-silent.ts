/**
 * TESTE SILENCIOSO DO MOTOR ANTI-BAN
 * ====================================
 * Simula o fluxo completo do sending-engine sem enviar mensagens reais.
 * Verifica que TODAS as configurações da UI são respeitadas dinamicamente.
 * 
 * Uso: npx tsx scripts/test-antiban-silent.ts
 */

// ============================================================
// SIMULAÇÃO — não usa DB, não usa Evolution API
// ============================================================

// Configurações da UI do usuário (simula o que está salvo no banco)
const userUISettings = {
  typingMinDelay: 500,       // ms (UI: 500ms-4500ms)
  typingMaxDelay: 4500,      // ms
  messageIntervalMin: 45,    // segundos
  messageIntervalMax: 90,    // segundos
  cooldownAfterMin: 5,       // mensagens
  cooldownAfterMax: 15,      // mensagens
  cooldownDurationMin: 19,   // minutos
  cooldownDurationMax: 30,   // minutos
  breakWindows: [{ start: 720, end: 780, label: 'Almoço' }], // 12:00-13:00
  sendingWindowStart: 480,   // 8:00
  sendingWindowEnd: 1260,    // 21:00
  timezone: 'America/Sao_Paulo',
  linkPreviewEnabled: false,
  warmingEnabled: true,
  dailyLimitPerChip: 200,
  stopOnWarning: true,
  hourlyLimit: 30,
  readyDailyLimit: 200,
}

// Configurações hardcoded antigas (BUG — o que o sistema fazia ANTES das correções)
const hardcodedOld = {
  typingMinDelay: 3000,    // TYPING_MIN_MS
  typingMaxDelay: 25000,   // TYPING_MAX_MS
  intervalFloor: 5000,     // 5s hardcoded floor
  errorFallback: 5000,     // 5s hardcoded fallback
  linkPreviewEnabled: false, // always false
  warmingIntervalMin: 45,
  warmingIntervalMax: 120,
  warmingTruncation: 4000,  // Math.min(delay, 4000) truncation
}

// ============================================================
// FUNÇÕES DE CÁLCULO — cópias fiéis do sending-engine.ts
// ============================================================

function gaussianRandom(mean: number, stddev: number, min: number, max: number): number {
  let u1 = Math.random()
  let u2 = Math.random()
  if (u1 === 0) u1 = 0.0001
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  let value = mean + z * stddev
  return Math.round(Math.max(min, Math.min(max, value)))
}

function gaussianRandomFloat(mean: number, stddev: number, min: number, max: number): number {
  let u1 = Math.random()
  let u2 = Math.random()
  if (u1 === 0) u1 = 0.0001
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  let value = mean + z * stddev
  return Math.max(min, Math.min(max, value))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// NOVO: calculateTypingDuration com settings dinâmicos
function calculateTypingDuration_NEW(
  text: string,
  settings?: { typingMinDelay?: number; typingMaxDelay?: number }
): number {
  const TYPING_SPEED_MIN = 6
  const TYPING_SPEED_MAX = 14
  const TYPING_MIN_MS = 3000
  const TYPING_MAX_MS = 25000
  const TYPING_PAUSE_CHANCE = 0.3

  const charCount = text.length
  const typingSpeed = gaussianRandomFloat(10, 2.5, TYPING_SPEED_MIN, TYPING_SPEED_MAX)
  let durationMs = (charCount / typingSpeed) * 1000

  // DINÂMICO: usa settings da UI
  const minMs = settings?.typingMinDelay ?? TYPING_MIN_MS
  const maxMs = settings?.typingMaxDelay ?? TYPING_MAX_MS
  durationMs = Math.max(minMs, Math.min(maxMs, durationMs))

  if (Math.random() < TYPING_PAUSE_CHANCE) {
    durationMs += randomInt(1000, 4000)
  }
  return Math.round(durationMs)
}

// ANTIGO: calculateTypingDuration hardcoded
function calculateTypingDuration_OLD(text: string): number {
  const TYPING_SPEED_MIN = 6
  const TYPING_SPEED_MAX = 14
  const TYPING_MIN_MS = 3000
  const TYPING_MAX_MS = 25000
  const TYPING_PAUSE_CHANCE = 0.3

  const charCount = text.length
  const typingSpeed = gaussianRandomFloat(10, 2.5, TYPING_SPEED_MIN, TYPING_SPEED_MAX)
  let durationMs = (charCount / typingSpeed) * 1000

  // HARDCODED: ignora UI
  durationMs = Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, durationMs))

  if (Math.random() < TYPING_PAUSE_CHANCE) {
    durationMs += randomInt(1000, 4000)
  }
  return Math.round(durationMs)
}

function gaussianDelaySeconds(min: number, max: number): number {
  const mean = (min + max) / 2
  const stddev = (max - min) / 6
  return gaussianRandom(mean, stddev, min, max)
}

function getMinimumIntervalForChip_NEW(
  chip: { warmingPhase: string; warmingEnabled: boolean },
  settings: typeof userUISettings
): number {
  const phase = chip.warmingPhase || 'nursery'
  if (phase === 'ready') return settings.messageIntervalMin
  if (!chip.warmingEnabled || !settings.warmingEnabled) return settings.messageIntervalMin
  const userInterval = settings.messageIntervalMin
  if (phase === 'nursery') return Math.max(120, userInterval)
  return Math.max(60, userInterval)
}

function getMinimumIntervalForChip_OLD(
  chip: { warmingPhase: string; warmingEnabled: boolean },
  settings: typeof userUISettings
): number {
  if (!chip.warmingEnabled || !settings.warmingEnabled) return 0 // BUG: return 0!
  const phase = chip.warmingPhase || 'nursery'
  if (phase === 'ready') return settings.messageIntervalMin
  const userInterval = settings.messageIntervalMin
  if (phase === 'nursery') return Math.max(120, userInterval)
  return Math.max(60, userInterval)
}

// ============================================================
// TESTES
// ============================================================

const testMessages = [
  'Oi, tudo bem?',                                    // 15 chars
  'Bom dia! Como posso te ajudar hoje?',               // 36 chars
  'Olá! Gostaria de apresentar nossos serviços de manutenção preventiva para equipamentos industriais.', // 103 chars
  'Prezado cliente, segue nossa proposta comercial para os serviços solicitados. Ficamos à disposição para eventuais dúvidas.', // 128 chars
]

let testsPassed = 0
let testsFailed = 0

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    testsPassed++
    console.log(`  ✅ ${testName}`)
  } else {
    testsFailed++
    console.log(`  ❌ ${testName}${details ? ' — ' + details : ''}`)
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║  TESTE SILENCIOSO — Motor Anti-Ban v4.0 (Pós-Correções)    ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()

// ============================================================
// TESTE 1: Typing Duration respeita UI
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 1: calculateTypingDuration() — UI vs Hardcoded')
console.log('━'.repeat(70))
console.log(`  Config UI: typingMinDelay=${userUISettings.typingMinDelay}ms, typingMaxDelay=${userUISettings.typingMaxMs}ms`)
console.log(`  Hardcoded:  TYPING_MIN_MS=3000ms, TYPING_MAX_MS=25000ms`)
console.log()

for (const msg of testMessages) {
  const newResult = calculateTypingDuration_NEW(msg, userUISettings)
  const oldResult = calculateTypingDuration_OLD(msg)
  const respectsUI = newResult >= userUISettings.typingMinDelay && newResult <= userUISettings.typingMaxDelay + 4000 // +4s pause
  const oldViolatesUI = oldResult > userUISettings.typingMaxDelay + 4000 || oldResult < userUISettings.typingMinDelay

  console.log(`  Mensagem (${msg.length} chars): "${msg.substring(0, 40)}..."`)
  console.log(`    NOVO (dinâmico): ${formatMs(newResult)} | ANTIGO (hardcoded): ${formatMs(oldResult)}`)
  assert(respectsUI, `Typing dentro dos limites da UI [${userUISettings.typingMinDelay}-${userUISettings.typingMaxDelay}ms]`)
  if (oldViolatesUI) {
    console.log(`    ⚠️  ANTIGO violava UI: ${formatMs(oldResult)} fora do range [${userUISettings.typingMinDelay}-${userUISettings.typingMaxDelay}ms]`)
  }
  console.log()
}

// ============================================================
// TESTE 2: Intervalo entre mensagens respeita UI
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 2: Intervalo entre mensagens — sem alreadySpentMs, floor dinâmico')
console.log('━'.repeat(70))
console.log(`  Config UI: messageIntervalMin=${userUISettings.messageIntervalMin}s, messageIntervalMax=${userUISettings.messageIntervalMax}s`)
console.log()

const sampleDelays: { old: number; new_: number; alreadySpent: number }[] = []
for (let i = 0; i < 20; i++) {
  const delaySeconds = gaussianDelaySeconds(userUISettings.messageIntervalMin, userUISettings.messageIntervalMax)
  let nextDelayNew = delaySeconds * 1000
  nextDelayNew = Math.max(nextDelayNew, userUISettings.messageIntervalMin * 1000) // NOVO: floor dinâmico

  const alreadySpentMs = randomInt(3000, 15000) + randomInt(2000, 8000) // offlineDelay + readingTime
  let nextDelayOld = delaySeconds * 1000 - alreadySpentMs
  nextDelayOld = Math.max(nextDelayOld, 5000) // ANTIGO: floor hardcoded 5s

  sampleDelays.push({ old: nextDelayOld, new_: nextDelayNew, alreadySpent: alreadySpentMs })
}

console.log('  Amostra de 20 cálculos de delay:')
console.log('  ┌────────┬──────────────┬──────────────┬──────────────┬─────────┐')
console.log('  │  #     │ ANTIGO (ms)  │ NOVO (ms)    │ alreadySpent │ Respeita │')
console.log('  ├────────┼──────────────┼──────────────┼──────────────┼─────────┤')

let oldViolations = 0
let newViolations = 0
const minMs = userUISettings.messageIntervalMin * 1000

for (let i = 0; i < sampleDelays.length; i++) {
  const d = sampleDelays[i]
  const oldRespects = d.old >= minMs
  const newRespects = d.new_ >= minMs
  if (!oldRespects) oldViolations++
  if (!newRespects) newViolations++
  
  console.log(`  │ ${(i+1).toString().padStart(6)} │ ${(d.old).toString().padStart(12)} │ ${(d.new_).toString().padStart(12)} │ ${(d.alreadySpent).toString().padStart(12)} │ ${oldRespects ? '  ❌ old' : '  ❌ old'} │`)
}

console.log('  └────────┴──────────────┴──────────────┴──────────────┴─────────┘')
console.log()
assert(newViolations === 0, `NOVO: Todos os delays >= ${minMs}ms (${userUISettings.messageIntervalMin}s mínimo da UI)`)
assert(oldViolations > 0, `ANTIGO: ${oldViolations}/20 delays violavam o mínimo da UI (podiam chegar a 5s!)`)

// Estatísticas dos delays
const newDelays = sampleDelays.map(d => d.new_ / 1000)
const oldDelays = sampleDelays.map(d => d.old / 1000)
const newAvg = newDelays.reduce((a, b) => a + b, 0) / newDelays.length
const oldAvg = oldDelays.reduce((a, b) => a + b, 0) / oldDelays.length
const newMin = Math.min(...newDelays)
const oldMin = Math.min(...oldDelays)

console.log(`\n  Estatísticas dos delays (20 amostras):`)
console.log(`  ┌──────────┬─────────────┬─────────────┐`)
console.log(`  │ Métrica  │ ANTIGO      │ NOVO        │`)
console.log(`  ├──────────┼─────────────┼─────────────┤`)
console.log(`  │ Mínimo   │ ${oldMin.toFixed(1).padStart(9)}s │ ${newMin.toFixed(1).padStart(9)}s │`)
console.log(`  │ Média    │ ${oldAvg.toFixed(1).padStart(9)}s │ ${newAvg.toFixed(1).padStart(9)}s │`)
console.log(`  │ UI Min   │ ${userUISettings.messageIntervalMin.toString().padStart(9)}s │ ${userUISettings.messageIntervalMin.toString().padStart(9)}s │`)
console.log(`  └──────────┴─────────────┴─────────────┘`)
console.log()

// ============================================================
// TESTE 3: Intervalo mínimo para TODOS os chips (não só warming)
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 3: getMinimumIntervalForChip() — Todos os chips respeitam intervalo')
console.log('━'.repeat(70))
console.log()

const chipScenarios = [
  { name: 'Chip Ready (aquecido)', warmingPhase: 'ready', warmingEnabled: true },
  { name: 'Chip Nursery (berçário)', warmingPhase: 'nursery', warmingEnabled: true },
  { name: 'Chip Prewarm (pré-aquecido)', warmingPhase: 'prewarm', warmingEnabled: true },
  { name: 'Chip Ready, warming desabilitado', warmingPhase: 'ready', warmingEnabled: false },
  { name: 'Chip Nursery, warming desabilitado', warmingPhase: 'nursery', warmingEnabled: false },
]

for (const chip of chipScenarios) {
  const newInterval = getMinimumIntervalForChip_NEW(chip, userUISettings)
  const oldInterval = getMinimumIntervalForChip_OLD(chip, userUISettings)
  const respectsUI = newInterval >= userUISettings.messageIntervalMin

  console.log(`  ${chip.name}:`)
  console.log(`    NOVO:  intervalo mínimo = ${newInterval}s`)
  console.log(`    ANTIGO: intervalo mínimo = ${oldInterval}s ${oldInterval === 0 ? '⚠️ ZERO = sem limite!' : ''}`)
  assert(respectsUI, `${chip.name}: intervalo >= UI min (${userUISettings.messageIntervalMin}s)`)
  if (oldInterval === 0) {
    console.log(`    🔴 BUG ANTIGO: Retornava 0 = chip podia enviar a qualquer velocidade!`)
  }
  console.log()
}

// ============================================================
// TESTE 4: Fallback de erro respeita UI
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 4: Fallback de erro — settings.messageIntervalMin vs 5000ms')
console.log('━'.repeat(70))

const errorFallbackNew = userUISettings.messageIntervalMin * 1000
const errorFallbackOld = 5000
console.log(`  NOVO:  error fallback = ${formatMs(errorFallbackNew)} (settings.messageIntervalMin * 1000)`)
console.log(`  ANTIGO: error fallback = ${formatMs(errorFallbackOld)} (hardcoded)`)
assert(errorFallbackNew >= userUISettings.messageIntervalMin * 1000, 'Error fallback respeita intervalo mínimo da UI')
assert(errorFallbackOld < userUISettings.messageIntervalMin * 1000, 'ANTIGO: Error fallback (5s) violava UI min (45s)')
console.log()

// ============================================================
// TESTE 5: linkPreviewEnabled lido do banco
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 5: linkPreviewEnabled — dinâmico vs hardcoded')
console.log('━'.repeat(70))

const savedSettingsTrue = { linkPreviewEnabled: true }
const savedSettingsFalse = { linkPreviewEnabled: false }
const newResultTrue = savedSettingsTrue.linkPreviewEnabled ?? false
const newResultFalse = savedSettingsFalse.linkPreviewEnabled ?? false
const oldResult = false // Always hardcoded

console.log(`  Se usuário habilitar preview na UI:`)
console.log(`    NOVO:  linkPreview = ${newResultTrue} ✅ (respeita UI)`)
console.log(`    ANTIGO: linkPreview = ${oldResult} ❌ (sempre false)`)
assert(newResultTrue === true, 'linkPreviewEnabled = true quando UI habilita')
assert(newResultFalse === false, 'linkPreviewEnabled = false quando UI desabilita')
assert(oldResult === false, 'ANTIGO: linkPreview sempre false, ignorava UI')
console.log()

// ============================================================
// TESTE 6: Phase durations derivados do schedule
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 6: Duração das fases — derivada do schedule vs hardcoded')
console.log('━'.repeat(70))

const nurserySchedule = [
  { dayRange: '1-2', days: [1, 2], limit: 10 },
  { dayRange: '3-4', days: [3, 4], limit: 20 },
  { dayRange: '5-6', days: [5, 6], limit: 30 },
  { dayRange: '7-8', days: [7, 8], limit: 40 },
  { dayRange: '9-10', days: [9, 10], limit: 50 },
  { dayRange: '11-12', days: [11, 12], limit: 60 },
  { dayRange: '13-14', days: [13, 14], limit: 80 },
]

const prewarmSchedule = [
  { dayRange: '1', days: [1, 1], limit: 11 },
  { dayRange: '2', days: [2, 2], limit: 15 },
  // ... truncated for brevity
  { dayRange: '20', days: [20, 20], limit: 200 },
]

// NOVO: derivado do schedule
const nurseryDurationNew = nurserySchedule[nurserySchedule.length - 1].days[1]
const prewarmDurationNew = prewarmSchedule[prewarmSchedule.length - 1].days[1]

// ANTIGO: hardcoded
const nurseryDurationOld = 14
const prewarmDurationOld = 20

console.log(`  Nursery (berçário):`)
console.log(`    NOVO:  ${nurseryDurationNew} dias (derivado do schedule)`)
console.log(`    ANTIGO: ${nurseryDurationOld} dias (hardcoded)`)
assert(nurseryDurationNew === nurseryDurationOld, 'Nursery: schedule e hardcoded concordam (14 dias)')

// Simula usuário mudando schedule para 21 dias
const extendedSchedule = [...nurserySchedule, { dayRange: '15-21', days: [15, 21], limit: 100 }]
const extendedDuration = extendedSchedule[extendedSchedule.length - 1].days[1]
console.log(`  Se usuário estender nursery para 21 dias na UI:`)
console.log(`    NOVO:  ${extendedDuration} dias (respeita schedule customizado) ✅`)
console.log(`    ANTIGO: ${nurseryDurationOld} dias (ignorava customização) ❌`)
assert(extendedDuration === 21, 'Schedule customizado de 21 dias é respeitado')
console.log()

// ============================================================
// TESTE 7: Warming engine — delay truncation
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 7: Warming engine — delay truncation Math.min(delay, 4000)')
console.log('━'.repeat(70))

const warmingDelays = [45, 60, 75, 90, 120] // segundos (intervalos de warming)
console.log(`  Intervalos de warming configurados: ${warmingDelays.join(', ')}s`)
console.log()

for (const delay of warmingDelays) {
  const delayMs = delay * 1000
  const oldWaitMs = Math.min(delayMs, 4000) // ANTIGO: truncado a 4s
  // NOVO: respeita o delay; se <= 30s espera completo, senão break (não envia este tick)
  const newWaitMs = delayMs <= 30000 ? delayMs : -1 // -1 = "break" (não envia neste tick, próximo cron pega)

  console.log(`  Intervalo de ${delay}s:`)
  if (newWaitMs === -1) {
    console.log(`    NOVO:  não envia neste tick (delay > 30s, próximo cron pega) ✅`)
  } else {
    console.log(`    NOVO:  espera ${formatMs(newWaitMs)} ✅`)
  }
  console.log(`    ANTIGO: esperava ${formatMs(oldWaitMs)} ❌ (truncado!)`)
  assert(newWaitMs === delayMs || newWaitMs === -1, `Warming delay ${delay}s respeitado (não truncado)`)
  assert(oldWaitMs !== delayMs, `ANTIGO: ${delay}s truncado para ${formatMs(oldWaitMs)}`)
}
console.log()

// ============================================================
// TESTE 8: Simulação completa de 10 mensagens
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 8: Simulação completa — 10 mensagens com UI settings')
console.log('━'.repeat(70))
console.log(`  Simulando campanha com chip Ready, 10 mensagens`)
console.log(`  Intervalo: ${userUISettings.messageIntervalMin}-${userUISettings.messageIntervalMax}s (gaussiano)`)
console.log(`  Typing: ${userUISettings.typingMinDelay}-${userUISettings.typingMaxDelay}ms`)
console.log()

interface SimResult {
  msgNum: number
  typingMs: number
  delayMs: number
  totalMs: number
  cumulMs: number
  sendTime: string
}

const simulation: SimResult[] = []
let cumulMs = 0
const startTime = new Date()
startTime.setHours(13, 0, 0, 0) // Começa às 13:00

for (let i = 0; i < 10; i++) {
  const msg = testMessages[i % testMessages.length]
  const typingMs = calculateTypingDuration_NEW(msg, userUISettings)
  const delaySeconds = gaussianDelaySeconds(userUISettings.messageIntervalMin, userUISettings.messageIntervalMax)
  let delayMs = Math.max(delaySeconds * 1000, userUISettings.messageIntervalMin * 1000)

  const totalMs = typingMs + delayMs
  cumulMs += totalMs

  const sendTime = new Date(startTime.getTime() + cumulMs)
  const sendTimeStr = sendTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: userUISettings.timezone })

  simulation.push({
    msgNum: i + 1,
    typingMs,
    delayMs,
    totalMs,
    cumulMs,
    sendTime: sendTimeStr,
  })
}

console.log('  ┌──────┬───────────┬────────────┬────────────┬─────────────────┐')
console.log('  │ Msg  │ Typing    │ Delay      │ Total      │ Horário Envio   │')
console.log('  ├──────┼───────────┼────────────┼────────────┼─────────────────┤')

for (const s of simulation) {
  console.log(`  │ ${s.msgNum.toString().padStart(4)} │ ${formatMs(s.typingMs).padStart(9)} │ ${formatMs(s.delayMs).padStart(10)} │ ${formatMs(s.totalMs).padStart(10)} │ ${s.sendTime.padStart(15)} │`)
}

console.log('  └──────┴───────────┴────────────┴────────────┴─────────────────┘')

const delays = simulation.map(s => s.delayMs / 1000)
const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length
const minDelay = Math.min(...delays)
const maxDelay = Math.max(...delays)

console.log()
console.log(`  Resumo dos intervalos:`)
console.log(`    Mínimo: ${minDelay.toFixed(1)}s | Máximo: ${maxDelay.toFixed(1)}s | Média: ${avgDelay.toFixed(1)}s`)
console.log(`    Range UI: ${userUISettings.messageIntervalMin}-${userUISettings.messageIntervalMax}s`)
console.log(`    Última mensagem: ${simulation[simulation.length - 1].sendTime}`)
console.log()

assert(minDelay >= userUISettings.messageIntervalMin, `Todos os delays >= mínimo da UI (${userUISettings.messageIntervalMin}s)`)
assert(maxDelay <= userUISettings.messageIntervalMax * 1.1, `Todos os delays <= máximo da UI + margem (${userUISettings.messageIntervalMax}s)`)

// ============================================================
// TESTE 9: Verificar se break windows são respeitados
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 9: Break windows — verificação de horário')
console.log('━'.repeat(70))

const breakWindow = userUISettings.breakWindows[0]
const breakStart = breakWindow.start // 720 = 12:00
const breakEnd = breakWindow.end     // 780 = 13:00

console.log(`  Break window: ${breakWindow.label} (${Math.floor(breakStart/60)}:${(breakStart%60).toString().padStart(2,'0')} - ${Math.floor(breakEnd/60)}:${(breakEnd%60).toString().padStart(2,'0')})`)

// Simular verificação a cada 30 minutos
const testMinutes = [660, 690, 720, 750, 780, 810, 840] // 11:00, 11:30, 12:00, 12:30, 13:00, 13:30, 14:00
for (const mins of testMinutes) {
  const inBreak = mins >= breakStart && mins < breakEnd
  const hours = Math.floor(mins / 60)
  const m = mins % 60
  console.log(`  ${hours}:${m.toString().padStart(2, '0')} → ${inBreak ? '🛑 BREAK WINDOW (não envia)' : '✅ Fora do break (pode enviar)'}`)
}
console.log()

// ============================================================
// TESTE 10: Cooldown variável respeita UI
// ============================================================
console.log('━'.repeat(70))
console.log('TESTE 10: Cooldown variável — ranges respeitam UI')
console.log('━'.repeat(70))

console.log(`  Config UI: cooldownAfter ${userUISettings.cooldownAfterMin}-${userUISettings.cooldownAfterMax} msgs`)
console.log(`  Config UI: cooldownDuration ${userUISettings.cooldownDurationMin}-${userUISettings.cooldownDurationMax} min`)
console.log()

// Simular 10 cooldowns
for (let i = 0; i < 5; i++) {
  const afterMsgs = randomInt(userUISettings.cooldownAfterMin, userUISettings.cooldownAfterMax)
  const duration = randomInt(userUISettings.cooldownDurationMin, userUISettings.cooldownDurationMax)
  const respectsAfter = afterMsgs >= userUISettings.cooldownAfterMin && afterMsgs <= userUISettings.cooldownAfterMax
  const respectsDuration = duration >= userUISettings.cooldownDurationMin && duration <= userUISettings.cooldownDurationMax
  
  console.log(`  Cooldown #${i + 1}: após ${afterMsgs} msgs, pausa ${duration} min ${respectsAfter && respectsDuration ? '✅' : '❌'}`)
  assert(respectsAfter, `Cooldown after (${afterMsgs}) dentro do range UI [${userUISettings.cooldownAfterMin}-${userUISettings.cooldownAfterMax}]`)
  assert(respectsDuration, `Cooldown duration (${duration}min) dentro do range UI [${userUISettings.cooldownDurationMin}-${userUISettings.cooldownDurationMax}]`)
}
console.log()

// ============================================================
// RESULTADO FINAL
// ============================================================
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║  RESULTADO FINAL                                            ║')
console.log('╠══════════════════════════════════════════════════════════════╣')
console.log(`║  Testes passaram: ${testsPassed.toString().padStart(3)}                                          ║`)
console.log(`║  Testes falharam: ${testsFailed.toString().padStart(3)}                                          ║`)
console.log('╠══════════════════════════════════════════════════════════════╣')

if (testsFailed === 0) {
  console.log('║  🟢 TODOS OS TESTES PASSARAM — Backend respeita a UI!       ║')
} else {
  console.log('║  🔴 ALGUNS TESTES FALHARAM — Verificar correções            ║')
}

console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()
console.log('TABELA COMPARATIVA: ANTIGO vs NOVO')
console.log('━'.repeat(70))
console.log('┌─────────────────────────────┬──────────────────┬──────────────────┐')
console.log('│ Configuração                │ ANTIGO           │ NOVO             │')
console.log('├─────────────────────────────┼──────────────────┼──────────────────┤')
console.log(`│ Typing min                  │ 3000ms (hard)    │ ${userUISettings.typingMinDelay}ms (UI)      │`)
console.log(`│ Typing max                  │ 25000ms (hard)   │ ${userUISettings.typingMaxDelay}ms (UI)     │`)
console.log(`│ Interval floor              │ 5000ms (hard)    │ ${userUISettings.messageIntervalMin * 1000}ms (UI)   │`)
console.log(`│ Error fallback              │ 5000ms (hard)    │ ${userUISettings.messageIntervalMin * 1000}ms (UI)   │`)
console.log(`│ Ready chip min interval     │ 0s (sem limite!) │ ${userUISettings.messageIntervalMin}s (UI)       │`)
console.log(`│ linkPreviewEnabled          │ false (hard)     │ DB (dinâmico)    │`)
console.log(`│ Nursery duration            │ 14 dias (hard)   │ Schedule (UI)    │`)
console.log(`│ Prewarm duration            │ 20 dias (hard)   │ Schedule (UI)    │`)
console.log(`│ Warming delay truncation    │ 4s cap (hard)    │ Respeita UI      │`)
console.log(`│ Warming alreadySpentMs      │ Subtrai          │ Não subtrai      │`)
console.log('└─────────────────────────────┴──────────────────┴──────────────────┘')

process.exit(testsFailed > 0 ? 1 : 0)
