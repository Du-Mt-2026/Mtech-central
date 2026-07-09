'use client'

// ============================================================
// Anti-Ban Tab — Redesigned
// ============================================================
// Layout: sticky sidebar (categories) + main panel (one section at a time).
// Features preserved:
//   - All `settings.X` bindings (typing, interval, cooldown, warming, reconnect,
//     verifier, evolutionApi, ban detection, sending engine, campaign defaults,
//     warming engine)
//   - All `humanBehavior.X.Y` bindings (cluster, cooldownPresence, dayRhythm,
//     nonlinearPauses, typingSimulation, presence, deliveryRate)
//   - All helpers: updateSetting, updateHumanBehavior, resetField, resetSection,
//     resetToDefaults, addBreakWindow, removeBreakWindow, updateBreakWindow,
//     updateScheduleEntry, updateReadyDailyLimit, fetchSettings
//   - Reset-to-defaults dialog (resetDialogOpen / resetting / resetToDefaults)
//   - Debounced optimistic PATCH via /api/antiban
//
// New features added:
//   - Sidebar navigation with 7 categories
//   - Sticky header with search box + Save (dirty state) + Reset All
//   - Search filters fields by label/description; click result to jump sections
//   - isDirty indicator + "save now" (flush debounce)
//   - Confirmation dialog when switching sections with unsaved changes
//   - Tooltips on technical fields
//   - Consistent h-9 inputs with suffix-inside-input pattern
//   - Larger cards (p-6), space-y-6 between cards, space-y-4 inside cards
// ============================================================

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  RotateCcw, RefreshCw, Type, Timer, Flame, Baby, CheckCircle2,
  Clock, AlertCircle, UserPlus, EyeOff, ShieldAlert, MessageCircle,
  Plus, Trash2, Star, Brain, Activity, Zap, Coffee, Sun, Moon,
  BarChart3, Wifi, PhoneOff, Search, Server, Info, Save,
  LayoutGrid, Network, ScanSearch, ShieldCheck, Settings2, ChevronRight,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import {
  NURSERY_SCHEDULE,
  PREWARM_SCHEDULE,
  FIELD_DEFAULTS as DEFAULTS,
  DEFAULT_HUMAN_BEHAVIOR,
  type ScheduleEntry,
  type BreakWindow,
  type AntiBanSettings,
  type HumanBehaviorConfig,
} from '@/lib/constants'
import { toMins } from '@/lib/time-utils'

// ============================================================
// Types
// ============================================================

type SectionId =
  | 'basico'
  | 'aquecimento'
  | 'comportamento'
  | 'reconexao'
  | 'verificador'
  | 'seguranca'
  | 'avancado'

interface SidebarSection {
  id: SectionId
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string // tailwind classes for icon tint when active
}

interface FieldRegistryEntry {
  id: string
  label: string
  description?: string
  section: SectionId
}

// ============================================================
// Static config: sidebar sections
// ============================================================

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: 'basico',
    label: 'Básico',
    description: 'Digitação, intervalo, cooldown e janela de envio',
    icon: LayoutGrid,
    accent: 'text-sky-600 bg-sky-100 dark:bg-sky-900/30',
  },
  {
    id: 'aquecimento',
    label: 'Aquecimento',
    description: 'Fases de berçário, pré-aquecimento e motor',
    icon: Flame,
    accent: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30',
  },
  {
    id: 'comportamento',
    label: 'Comportamento Humano',
    description: 'Clusters, presença, ritmo, pausas, digitação',
    icon: Brain,
    accent: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30',
  },
  {
    id: 'reconexao',
    label: 'Reconexão',
    description: 'Tentativas, rate limit, backoff e circuit breaker',
    icon: Network,
    accent: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30',
  },
  {
    id: 'verificador',
    label: 'Verificador',
    description: 'Limites, delays, batches e cooldowns de verificação',
    icon: ScanSearch,
    accent: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30',
  },
  {
    id: 'seguranca',
    label: 'Segurança',
    description: 'Detecção de ban e Evolution API',
    icon: ShieldCheck,
    accent: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
  },
  {
    id: 'avancado',
    label: 'Avançado',
    description: 'Motor de envio, padrões de campanha e dicas',
    icon: Settings2,
    accent: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30',
  },
]

// ============================================================
// Static config: field registry for search
// ============================================================

const FIELD_REGISTRY: FieldRegistryEntry[] = [
  // Básico
  { id: 'typingMinDelay', label: 'Atraso mínimo de digitação', description: 'ms', section: 'basico' },
  { id: 'typingMaxDelay', label: 'Atraso máximo de digitação', description: 'ms', section: 'basico' },
  { id: 'messageIntervalMin', label: 'Intervalo mínimo entre mensagens', description: 'segundos', section: 'basico' },
  { id: 'messageIntervalMax', label: 'Intervalo máximo entre mensagens', description: 'segundos', section: 'basico' },
  { id: 'dailyLimitPerChip', label: 'Limite diário por chip', description: 'msgs', section: 'basico' },
  { id: 'cooldownMinutes', label: 'Cooldown mínimo', description: 'min', section: 'basico' },
  { id: 'cooldownMinutesMax', label: 'Cooldown máximo', description: 'min', section: 'basico' },
  { id: 'cooldownAfterMessages', label: 'Cooldown após N mensagens (mínimo)', description: 'msgs', section: 'basico' },
  { id: 'cooldownAfterMessagesMax', label: 'Cooldown após N mensagens (máximo)', description: 'msgs', section: 'basico' },
  { id: 'stopOnWarning', label: 'Parada em aviso', description: 'Para ao detectar aviso', section: 'basico' },
  { id: 'linkPreviewEnabled', label: 'Preview de links', description: 'Mostra preview de URLs', section: 'basico' },
  { id: 'sendingWindowStart', label: 'Início da janela de envio', description: 'horário', section: 'basico' },
  { id: 'sendingWindowEnd', label: 'Término da janela de envio', description: 'horário', section: 'basico' },
  { id: 'breakWindows', label: 'Pausas dentro da janela', description: 'almoço, reuniões', section: 'basico' },
  { id: 'timezone', label: 'Fuso horário', description: 'timezone IANA', section: 'basico' },

  // Aquecimento
  { id: 'warmingEnabled', label: 'Aquecimento progressivo', description: 'liga/desliga', section: 'aquecimento' },
  { id: 'nurserySchedule', label: 'Tabela de berçário (Fase 1)', description: '14 dias', section: 'aquecimento' },
  { id: 'prewarmSchedule', label: 'Tabela de pré-aquecimento (Fase 2)', description: '20 dias', section: 'aquecimento' },
  { id: 'readyDailyLimit', label: 'Limite diário (chip aquecido)', description: 'msgs/dia', section: 'aquecimento' },
  { id: 'hourlyLimit', label: 'Limite por hora por chip', description: 'msgs/hora', section: 'aquecimento' },
  { id: 'minChipsForWarming', label: 'Mínimo de chips para aquecer', description: 'chips', section: 'aquecimento' },
  { id: 'warmingAutoPauseErrors', label: 'Auto-pausa após erros', description: 'erros consecutivos', section: 'aquecimento' },
  { id: 'warmingErrorRetryMinSec', label: 'Retry mínimo após erro', description: 'segundos', section: 'aquecimento' },
  { id: 'warmingErrorRetryMaxSec', label: 'Retry máximo após erro', description: 'segundos', section: 'aquecimento' },

  // Comportamento Humano
  { id: 'humanBehaviorEnabled', label: 'Comportamento humano', description: 'liga/desliga', section: 'comportamento' },
  { id: 'cluster.enabled', label: 'Envio em clusters', description: 'rajadas com micro-pausas', section: 'comportamento' },
  { id: 'cluster.minSize', label: 'Tamanho mínimo do cluster', description: 'msgs', section: 'comportamento' },
  { id: 'cluster.maxSize', label: 'Tamanho máximo do cluster', description: 'msgs', section: 'comportamento' },
  { id: 'cluster.microPauseMinSec', label: 'Micro-pausa mínima entre msgs', description: 'segundos', section: 'comportamento' },
  { id: 'cluster.microPauseMaxSec', label: 'Micro-pausa máxima entre msgs', description: 'segundos', section: 'comportamento' },
  { id: 'cluster.afterClusterPauseMinSec', label: 'Pausa mínima após cluster', description: 'segundos', section: 'comportamento' },
  { id: 'cluster.afterClusterPauseMaxSec', label: 'Pausa máxima após cluster', description: 'segundos', section: 'comportamento' },
  { id: 'cooldownPresence.enabled', label: 'Presença no cooldown', description: 'aparece online em pausas', section: 'comportamento' },
  { id: 'cooldownPresence.chancePercent', label: 'Chance de aparecer online', description: 'percentual', section: 'comportamento' },
  { id: 'cooldownPresence.durationMinSec', label: 'Duração mínima online', description: 'segundos', section: 'comportamento' },
  { id: 'cooldownPresence.durationMaxSec', label: 'Duração máxima online', description: 'segundos', section: 'comportamento' },
  { id: 'cooldownPresence.intervalMinMin', label: 'Intervalo mínimo entre aparições', description: 'minutos', section: 'comportamento' },
  { id: 'cooldownPresence.intervalMaxMin', label: 'Intervalo máximo entre aparições', description: 'minutos', section: 'comportamento' },
  { id: 'dayRhythm.enabled', label: 'Ritmo do dia', description: 'velocidade varia por horário', section: 'comportamento' },
  { id: 'dayRhythm.morningFactor', label: 'Fator manhã (9-12h)', description: 'percentual', section: 'comportamento' },
  { id: 'dayRhythm.middayFactor', label: 'Fator meio-dia (12-14h)', description: 'percentual', section: 'comportamento' },
  { id: 'dayRhythm.afternoonFactor', label: 'Fator tarde (14-17h)', description: 'percentual', section: 'comportamento' },
  { id: 'nonlinearPauses.enabled', label: 'Pausas não-lineares', description: 'distribuição realista', section: 'comportamento' },
  { id: 'nonlinearPauses.short', label: 'Pausa curta', description: 'peso, min, max', section: 'comportamento' },
  { id: 'nonlinearPauses.medium', label: 'Pausa média', description: 'peso, min, max', section: 'comportamento' },
  { id: 'nonlinearPauses.long', label: 'Pausa longa', description: 'peso, min, max', section: 'comportamento' },
  { id: 'typingSimulation.speedMin', label: 'Velocidade mínima de digitação', description: 'carac/s', section: 'comportamento' },
  { id: 'typingSimulation.speedMax', label: 'Velocidade máxima de digitação', description: 'carac/s', section: 'comportamento' },
  { id: 'typingSimulation.pauseChance', label: 'Chance de pausa no meio', description: 'percentual', section: 'comportamento' },
  { id: 'typingSimulation.pauseMinMs', label: 'Pausa mínima no meio', description: 'ms', section: 'comportamento' },
  { id: 'typingSimulation.pauseMaxMs', label: 'Pausa máxima no meio', description: 'ms', section: 'comportamento' },
  { id: 'typingSimulation.longMsgThreshold', label: 'Threshold de mensagem longa', description: 'caracteres', section: 'comportamento' },
  { id: 'typingSimulation.longMsgPauseChance', label: 'Chance de pausa em msgs longas', description: 'percentual', section: 'comportamento' },
  { id: 'typingSimulation.segmentsMin', label: 'Segmentos mínimos', description: 'para msgs longas', section: 'comportamento' },
  { id: 'typingSimulation.segmentsMax', label: 'Segmentos máximos', description: 'para msgs longas', section: 'comportamento' },
  { id: 'presence.offlineDelayMinMs', label: 'Offline após envio (mínimo)', description: 'ms', section: 'comportamento' },
  { id: 'presence.offlineDelayMaxMs', label: 'Offline após envio (máximo)', description: 'ms', section: 'comportamento' },
  { id: 'presence.idleReadingChance', label: 'Chance de leitura idle', description: 'percentual', section: 'comportamento' },
  { id: 'presence.idleReadingDurationMinMs', label: 'Duração mínima de leitura idle', description: 'ms', section: 'comportamento' },
  { id: 'presence.idleReadingDurationMaxMs', label: 'Duração máxima de leitura idle', description: 'ms', section: 'comportamento' },
  { id: 'presence.idleReadingMinIntervalSec', label: 'Intervalo mínimo para leitura idle', description: 'segundos', section: 'comportamento' },
  { id: 'presence.preSendOnlineMs', label: 'Online pré-envio', description: 'ms', section: 'comportamento' },
  { id: 'presence.preComposePauseMinMs', label: 'Pausa pré-compose mínima', description: 'ms', section: 'comportamento' },
  { id: 'presence.preComposePauseMaxMs', label: 'Pausa pré-compose máxima', description: 'ms', section: 'comportamento' },
  { id: 'presence.mediaRecordingMinMs', label: 'Gravação de mídia mínima', description: 'ms', section: 'comportamento' },
  { id: 'presence.mediaRecordingMaxMs', label: 'Gravação de mídia máxima', description: 'ms', section: 'comportamento' },
  { id: 'deliveryRate.normalThreshold', label: 'Threshold normal de entrega', description: 'percentual', section: 'comportamento' },
  { id: 'deliveryRate.mediumThreshold', label: 'Threshold médio de entrega', description: 'percentual', section: 'comportamento' },
  { id: 'deliveryRate.mediumMultiplier', label: 'Multiplicador médio', description: 'x mais lento', section: 'comportamento' },
  { id: 'deliveryRate.lowThreshold', label: 'Threshold baixo de entrega', description: 'percentual', section: 'comportamento' },
  { id: 'deliveryRate.lowMultiplier', label: 'Multiplicador baixo', description: 'x mais lento', section: 'comportamento' },
  { id: 'deliveryRate.criticalMultiplier', label: 'Multiplicador crítico', description: 'x mais lento', section: 'comportamento' },
  { id: 'deliveryRate.minSample', label: 'Amostra mínima', description: 'msgs para análise', section: 'comportamento' },

  // Reconexão
  { id: 'reconnectMaxConcurrent', label: 'Máximo de reconexões simultâneas', description: 'chips', section: 'reconexao' },
  { id: 'reconnectMaxAttempts', label: 'Máximo de tentativas', description: 'vezes', section: 'reconexao' },
  { id: 'reconnectRespectWindow', label: 'Respeitar janela de envio', description: 'só durante horário comercial', section: 'reconexao' },
  { id: 'reconnectRateLimit', label: 'Rate limit de reconexão', description: 'tentativas por janela', section: 'reconexao' },
  { id: 'reconnectRateWindowMin', label: 'Janela de rate limit', description: 'minutos', section: 'reconexao' },
  { id: 'reconnectInterDelayMs', label: 'Delay entre reconexões', description: 'ms', section: 'reconexao' },
  { id: 'reconnectConnectTimeoutMs', label: 'Timeout de conexão', description: 'ms', section: 'reconexao' },
  { id: 'circuitBreakerThreshold', label: 'Circuit breaker', description: 'falhas consecutivas', section: 'reconexao' },

  // Verificador
  { id: 'verifyDailyLimit', label: 'Limite diário de verificações', description: 'verific/chip/dia', section: 'verificador' },
  { id: 'verifierDelayMin', label: 'Delay mínimo entre verificações', description: 'segundos', section: 'verificador' },
  { id: 'verifierDelayMax', label: 'Delay máximo entre verificações', description: 'segundos', section: 'verificador' },
  { id: 'verifierBatchSize', label: 'Batch por chip', description: 'verific/batch', section: 'verificador' },
  { id: 'verifierCooldownAfter', label: 'Cooldown após N verificações', description: 'verific', section: 'verificador' },
  { id: 'verifierCooldownMinutes', label: 'Duração do cooldown', description: 'minutos', section: 'verificador' },
  { id: 'verifierQuotaCooldownMs', label: 'Cooldown de cota esgotada', description: 'horas', section: 'verificador' },
  { id: 'verifierRateLimitCooldownMs', label: 'Cooldown de rate limit (429)', description: 'horas', section: 'verificador' },
  { id: 'verifierRateLimitRetryMs', label: 'Retry após 429', description: 'ms', section: 'verificador' },

  // Segurança
  { id: 'banCodes', label: 'Códigos de ban', description: 'códigos HTTP', section: 'seguranca' },
  { id: 'restrictionKeywords', label: 'Keywords de restrição', description: 'uma por linha', section: 'seguranca' },
  { id: 'warningKeywords', label: 'Keywords de aviso', description: 'uma por linha', section: 'seguranca' },
  { id: 'banLookbackHours', label: 'Lookback de ban', description: 'horas', section: 'seguranca' },
  { id: 'banKeywordThreshold', label: 'Threshold de keywords', description: 'matches', section: 'seguranca' },
  { id: 'banMaxMessagesCheck', label: 'Máximo de mensagens (ban)', description: 'msgs', section: 'seguranca' },
  { id: 'warningMaxMessagesCheck', label: 'Máximo de mensagens (aviso)', description: 'msgs', section: 'seguranca' },
  { id: 'evolutionApiTimeoutMs', label: 'Timeout da Evolution API', description: 'ms', section: 'seguranca' },
  { id: 'autoRejectCalls', label: 'Rejeitar ligações', description: 'rejeita chamadas de voz', section: 'seguranca' },
  { id: 'autoRejectCallMessage', label: 'Mensagem de rejeição', description: 'texto enviado ao rejeitar', section: 'seguranca' },

  // Avançado
  { id: 'nurseryMinIntervalSec', label: 'Intervalo do berçário', description: 'segundos', section: 'avancado' },
  { id: 'prewarmMinIntervalSec', label: 'Intervalo do pré-aquecido', description: 'segundos', section: 'avancado' },
  { id: 'functionTimeoutMs', label: 'Timeout da função', description: 'ms', section: 'avancado' },
  { id: 'maxMessagesPerInvocation', label: 'Máximo de mensagens por invocação', description: 'msgs', section: 'avancado' },
  { id: 'minRemainingTimeMs', label: 'Tempo mínimo restante', description: 'ms', section: 'avancado' },
  { id: 'presenceStaggerMinMs', label: 'Stagger de presença mínimo', description: 'ms', section: 'avancado' },
  { id: 'presenceStaggerMaxMs', label: 'Stagger de presença máximo', description: 'ms', section: 'avancado' },
  { id: 'mediaCheckTimeoutMs', label: 'Timeout de verificação de mídia', description: 'ms', section: 'avancado' },
  { id: 'defaultSendIntervalMin', label: 'Intervalo mínimo padrão', description: 'segundos', section: 'avancado' },
  { id: 'defaultSendIntervalMax', label: 'Intervalo máximo padrão', description: 'segundos', section: 'avancado' },
  { id: 'defaultAntiBanEnabled', label: 'Anti-ban ativo por padrão', description: 'novas campanhas', section: 'avancado' },
  { id: 'defaultWarmingMode', label: 'Modo de aquecimento padrão', description: 'normal, agressivo, furtivo', section: 'avancado' },
]

// ============================================================
// Helpers (pure)
// ============================================================

/** Convert minutes-from-midnight to HH:MM string */
function minsToTime(mins: number) {
  const m = Math.max(0, Math.min(1440, mins))
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Convert HH:MM string to minutes-from-midnight */
function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Parse break windows from raw JSON data */
function parseBreakWindows(raw: unknown): BreakWindow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item: unknown): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && 'start' in item && 'end' in item
    )
    .map(item => ({
      start: Number(item.start),
      end: Number(item.end),
      label: String(item.label || 'Pausa'),
    }))
}

/** Parse schedule entries from JSON string with fallback */
function parseScheduleFromSettings(jsonStr: string | undefined, fallback: ScheduleEntry[]): ScheduleEntry[] {
  if (!jsonStr) return fallback
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'dayRange' in parsed[0]) {
      return parsed
        .filter((item: unknown): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && 'dayRange' in item
        )
        .map(item => ({
          dayRange: String(item.dayRange),
          days: (Array.isArray(item.days) ? [Number(item.days[0]) || 1, Number(item.days[1]) || 1] : [1, 1]) as [number, number],
          limit: Number(item.limit) || 1,
        }))
    }
  } catch { /* ignore */ }
  return fallback
}

// ============================================================
// Main component
// ============================================================

export function AntiBanTab() {
  // --- State ---
  const [settings, setSettings] = useState<AntiBanSettings | null>(null)
  const [breakWindows, setBreakWindows] = useState<BreakWindow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('basico')
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingSection, setPendingSection] = useState<SectionId | null>(null)
  const [humanBehavior, setHumanBehavior] = useState<HumanBehaviorConfig>(DEFAULT_HUMAN_BEHAVIOR)
  const [banCodesText, setBanCodesText] = useState('')
  const [restrictionKeywordsText, setRestrictionKeywordsText] = useState('')
  const [warningKeywordsText, setWarningKeywordsText] = useState('')

  // --- Fetch ---
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/antiban')
      const data = await res.json()
      setSettings(data)
      try {
        const parsed = typeof data.breakWindows === 'string' ? JSON.parse(data.breakWindows) : (data.breakWindows || [])
        setBreakWindows(parseBreakWindows(parsed))
      } catch { setBreakWindows([]) }
      try {
        const hbParsed = typeof data.humanBehaviorConfig === 'string' ? JSON.parse(data.humanBehaviorConfig) : (data.humanBehaviorConfig || DEFAULT_HUMAN_BEHAVIOR)
        setHumanBehavior(hbParsed)
      } catch { setHumanBehavior(DEFAULT_HUMAN_BEHAVIOR) }
      try {
        const parsed = typeof data.banCodes === 'string' ? JSON.parse(data.banCodes) : (data.banCodes || [])
        setBanCodesText(Array.isArray(parsed) ? parsed.join(', ') : '')
      } catch { setBanCodesText('') }
      try {
        const parsed = typeof data.restrictionKeywords === 'string' ? JSON.parse(data.restrictionKeywords) : (data.restrictionKeywords || [])
        setRestrictionKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
      } catch { setRestrictionKeywordsText('') }
      try {
        const parsed = typeof data.warningKeywords === 'string' ? JSON.parse(data.warningKeywords) : (data.warningKeywords || [])
        setWarningKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
      } catch { setWarningKeywordsText('') }
    } catch { toast.error('Erro ao carregar configurações') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // --- Debounced updateSetting ---
  // Preserves the exact same debounced PATCH semantics as the original.
  // Adds isDirty tracking + pendingUpdateRef for "save now" (flush).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUpdateRef = useRef<{ key: string; value: unknown } | null>(null)

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    if (!settings) return
    // Optimistic update: apply to local state immediately
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
    pendingUpdateRef.current = { key, value }
    // Debounce the API call (500ms)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        const payload = pendingUpdateRef.current
        if (!payload) { setSaving(false); return }
        const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [payload.key]: payload.value }) })
        const updated = await res.json()
        setSettings(updated)
        // Re-parse breakWindows if it was updated
        if (payload.key === 'breakWindows') {
          try {
            const parsed = typeof updated.breakWindows === 'string' ? JSON.parse(updated.breakWindows) : (updated.breakWindows || [])
            setBreakWindows(parseBreakWindows(parsed))
          } catch { setBreakWindows([]) }
        }
        // Re-parse humanBehaviorConfig if it was updated
        if (payload.key === 'humanBehaviorConfig') {
          try {
            const hbParsed = typeof updated.humanBehaviorConfig === 'string' ? JSON.parse(updated.humanBehaviorConfig) : (updated.humanBehaviorConfig || DEFAULT_HUMAN_BEHAVIOR)
            setHumanBehavior(hbParsed)
          } catch { setHumanBehavior(DEFAULT_HUMAN_BEHAVIOR) }
        }
        // Re-parse banCodes if it was updated
        if (payload.key === 'banCodes') {
          try {
            const parsed = typeof updated.banCodes === 'string' ? JSON.parse(updated.banCodes) : (updated.banCodes || [])
            setBanCodesText(Array.isArray(parsed) ? parsed.join(', ') : '')
          } catch { setBanCodesText('') }
        }
        // Re-parse restrictionKeywords if it was updated
        if (payload.key === 'restrictionKeywords') {
          try {
            const parsed = typeof updated.restrictionKeywords === 'string' ? JSON.parse(updated.restrictionKeywords) : (updated.restrictionKeywords || [])
            setRestrictionKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
          } catch { setRestrictionKeywordsText('') }
        }
        // Re-parse warningKeywords if it was updated
        if (payload.key === 'warningKeywords') {
          try {
            const parsed = typeof updated.warningKeywords === 'string' ? JSON.parse(updated.warningKeywords) : (updated.warningKeywords || [])
            setWarningKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
          } catch { setWarningKeywordsText('') }
        }
        setIsDirty(false)
        pendingUpdateRef.current = null
        toast.success('Configuração atualizada!')
      } catch { toast.error('Erro ao atualizar') }
      finally { setSaving(false) }
    }, 500)
  }, [settings])

  // --- saveSettings (NEW): flush the pending debounced PATCH immediately ---
  const saveSettings = useCallback(async () => {
    if (!pendingUpdateRef.current) {
      toast.info('Nenhuma alteração pendente.')
      return
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setSaving(true)
    try {
      const payload = pendingUpdateRef.current
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [payload.key]: payload.value }) })
      const updated = await res.json()
      setSettings(updated)
      if (payload.key === 'breakWindows') {
        try {
          const parsed = typeof updated.breakWindows === 'string' ? JSON.parse(updated.breakWindows) : (updated.breakWindows || [])
          setBreakWindows(parseBreakWindows(parsed))
        } catch { setBreakWindows([]) }
      }
      if (payload.key === 'humanBehaviorConfig') {
        try {
          const hbParsed = typeof updated.humanBehaviorConfig === 'string' ? JSON.parse(updated.humanBehaviorConfig) : (updated.humanBehaviorConfig || DEFAULT_HUMAN_BEHAVIOR)
          setHumanBehavior(hbParsed)
        } catch { setHumanBehavior(DEFAULT_HUMAN_BEHAVIOR) }
      }
      if (payload.key === 'banCodes') {
        try {
          const parsed = typeof updated.banCodes === 'string' ? JSON.parse(updated.banCodes) : (updated.banCodes || [])
          setBanCodesText(Array.isArray(parsed) ? parsed.join(', ') : '')
        } catch { setBanCodesText('') }
      }
      if (payload.key === 'restrictionKeywords') {
        try {
          const parsed = typeof updated.restrictionKeywords === 'string' ? JSON.parse(updated.restrictionKeywords) : (updated.restrictionKeywords || [])
          setRestrictionKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
        } catch { setRestrictionKeywordsText('') }
      }
      if (payload.key === 'warningKeywords') {
        try {
          const parsed = typeof updated.warningKeywords === 'string' ? JSON.parse(updated.warningKeywords) : (updated.warningKeywords || [])
          setWarningKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
        } catch { setWarningKeywordsText('') }
      }
      setIsDirty(false)
      pendingUpdateRef.current = null
      toast.success('Configurações salvas!')
    } catch { toast.error('Erro ao salvar') }
    finally { setSaving(false) }
  }, [])

  // --- Break window helpers ---
  const addBreakWindow = () => {
    const updated = [...breakWindows, { start: 720, end: 810, label: 'Almoço' }]
    setBreakWindows(updated)
    updateSetting('breakWindows', JSON.stringify(updated))
  }

  const removeBreakWindow = (index: number) => {
    const updated = breakWindows.filter((_, i) => i !== index)
    setBreakWindows(updated)
    updateSetting('breakWindows', JSON.stringify(updated))
  }

  const updateBreakWindow = (index: number, field: keyof BreakWindow, value: string | number) => {
    const updated = [...breakWindows]
    updated[index] = { ...updated[index], [field]: value }
    setBreakWindows(updated)
    updateSetting('breakWindows', JSON.stringify(updated))
  }

  // --- Reset helpers ---
  const resetField = async (field: string) => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _resetField: field }) })
      setSettings(await res.json())
      toast.success('Campo restaurado para o padrão!')
    } catch { toast.error('Erro ao restaurar campo') }
    finally { setSaving(false) }
  }

  const resetSection = async (section: string, sectionLabel: string) => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _resetSection: section }) })
      setSettings(await res.json())
      toast.success(`${sectionLabel} restaurado para o padrão!`)
    } catch { toast.error('Erro ao restaurar seção') }
    finally { setSaving(false) }
  }

  const resetToDefaults = async () => {
    setResetting(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _resetToDefaults: true }) })
      setSettings(await res.json())
      toast.success('Configurações restauradas para o padrão!')
      setResetDialogOpen(false)
    } catch { toast.error('Erro ao restaurar padrões') }
    finally { setResetting(false) }
  }

  // --- Schedule helpers ---
  const updateScheduleEntry = async (scheduleType: 'nurserySchedule' | 'prewarmSchedule', index: number, newLimit: number) => {
    if (!settings) return
    const currentSchedule = scheduleType === 'nurserySchedule' ? nurserySchedule : prewarmSchedule
    const updated = [...currentSchedule]
    updated[index] = { ...updated[index], limit: newLimit }
    await updateSetting(scheduleType, updated)
  }

  const updateReadyDailyLimit = async (newLimit: number) => {
    await updateSetting('readyDailyLimit', newLimit)
  }

  // --- Human behavior nested-path updater ---
  const updateHumanBehavior = async (path: string, value: unknown) => {
    const updated = { ...humanBehavior }
    const keys = path.split('.')
    let obj: Record<string, unknown> = updated as Record<string, unknown>
    for (let i = 0; i < keys.length - 1; i++) {
      obj[keys[i]] = { ...(obj[keys[i]] as Record<string, unknown>) }
      obj = obj[keys[i]] as Record<string, unknown>
    }
    obj[keys[keys.length - 1]] = value
    setHumanBehavior(updated)
    await updateSetting('humanBehaviorConfig', updated)
  }

  // --- Section change with dirty-state confirmation ---
  const handleSectionChange = (section: SectionId) => {
    if (section === activeSection) return
    if (isDirty) {
      setPendingSection(section)
    } else {
      setActiveSection(section)
    }
  }

  const confirmSectionChange = () => {
    if (pendingSection) {
      // Force-flush pending save before switching
      saveSettings()
      setActiveSection(pendingSection)
      setPendingSection(null)
    }
  }

  // --- Search ---
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    return FIELD_REGISTRY.filter(f =>
      f.label.toLowerCase().includes(q) ||
      f.description?.toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q)
    )
  }, [searchQuery])

  // --- Loading / empty states ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!settings) return null

  // --- Derived schedule data ---
  const nurserySchedule = parseScheduleFromSettings(settings.nurserySchedule, NURSERY_SCHEDULE)
  const prewarmSchedule = parseScheduleFromSettings(settings.prewarmSchedule, PREWARM_SCHEDULE)
  const maxNursery = nurserySchedule[nurserySchedule.length - 1]?.limit || 80
  const maxPrewarm = prewarmSchedule[prewarmSchedule.length - 1]?.limit || 200

  // Backward-compat minutes for sending window display
  const windowStartMins = toMins(settings.sendingWindowStart)
  const windowEndMins = toMins(settings.sendingWindowEnd)

  // --- Tips data ---
  const tips = [
    { icon: Clock, title: 'Varie os horários de envio', desc: 'Não envie sempre no mesmo horário' },
    { icon: AlertCircle, title: 'Não envie links no primeiro dia', desc: 'Espere o chip aquecer antes' },
    { icon: UserPlus, title: 'Use mensagens personalizadas com {nome}', desc: 'Mensagens genéricas são mais detectáveis' },
    { icon: Flame, title: 'Aqueça chips novos gradualmente', desc: 'Comece com poucas mensagens' },
    { icon: RefreshCw, title: 'Alterne entre chips a cada 50 mensagens', desc: 'Distribua o envio entre múltiplos chips' },
    { icon: EyeOff, title: 'Evite mensagens idênticas para muitos contatos', desc: 'Use variações de texto' },
  ]

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="space-y-4 pb-8 overflow-x-hidden">
      {/* ============== HEADER (sticky) ============== */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b pb-3 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold">Anti-Ban</h2>
              {isDirty && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Não salvo
                </Badge>
              )}
              {saving && (
                <Badge variant="secondary" className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                  <RefreshCw className="size-3 animate-spin" />
                  Salvando
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Configurações de envio para minimizar risco de bloqueios
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar campo..."
                className="h-9 w-56 pl-8 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Limpar busca"
                >
                  ×
                </button>
              )}
            </div>

            {/* Save (dirty state) */}
            <Button
              variant={isDirty ? 'default' : 'outline'}
              onClick={saveSettings}
              disabled={saving || !isDirty}
              className="gap-2"
            >
              <Save className="size-4" />
              Salvar
            </Button>

            {/* Reset all */}
            <Button
              variant="outline"
              className="gap-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              onClick={() => setResetDialogOpen(true)}
              disabled={saving}
            >
              <RotateCcw className="size-4" />
              Restaurar Tudo
            </Button>
          </div>
        </div>
      </div>

      {/* ============== SEARCH OVERLAY ============== */}
      {searchResults && (
        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="size-4" />
                Resultados da busca
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                Limpar
              </Button>
            </div>
            <CardDescription>
              {searchResults.length === 0
                ? `Nenhum campo encontrado para "${searchQuery}"`
                : `${searchResults.length} campo(s) encontrado(s) para "${searchQuery}"`}
            </CardDescription>
          </CardHeader>
          {searchResults.length > 0 && (
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {searchResults.map(r => {
                  const sectionMeta = SIDEBAR_SECTIONS.find(s => s.id === r.section)!
                  return (
                    <button
                      key={r.id}
                      onClick={() => {
                        setActiveSection(r.section)
                        setSearchQuery('')
                      }}
                      className="flex items-center gap-3 text-left rounded-lg border border-border hover:border-primary/40 hover:bg-muted/50 p-3 transition-colors"
                    >
                      <div className={cn('flex size-8 items-center justify-center rounded-md', sectionMeta.accent)}>
                        <sectionMeta.icon className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.description ? `${r.description} · ` : ''}Seção: {sectionMeta.label}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  )
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ============== BODY: SIDEBAR + MAIN ============== */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* SIDEBAR — responsiva, sem scroll visível */}
        <aside className="lg:w-52 lg:shrink-0 lg:sticky lg:top-24 lg:self-start">
          {/* Mobile: pills horizontais (scroll discreto) | Desktop: vertical com sticky */}
          <nav className="antiban-sidebar-nav flex lg:flex-col gap-1.5 lg:gap-0.5 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0">
            {SIDEBAR_SECTIONS.map(section => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => handleSectionChange(section.id)}
                  className={cn(
                    // Mobile: pill compacto horizontal | Desktop: card vertical completo
                    'group shrink-0 lg:shrink lg:w-full flex items-center gap-2 lg:gap-3 rounded-lg lg:rounded-lg px-3 py-2 lg:py-2 text-left transition-colors whitespace-nowrap lg:whitespace-normal',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <div className={cn(
                    'flex size-7 lg:size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                    isActive ? section.accent : 'bg-muted text-muted-foreground group-hover:bg-background'
                  )}>
                    <Icon className="size-4" />
                  </div>
                  <span className="text-sm lg:sr-only">{section.label}</span>
                  {/* Desktop: mostra label + descrição */}
                  <span className="hidden lg:flex lg:flex-1 lg:flex-col lg:min-w-0">
                    <span className="text-sm font-medium leading-tight">{section.label}</span>
                  </span>
                  {isActive && <ChevronRight className="hidden lg:block size-4 shrink-0 mt-0.5" />}
                </button>
              )
            })}
          </nav>

          <Separator className="hidden lg:block my-3" />

          <div className="hidden lg:block px-2 space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setResetDialogOpen(true)}
              disabled={saving}
            >
              <RotateCcw className="size-3.5 mr-2" />
              Restaurar tudo para padrão
            </Button>
          </div>
        </aside>

        {/* MAIN PANEL */}
        <main className="flex-1 min-w-0 space-y-6">
          {/* ---------- SEÇÃO: BÁSICO ---------- */}
          {activeSection === 'basico' && (
            <>
              <SectionHeading
                title="Configurações Básicas"
                description="Ajustes de digitação, intervalos, cooldown e janela de envio."
                icon={LayoutGrid}
              />

              {/* Typing Simulation */}
              <FieldCard
                title="Simulação de Digitação"
                description="Aparecerá 'Digitando...' antes de cada mensagem"
                icon={Type}
                accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
                onResetSection={() => resetSection('typing', 'Simulação de Digitação')}
                saving={saving}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SuffixNumberField
                    label="Atraso mínimo"
                    tooltip="Tempo mínimo que o indicador 'Digitando...' fica visível antes da mensagem ser enviada"
                    suffix="ms"
                    min={1000}
                    max={10000}
                    step={100}
                    value={settings.typingMinDelay}
                    onChange={v => updateSetting('typingMinDelay', Math.max(1000, v || 1000))}
                    defaultValue={DEFAULTS.typingMinDelay as number}
                    onReset={() => resetField('typingMinDelay')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Atraso máximo"
                    tooltip="Tempo máximo que o indicador 'Digitando...' fica visível"
                    suffix="ms"
                    min={2000}
                    max={30000}
                    step={100}
                    value={settings.typingMaxDelay}
                    onChange={v => updateSetting('typingMaxDelay', Math.max(2000, v || 2000))}
                    defaultValue={DEFAULTS.typingMaxDelay as number}
                    onReset={() => resetField('typingMaxDelay')}
                    disabled={saving}
                  />
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 text-emerald-600">
                      <MessageCircle className="size-3.5" />
                      <span className="text-xs font-medium">Digitando</span>
                      <span className="animate-pulse text-xs">...</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      ({settings.typingMinDelay}–{settings.typingMaxDelay}ms)
                    </span>
                    <span className="text-xs">→ Olá, tudo bem?</span>
                  </div>
                </div>
              </FieldCard>

              {/* Message Interval */}
              <FieldCard
                title="Intervalo entre Mensagens"
                description="Pausa aleatória entre o envio de uma mensagem e a próxima"
                icon={Timer}
                accent="text-sky-600 bg-sky-100 dark:bg-sky-900/30"
                onResetSection={() => resetSection('interval', 'Intervalo entre Mensagens')}
                saving={saving}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SuffixNumberField
                    label="Intervalo mínimo"
                    suffix="seg"
                    min={1}
                    max={120}
                    step={1}
                    value={settings.messageIntervalMin}
                    onChange={v => updateSetting('messageIntervalMin', Math.max(1, v || 1))}
                    defaultValue={DEFAULTS.messageIntervalMin as number}
                    onReset={() => resetField('messageIntervalMin')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Intervalo máximo"
                    suffix="seg"
                    min={1}
                    max={300}
                    step={1}
                    value={settings.messageIntervalMax}
                    onChange={v => updateSetting('messageIntervalMax', Math.max(1, v || 1))}
                    defaultValue={DEFAULTS.messageIntervalMax as number}
                    onReset={() => resetField('messageIntervalMax')}
                    disabled={saving}
                  />
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    {[0, 1, 2, 3, 4, 5].map(i => (
                      <React.Fragment key={i}>
                        <div className="size-2.5 rounded-full bg-emerald-500" />
                        {i < 5 && <div className="flex-1 h-0.5 bg-gradient-to-r from-emerald-300 to-teal-300" />}
                      </React.Fragment>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Aleatório entre <strong>{settings.messageIntervalMin}</strong>–<strong>{settings.messageIntervalMax}</strong>s
                  </p>
                </div>
              </FieldCard>

              {/* Cooldown & Limits */}
              <FieldCard
                title="Cooldown & Limites"
                description="Pausas obrigatórias após N mensagens e limites por chip"
                icon={ShieldAlert}
                accent="text-rose-600 bg-rose-100 dark:bg-rose-900/30"
                onResetSection={() => resetSection('cooldown', 'Cooldown & Limites')}
                saving={saving}
              >
                <div className="space-y-4">
                  <SuffixNumberField
                    label="Limite diário por chip"
                    suffix="msgs"
                    min={1}
                    max={500}
                    step={1}
                    value={settings.dailyLimitPerChip}
                    onChange={v => updateSetting('dailyLimitPerChip', Math.max(1, v || 1))}
                    defaultValue={DEFAULTS.dailyLimitPerChip as number}
                    onReset={() => resetField('dailyLimitPerChip')}
                    disabled={saving}
                  />

                  <Separator />

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Duração do Cooldown</Label>
                    <p className="text-xs text-muted-foreground">
                      O sistema escolhe aleatoriamente entre mínimo e máximo a cada ciclo
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Mínimo"
                      suffix="min"
                      min={1}
                      max={120}
                      step={1}
                      value={settings.cooldownMinutes}
                      onChange={v => {
                        const val = Math.max(1, v || 1)
                        updateSetting('cooldownMinutes', val)
                        if (settings.cooldownMinutesMax < val) updateSetting('cooldownMinutesMax', val)
                      }}
                      defaultValue={DEFAULTS.cooldownMinutes as number}
                      onReset={() => resetField('cooldownMinutes')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máximo"
                      suffix="min"
                      min={settings.cooldownMinutes}
                      max={180}
                      step={1}
                      value={settings.cooldownMinutesMax}
                      onChange={v => updateSetting('cooldownMinutesMax', Math.max(settings.cooldownMinutes, v || settings.cooldownMinutes))}
                      defaultValue={DEFAULTS.cooldownMinutesMax as number}
                      onReset={() => resetField('cooldownMinutesMax')}
                      disabled={saving}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Cooldown após N mensagens</Label>
                    <p className="text-xs text-muted-foreground">
                      Após enviar entre mínimo e máximo mensagens, o chip entra em cooldown
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Mínimo"
                      suffix="msgs"
                      min={1}
                      max={100}
                      step={1}
                      value={settings.cooldownAfterMessages}
                      onChange={v => {
                        const val = Math.max(1, v || 1)
                        updateSetting('cooldownAfterMessages', val)
                        if (settings.cooldownAfterMessagesMax < val) updateSetting('cooldownAfterMessagesMax', val)
                      }}
                      defaultValue={DEFAULTS.cooldownAfterMessages as number}
                      onReset={() => resetField('cooldownAfterMessages')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máximo"
                      suffix="msgs"
                      min={settings.cooldownAfterMessages}
                      max={200}
                      step={1}
                      value={settings.cooldownAfterMessagesMax}
                      onChange={v => updateSetting('cooldownAfterMessagesMax', Math.max(settings.cooldownAfterMessages, v || settings.cooldownAfterMessages))}
                      defaultValue={DEFAULTS.cooldownAfterMessagesMax as number}
                      onReset={() => resetField('cooldownAfterMessagesMax')}
                      disabled={saving}
                    />
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                    Após enviar <strong>{settings.cooldownAfterMessages === settings.cooldownAfterMessagesMax ? settings.cooldownAfterMessages : `${settings.cooldownAfterMessages}-${settings.cooldownAfterMessagesMax}`}</strong> mensagens, o chip faz uma pausa de <strong>{settings.cooldownMinutes === settings.cooldownMinutesMax ? settings.cooldownMinutes : `${settings.cooldownMinutes}-${settings.cooldownMinutesMax}`}</strong> min. Valores são aleatórios dentro dos ranges.
                  </div>

                  <Separator />

                  <ToggleRow
                    title="Parada em Aviso"
                    description="Para ao detectar aviso"
                    checked={settings.stopOnWarning}
                    onCheckedChange={v => updateSetting('stopOnWarning', v)}
                    onReset={() => resetField('stopOnWarning')}
                  />

                  <ToggleRow
                    title="Preview de Links"
                    description="Mostra preview de URLs nas mensagens (desativado por padrão — previews em massa são detectáveis como bot)"
                    checked={settings.linkPreviewEnabled}
                    onCheckedChange={v => updateSetting('linkPreviewEnabled', v)}
                    onReset={() => resetField('linkPreviewEnabled')}
                  />
                </div>
              </FieldCard>

              {/* Sending Window */}
              <FieldCard
                title="Janela de Envio"
                description="Horário permitido para disparos + pausas dentro da janela"
                icon={Clock}
                accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30"
                onResetSection={() => resetSection('sendingWindow', 'Janela de Envio')}
                saving={saving}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Início</Label>
                      <ResetIconButton onClick={() => resetField('sendingWindowStart')} title={`Padrão: ${minsToTime(DEFAULTS.sendingWindowStart as number)}`} />
                    </div>
                    <Select value={String(windowStartMins)} onValueChange={v => updateSetting('sendingWindowStart', parseInt(v))}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {Array.from({ length: 289 }, (_, i) => i * 5).map(mins => (
                          <SelectItem key={mins} value={String(mins)}>
                            {minsToTime(mins)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Término</Label>
                      <ResetIconButton onClick={() => resetField('sendingWindowEnd')} title={`Padrão: ${minsToTime(DEFAULTS.sendingWindowEnd as number)}`} />
                    </div>
                    <Select value={String(windowEndMins)} onValueChange={v => updateSetting('sendingWindowEnd', parseInt(v))}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {Array.from({ length: 289 }, (_, i) => i * 5).map(mins => (
                          <SelectItem key={mins} value={String(mins)}>
                            {minsToTime(mins)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-0.5 mb-1.5">
                    {Array.from({ length: 24 }, (_, i) => {
                      const hourStartMins = i * 60
                      const isActive = hourStartMins >= windowStartMins && hourStartMins < windowEndMins
                      return (
                        <div
                          key={i}
                          className={cn('flex-1 h-5 rounded-sm', isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700')}
                          title={`${i}h`}
                        />
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Envio permitido das <strong>{minsToTime(windowStartMins)}</strong> às <strong>{minsToTime(windowEndMins)}</strong> (fuso: {settings.timezone})
                  </p>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Label className="text-sm font-medium">Pausas dentro da janela</Label>
                      <p className="text-xs text-muted-foreground">
                        Almoço, reuniões, etc. O envio para e retoma automaticamente.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-orange-500 border-orange-500/30 hover:bg-orange-500/10"
                      onClick={addBreakWindow}
                      disabled={saving}
                    >
                      <Plus className="size-3.5 mr-1" />
                      Adicionar
                    </Button>
                  </div>
                  {breakWindows.length === 0 ? (
                    <div className="text-center py-4 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Nenhuma pausa configurada</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {breakWindows.map((bw, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center gap-2 bg-orange-500/5 border border-orange-500/20 rounded-lg p-3"
                        >
                          <Input
                            type="time"
                            value={minsToTime(bw.start)}
                            onChange={e => updateBreakWindow(idx, 'start', timeToMins(e.target.value))}
                            className="h-9 w-28 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">até</span>
                          <Input
                            type="time"
                            value={minsToTime(bw.end)}
                            onChange={e => updateBreakWindow(idx, 'end', timeToMins(e.target.value))}
                            className="h-9 w-28 text-sm"
                          />
                          <Input
                            type="text"
                            value={bw.label}
                            onChange={e => updateBreakWindow(idx, 'label', e.target.value)}
                            placeholder="Ex: Almoço"
                            className="h-9 flex-1 min-w-0 text-sm"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => removeBreakWindow(idx)}
                            disabled={saving}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </FieldCard>
            </>
          )}

          {/* ---------- SEÇÃO: AQUECIMENTO ---------- */}
          {activeSection === 'aquecimento' && (
            <>
              <SectionHeading
                title="Aquecimento Progressivo"
                description="Berçário (chip novo) → Pré-aquecido → Aquecido. Configurável por dia."
                icon={Flame}
              />

              <FieldCard
                title="Aquecimento Progressivo"
                description="Ajuste as tabelas e limites por fase"
                icon={Flame}
                accent="text-orange-600 bg-orange-100 dark:bg-orange-900/30"
                headerExtra={
                  <Switch checked={settings.warmingEnabled} onCheckedChange={v => updateSetting('warmingEnabled', v)} />
                }
                onResetSection={() => resetSection('warming', 'Aquecimento Progressivo')}
                saving={saving}
              >
                {/* Phase overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <Baby className="size-5 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Berçário</p>
                      <p className="text-xs text-muted-foreground">14 dias · Até {maxNursery} msg/dia</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                    <Flame className="size-5 text-orange-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">Pré-aquecido</p>
                      <p className="text-xs text-muted-foreground">20 dias · 11→{maxPrewarm} msg/dia</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Aquecido</p>
                      <p className="text-xs text-muted-foreground">{settings.readyDailyLimit || 200} msg/dia (editável)</p>
                    </div>
                  </div>
                </div>

                {/* Three-phase schedule tables */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Phase 1: Nursery */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded bg-amber-100 dark:bg-amber-900/30">
                        <Baby className="size-3.5 text-amber-600" />
                      </div>
                      <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                        Fase 1: Berçário
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {nurserySchedule.map((entry, i) => {
                        const pct = Math.max(5, (entry.limit / maxNursery) * 100)
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-12 shrink-0 text-right">Dia {entry.dayRange}</span>
                            <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full flex items-center justify-end pr-1"
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.6, delay: i * 0.1 }}
                              >
                                <span className="text-[10px] font-bold text-white">{entry.limit}</span>
                              </motion.div>
                            </div>
                            <Input
                              type="number"
                              min={1}
                              max={200}
                              value={entry.limit}
                              onChange={e => updateScheduleEntry('nurserySchedule', i, Math.max(1, parseInt(e.target.value) || 1))}
                              className="h-9 w-20 text-sm"
                              disabled={saving}
                            />
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground italic">Após 14 dias → chip pré-aquecido</p>
                  </div>

                  {/* Phase 2: Prewarm */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded bg-orange-100 dark:bg-orange-900/30">
                        <Flame className="size-3.5 text-orange-600" />
                      </div>
                      <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                        Fase 2: Pré-aquecido
                      </span>
                    </div>
                    <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                      {prewarmSchedule.map((entry, i) => {
                        const pct = Math.max(5, (entry.limit / maxPrewarm) * 100)
                        return (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground w-8 shrink-0 text-right">D{entry.dayRange}</span>
                            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-gradient-to-r from-orange-400 to-emerald-500 rounded-full flex items-center justify-end pr-1"
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.5, delay: i * 0.05 }}
                              >
                                {pct > 15 && <span className="text-[9px] font-bold text-white">{entry.limit}</span>}
                              </motion.div>
                            </div>
                            <Input
                              type="number"
                              min={1}
                              max={500}
                              value={entry.limit}
                              onChange={e => updateScheduleEntry('prewarmSchedule', i, Math.max(1, parseInt(e.target.value) || 1))}
                              className="h-9 w-20 text-sm"
                              disabled={saving}
                            />
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground italic">Após 20 dias → chip aquecido</p>
                  </div>

                  {/* Phase 3: Aquecido */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded bg-emerald-100 dark:bg-emerald-900/30">
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                      </div>
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        Fase 3: Aquecido
                      </span>
                    </div>
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-4">
                      <div className="text-center">
                        <CheckCircle2 className="size-8 text-emerald-500 mx-auto mb-2" />
                        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Chip Aquecido</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Sem restrições de aquecimento. Limite diário configurável.
                        </p>
                      </div>
                      <SuffixNumberField
                        label="Limite diário por chip"
                        suffix="msgs/dia"
                        min={1}
                        max={5000}
                        step={1}
                        value={settings.readyDailyLimit || 200}
                        onChange={v => updateReadyDailyLimit(Math.max(1, v || 200))}
                        defaultValue={DEFAULTS.readyDailyLimit as number}
                        onReset={() => resetField('readyDailyLimit')}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Limite por hora por chip"
                        suffix="msgs/hora"
                        min={1}
                        max={500}
                        step={1}
                        value={settings.hourlyLimit || 30}
                        onChange={v => updateSetting('hourlyLimit', Math.max(1, v || 30))}
                        defaultValue={DEFAULTS.hourlyLimit as number}
                        onReset={() => resetField('hourlyLimit')}
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>

                {/* Timeline visual */}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs font-medium mb-2">Timeline completa do aquecimento</p>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 14 }, (_, i) => {
                      const day = i + 1
                      const limit = nurserySchedule.find(s => day >= s.days[0] && day <= s.days[1])?.limit || 10
                      return (
                        <div
                          key={`n-${i}`}
                          className="flex-1 h-6 rounded-sm bg-amber-400 flex items-center justify-center"
                          title={`Berçário Dia ${day}: ${limit} msg/dia`}
                        >
                          <span className="text-[8px] font-bold text-white">{limit}</span>
                        </div>
                      )
                    })}
                    {Array.from({ length: 20 }, (_, i) => {
                      const day = i + 1
                      const entry = prewarmSchedule.find(s => day >= s.days[0] && day <= s.days[1])
                      const limit = entry?.limit || 11
                      const intensity = limit / maxPrewarm
                      return (
                        <div
                          key={`p-${i}`}
                          className="flex-1 h-6 rounded-sm flex items-center justify-center"
                          style={{ backgroundColor: `rgba(16, 185, 129, ${0.2 + intensity * 0.8})` }}
                          title={`Pré-aquecido Dia ${day}: ${limit} msg/dia`}
                        >
                          <span className="text-[8px] font-bold text-white">{limit}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[10px] text-amber-600 font-medium">← Berçário (14 dias)</span>
                    <span className="text-[10px] text-emerald-600 font-medium">
                      Aquecido ({settings.readyDailyLimit || 200}/dia) ✓
                    </span>
                    <span className="text-[10px] text-orange-600 font-medium">Pré-aquecido (20 dias) →</span>
                  </div>
                </div>
              </FieldCard>

              {/* Warming Engine */}
              <FieldCard
                title="Motor de Aquecimento"
                description="Parâmetros do motor que gere os ciclos de aquecimento"
                icon={Flame}
                accent="text-orange-600 bg-orange-100 dark:bg-orange-900/30"
                onResetSection={() => resetSection('warmingEngine', 'Motor de Aquecimento')}
                saving={saving}
              >
                <div className="space-y-4">
                  <SuffixNumberField
                    label="Mín. chips para aquecer"
                    tooltip="Número mínimo de chips disponíveis para que o motor de aquecimento funcione"
                    suffix="chips"
                    min={2}
                    max={10}
                    step={1}
                    value={settings.minChipsForWarming ?? 3}
                    onChange={v => updateSetting('minChipsForWarming', Math.max(2, v || 3))}
                    defaultValue={DEFAULTS.minChipsForWarming as number}
                    onReset={() => resetField('minChipsForWarming')}
                    disabled={saving}
                  />

                  <SuffixNumberField
                    label="Auto-pausa após erros"
                    tooltip="Quantos erros consecutivos devem ocorrer para o aquecimento ser pausado"
                    suffix="erros"
                    min={3}
                    max={50}
                    step={1}
                    value={settings.warmingAutoPauseErrors ?? 10}
                    onChange={v => updateSetting('warmingAutoPauseErrors', Math.max(3, v || 10))}
                    defaultValue={DEFAULTS.warmingAutoPauseErrors as number}
                    onReset={() => resetField('warmingAutoPauseErrors')}
                    disabled={saving}
                  />

                  <Separator />

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Retry após erro</Label>
                    <p className="text-xs text-muted-foreground">
                      Intervalo aleatório entre mínimo e máximo antes de tentar novamente
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Mínimo"
                      suffix="seg"
                      min={5}
                      max={120}
                      step={1}
                      value={settings.warmingErrorRetryMinSec ?? 15}
                      onChange={v => updateSetting('warmingErrorRetryMinSec', Math.max(5, v || 15))}
                      defaultValue={DEFAULTS.warmingErrorRetryMinSec as number}
                      onReset={() => resetField('warmingErrorRetryMinSec')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máximo"
                      suffix="seg"
                      min={10}
                      max={300}
                      step={1}
                      value={settings.warmingErrorRetryMaxSec ?? 60}
                      onChange={v => updateSetting('warmingErrorRetryMaxSec', Math.max(10, v || 60))}
                      defaultValue={DEFAULTS.warmingErrorRetryMaxSec as number}
                      onReset={() => resetField('warmingErrorRetryMaxSec')}
                      disabled={saving}
                    />
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                    O motor de aquecimento precisa de pelo menos <strong>{settings.minChipsForWarming ?? 3}</strong> chips disponíveis. Após <strong>{settings.warmingAutoPauseErrors ?? 10}</strong> erros consecutivos, o aquecimento é pausado automaticamente. Retry aguarda <strong>{settings.warmingErrorRetryMinSec ?? 15}–{settings.warmingErrorRetryMaxSec ?? 60}s</strong>.
                  </div>
                </div>
              </FieldCard>
            </>
          )}

          {/* ---------- SEÇÃO: COMPORTAMENTO HUMANO ---------- */}
          {activeSection === 'comportamento' && (
            <>
              <SectionHeading
                title="Comportamento Humano"
                description="Faz o bot se parecer com um humano real, evitando padrões detectáveis."
                icon={Brain}
              />

              {/* Master toggle */}
              <Card className="shadow-lg">
                <CardContent className="p-5">
                  <ToggleRow
                    title="Comportamento Humano"
                    description="Ativa todos os módulos abaixo (clusters, presença, ritmo, pausas, digitação, presença online, ajuste por entrega)"
                    checked={settings.humanBehaviorEnabled ?? true}
                    onCheckedChange={v => updateSetting('humanBehaviorEnabled', v)}
                    onReset={() => resetSection('humanBehavior', 'Comportamento Humano')}
                  />
                </CardContent>
              </Card>

              {settings.humanBehaviorEnabled !== false && (
                <>
                  {/* Cluster Sending */}
                  <FieldCard
                    title="Envio em Clusters"
                    description="Rajadas de mensagens com micro-pausas (como um humano que manda várias seguidas)"
                    icon={Zap}
                    accent="text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30"
                  >
                    <ToggleRow
                      title="Ativar clusters"
                      checked={humanBehavior.cluster?.enabled ?? true}
                      onCheckedChange={v => updateHumanBehavior('cluster.enabled', v)}
                    />
                    {humanBehavior.cluster?.enabled !== false && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SuffixNumberField
                          label="Tamanho mínimo do cluster"
                          suffix="msgs"
                          min={2}
                          max={6}
                          step={1}
                          value={humanBehavior.cluster?.minSize ?? 2}
                          onChange={v => updateHumanBehavior('cluster.minSize', Math.max(2, v || 2))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.minSize}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Tamanho máximo do cluster"
                          suffix="msgs"
                          min={2}
                          max={8}
                          step={1}
                          value={humanBehavior.cluster?.maxSize ?? 4}
                          onChange={v => updateHumanBehavior('cluster.maxSize', Math.max(2, v || 4))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.maxSize}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Micro-pausa mínima entre msgs"
                          suffix="seg"
                          min={1}
                          max={30}
                          step={1}
                          value={humanBehavior.cluster?.microPauseMinSec ?? 3}
                          onChange={v => updateHumanBehavior('cluster.microPauseMinSec', Math.max(1, v || 3))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.microPauseMinSec}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Micro-pausa máxima entre msgs"
                          suffix="seg"
                          min={1}
                          max={60}
                          step={1}
                          value={humanBehavior.cluster?.microPauseMaxSec ?? 8}
                          onChange={v => updateHumanBehavior('cluster.microPauseMaxSec', Math.max(1, v || 8))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.microPauseMaxSec}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Pausa mínima após cluster"
                          suffix="seg"
                          min={10}
                          max={300}
                          step={5}
                          value={humanBehavior.cluster?.afterClusterPauseMinSec ?? 30}
                          onChange={v => updateHumanBehavior('cluster.afterClusterPauseMinSec', Math.max(10, v || 30))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.afterClusterPauseMinSec}
                          disabled={saving}
                          className="md:col-span-1"
                        />
                        <SuffixNumberField
                          label="Pausa máxima após cluster"
                          suffix="seg"
                          min={10}
                          max={600}
                          step={5}
                          value={humanBehavior.cluster?.afterClusterPauseMaxSec ?? 90}
                          onChange={v => updateHumanBehavior('cluster.afterClusterPauseMaxSec', Math.max(10, v || 90))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.afterClusterPauseMaxSec}
                          disabled={saving}
                          className="md:col-span-1"
                        />
                      </div>
                    )}
                    <FieldNote>
                      Humano: manda 2-4 msgs rápidas, faz pausa, mais 3 msgs, pausa longa...
                    </FieldNote>
                  </FieldCard>

                  {/* Cooldown Presence */}
                  <FieldCard
                    title="Presença no Cooldown"
                    description="Aparece online aleatoriamente durante pausas longas"
                    icon={Coffee}
                    accent="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30"
                  >
                    <ToggleRow
                      title="Ativar presença no cooldown"
                      checked={humanBehavior.cooldownPresence?.enabled ?? true}
                      onCheckedChange={v => updateHumanBehavior('cooldownPresence.enabled', v)}
                    />
                    {humanBehavior.cooldownPresence?.enabled !== false && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SuffixNumberField
                          label="Chance de aparecer"
                          suffix="%"
                          min={5}
                          max={100}
                          step={5}
                          value={humanBehavior.cooldownPresence?.chancePercent ?? 40}
                          onChange={v => updateHumanBehavior('cooldownPresence.chancePercent', Math.max(5, v || 40))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.chancePercent}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Duração mínima online"
                          suffix="seg"
                          min={2}
                          max={120}
                          step={1}
                          value={humanBehavior.cooldownPresence?.durationMinSec ?? 5}
                          onChange={v => updateHumanBehavior('cooldownPresence.durationMinSec', Math.max(2, v || 5))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.durationMinSec}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Duração máxima online"
                          suffix="seg"
                          min={2}
                          max={120}
                          step={1}
                          value={humanBehavior.cooldownPresence?.durationMaxSec ?? 25}
                          onChange={v => updateHumanBehavior('cooldownPresence.durationMaxSec', Math.max(2, v || 25))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.durationMaxSec}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Intervalo mínimo entre aparições"
                          suffix="min"
                          min={1}
                          max={30}
                          step={1}
                          value={humanBehavior.cooldownPresence?.intervalMinMin ?? 2}
                          onChange={v => updateHumanBehavior('cooldownPresence.intervalMinMin', Math.max(1, v || 2))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.intervalMinMin}
                          disabled={saving}
                        />
                        <SuffixNumberField
                          label="Intervalo máximo entre aparições"
                          suffix="min"
                          min={1}
                          max={60}
                          step={1}
                          value={humanBehavior.cooldownPresence?.intervalMaxMin ?? 5}
                          onChange={v => updateHumanBehavior('cooldownPresence.intervalMaxMin', Math.max(1, v || 5))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.intervalMaxMin}
                          disabled={saving}
                        />
                      </div>
                    )}
                    <FieldNote>
                      Humano: durante pausa, abre WhatsApp pra checar msgs, depois fecha. Bot fica 100% offline = detectável.
                    </FieldNote>
                  </FieldCard>

                  {/* Day Rhythm */}
                  <FieldCard
                    title="Ritmo do Dia"
                    description="Velocidade varia conforme o horário (manhã mais lento, meio-dia mais rápido)"
                    icon={Sun}
                    accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
                  >
                    <ToggleRow
                      title="Ativar ritmo do dia"
                      checked={humanBehavior.dayRhythm?.enabled ?? true}
                      onCheckedChange={v => updateHumanBehavior('dayRhythm.enabled', v)}
                    />
                    {humanBehavior.dayRhythm?.enabled !== false && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SuffixNumberField
                          label="Manhã (9-12h)"
                          tooltip="100% = velocidade normal. >100% = mais lento. <100% = mais rápido."
                          suffix="%"
                          min={50}
                          max={300}
                          step={5}
                          value={humanBehavior.dayRhythm?.morningFactor ?? 130}
                          onChange={v => updateHumanBehavior('dayRhythm.morningFactor', Math.max(50, v || 130))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.dayRhythm.morningFactor}
                          disabled={saving}
                          extraHint={factorLabel(humanBehavior.dayRhythm?.morningFactor ?? 130)}
                        />
                        <SuffixNumberField
                          label="Meio-dia (12-14h)"
                          tooltip="100% = velocidade normal. >100% = mais lento. <100% = mais rápido."
                          suffix="%"
                          min={50}
                          max={300}
                          step={5}
                          value={humanBehavior.dayRhythm?.middayFactor ?? 80}
                          onChange={v => updateHumanBehavior('dayRhythm.middayFactor', Math.max(50, v || 80))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.dayRhythm.middayFactor}
                          disabled={saving}
                          extraHint={factorLabel(humanBehavior.dayRhythm?.middayFactor ?? 80)}
                        />
                        <SuffixNumberField
                          label="Tarde (14-17h)"
                          tooltip="100% = velocidade normal. >100% = mais lento. <100% = mais rápido."
                          suffix="%"
                          min={50}
                          max={300}
                          step={5}
                          value={humanBehavior.dayRhythm?.afternoonFactor ?? 100}
                          onChange={v => updateHumanBehavior('dayRhythm.afternoonFactor', Math.max(50, v || 100))}
                          defaultValue={DEFAULT_HUMAN_BEHAVIOR.dayRhythm.afternoonFactor}
                          disabled={saving}
                          extraHint={factorLabel(humanBehavior.dayRhythm?.afternoonFactor ?? 100)}
                        />
                      </div>
                    )}
                    <FieldNote>
                      100% = velocidade normal. &gt;100% = mais lento (multiplica o intervalo). &lt;100% = mais rápido. Humano é mais devagar de manhã e noite.
                    </FieldNote>
                  </FieldCard>

                  {/* Nonlinear Pauses */}
                  <FieldCard
                    title="Pausas Não-Lineares"
                    description="Distribuição realista de pausas: curtas, médias e longas com pesos"
                    icon={BarChart3}
                    accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30"
                  >
                    <ToggleRow
                      title="Ativar pausas não-lineares"
                      checked={humanBehavior.nonlinearPauses?.enabled ?? true}
                      onCheckedChange={v => updateHumanBehavior('nonlinearPauses.enabled', v)}
                    />
                    {humanBehavior.nonlinearPauses?.enabled !== false && (
                      <div className="space-y-4">
                        <PauseTierEditor
                          tierLabel="Curta"
                          tierColor="bg-emerald-400"
                          weightValue={humanBehavior.nonlinearPauses?.short?.weight ?? 40}
                          minMinValue={humanBehavior.nonlinearPauses?.short?.minMin ?? 2}
                          maxMinValue={humanBehavior.nonlinearPauses?.short?.maxMin ?? 5}
                          onWeightChange={v => updateHumanBehavior('nonlinearPauses.short.weight', Math.max(0, v || 40))}
                          onMinMinChange={v => updateHumanBehavior('nonlinearPauses.short.minMin', Math.max(1, v || 2))}
                          onMaxMinChange={v => updateHumanBehavior('nonlinearPauses.short.maxMin', Math.max(1, v || 5))}
                          disabled={saving}
                        />
                        <PauseTierEditor
                          tierLabel="Média"
                          tierColor="bg-amber-400"
                          weightValue={humanBehavior.nonlinearPauses?.medium?.weight ?? 40}
                          minMinValue={humanBehavior.nonlinearPauses?.medium?.minMin ?? 8}
                          maxMinValue={humanBehavior.nonlinearPauses?.medium?.maxMin ?? 15}
                          onWeightChange={v => updateHumanBehavior('nonlinearPauses.medium.weight', Math.max(0, v || 40))}
                          onMinMinChange={v => updateHumanBehavior('nonlinearPauses.medium.minMin', Math.max(1, v || 8))}
                          onMaxMinChange={v => updateHumanBehavior('nonlinearPauses.medium.maxMin', Math.max(1, v || 15))}
                          disabled={saving}
                        />
                        <PauseTierEditor
                          tierLabel="Longa"
                          tierColor="bg-violet-400"
                          weightValue={humanBehavior.nonlinearPauses?.long?.weight ?? 20}
                          minMinValue={humanBehavior.nonlinearPauses?.long?.minMin ?? 20}
                          maxMinValue={humanBehavior.nonlinearPauses?.long?.maxMin ?? 35}
                          onWeightChange={v => updateHumanBehavior('nonlinearPauses.long.weight', Math.max(0, v || 20))}
                          onMinMinChange={v => updateHumanBehavior('nonlinearPauses.long.minMin', Math.max(1, v || 20))}
                          onMaxMinChange={v => updateHumanBehavior('nonlinearPauses.long.maxMin', Math.max(1, v || 35))}
                          disabled={saving}
                        />

                        {/* Visual bar */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Distribuição</Label>
                          <div className="flex h-3 rounded-full overflow-hidden">
                            {(() => {
                              const total = (humanBehavior.nonlinearPauses?.short?.weight ?? 40) + (humanBehavior.nonlinearPauses?.medium?.weight ?? 40) + (humanBehavior.nonlinearPauses?.long?.weight ?? 20)
                              const shortPct = total > 0 ? ((humanBehavior.nonlinearPauses?.short?.weight ?? 40) / total) * 100 : 33
                              const medPct = total > 0 ? ((humanBehavior.nonlinearPauses?.medium?.weight ?? 40) / total) * 100 : 33
                              const longPct = total > 0 ? ((humanBehavior.nonlinearPauses?.long?.weight ?? 20) / total) * 100 : 33
                              return (
                                <>
                                  <div className="bg-emerald-400" style={{ width: `${shortPct}%` }} title={`Curta: ${shortPct.toFixed(0)}%`} />
                                  <div className="bg-amber-400" style={{ width: `${medPct}%` }} title={`Média: ${medPct.toFixed(0)}%`} />
                                  <div className="bg-violet-400" style={{ width: `${longPct}%` }} title={`Longa: ${longPct.toFixed(0)}%`} />
                                </>
                              )
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                    <FieldNote>
                      Humano: pausa curta (foi ao banheiro), média (café), longa (almoçou/ligação). Bot sempre faz a mesma pausa = padrão detectável.
                    </FieldNote>
                  </FieldCard>

                  {/* Typing Simulation (HB) */}
                  <FieldCard
                    title="Simulação de Digitação (HB)"
                    description="Detalhes finos de digitação humana: velocidade variável, pausas, segmentos"
                    icon={Type}
                    accent="text-pink-600 bg-pink-100 dark:bg-pink-900/30"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SuffixNumberField
                        label="Velocidade mínima"
                        suffix="carac/s"
                        min={1}
                        max={30}
                        step={1}
                        value={humanBehavior.typingSimulation?.speedMin ?? 6}
                        onChange={v => updateHumanBehavior('typingSimulation.speedMin', Math.max(1, v || 6))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.speedMin}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Velocidade máxima"
                        suffix="carac/s"
                        min={1}
                        max={40}
                        step={1}
                        value={humanBehavior.typingSimulation?.speedMax ?? 14}
                        onChange={v => updateHumanBehavior('typingSimulation.speedMax', Math.max(1, v || 14))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.speedMax}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Chance de pausa no meio"
                        suffix="%"
                        min={0}
                        max={100}
                        step={5}
                        value={humanBehavior.typingSimulation?.pauseChance ?? 30}
                        onChange={v => updateHumanBehavior('typingSimulation.pauseChance', Math.max(0, v || 30))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.pauseChance}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Pausa mínima no meio"
                        suffix="ms"
                        min={500}
                        max={10000}
                        step={500}
                        value={humanBehavior.typingSimulation?.pauseMinMs ?? 1000}
                        onChange={v => updateHumanBehavior('typingSimulation.pauseMinMs', Math.max(500, v || 1000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.pauseMinMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Pausa máxima no meio"
                        suffix="ms"
                        min={500}
                        max={15000}
                        step={500}
                        value={humanBehavior.typingSimulation?.pauseMaxMs ?? 4000}
                        onChange={v => updateHumanBehavior('typingSimulation.pauseMaxMs', Math.max(500, v || 4000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.pauseMaxMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Threshold de mensagem longa"
                        suffix="carac"
                        min={50}
                        max={500}
                        step={10}
                        value={humanBehavior.typingSimulation?.longMsgThreshold ?? 100}
                        onChange={v => updateHumanBehavior('typingSimulation.longMsgThreshold', Math.max(50, v || 100))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.longMsgThreshold}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Chance de pausa em msgs longas"
                        suffix="%"
                        min={0}
                        max={100}
                        step={5}
                        value={humanBehavior.typingSimulation?.longMsgPauseChance ?? 40}
                        onChange={v => updateHumanBehavior('typingSimulation.longMsgPauseChance', Math.max(0, v || 40))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.longMsgPauseChance}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Segmentos mínimos (msgs longas)"
                        suffix="seg"
                        min={2}
                        max={5}
                        step={1}
                        value={humanBehavior.typingSimulation?.segmentsMin ?? 2}
                        onChange={v => updateHumanBehavior('typingSimulation.segmentsMin', Math.max(2, v || 2))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.segmentsMin}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Segmentos máximos (msgs longas)"
                        suffix="seg"
                        min={2}
                        max={6}
                        step={1}
                        value={humanBehavior.typingSimulation?.segmentsMax ?? 3}
                        onChange={v => updateHumanBehavior('typingSimulation.segmentsMax', Math.max(2, v || 3))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.segmentsMax}
                        disabled={saving}
                      />
                    </div>
                    <FieldNote>
                      Simula digitação humana: velocidade variável, pausas no meio da mensagem, segmentos para textos longos. Sem isso, o "digitando..." aparece e desaparece no mesmo tempo = padrão de bot.
                    </FieldNote>
                  </FieldCard>

                  {/* Presence Online */}
                  <FieldCard
                    title="Presença Online"
                    description="Online/offline realista antes e depois de enviar, com leitura idle"
                    icon={EyeOff}
                    accent="text-teal-600 bg-teal-100 dark:bg-teal-900/30"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SuffixNumberField
                        label="Offline após envio (mínimo)"
                        suffix="ms"
                        min={1000}
                        max={30000}
                        step={1000}
                        value={humanBehavior.presence?.offlineDelayMinMs ?? 3000}
                        onChange={v => updateHumanBehavior('presence.offlineDelayMinMs', Math.max(1000, v || 3000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.offlineDelayMinMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Offline após envio (máximo)"
                        suffix="ms"
                        min={1000}
                        max={60000}
                        step={1000}
                        value={humanBehavior.presence?.offlineDelayMaxMs ?? 15000}
                        onChange={v => updateHumanBehavior('presence.offlineDelayMaxMs', Math.max(1000, v || 15000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.offlineDelayMaxMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Chance de leitura idle"
                        suffix="%"
                        min={0}
                        max={100}
                        step={5}
                        value={humanBehavior.presence?.idleReadingChance ?? 25}
                        onChange={v => updateHumanBehavior('presence.idleReadingChance', Math.max(0, v || 25))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingChance}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Duração mínima de leitura idle"
                        suffix="ms"
                        min={1000}
                        max={30000}
                        step={1000}
                        value={humanBehavior.presence?.idleReadingDurationMinMs ?? 2000}
                        onChange={v => updateHumanBehavior('presence.idleReadingDurationMinMs', Math.max(1000, v || 2000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingDurationMinMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Duração máxima de leitura idle"
                        suffix="ms"
                        min={1000}
                        max={60000}
                        step={1000}
                        value={humanBehavior.presence?.idleReadingDurationMaxMs ?? 8000}
                        onChange={v => updateHumanBehavior('presence.idleReadingDurationMaxMs', Math.max(1000, v || 8000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingDurationMaxMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Intervalo mínimo para leitura idle"
                        suffix="seg"
                        min={30}
                        max={300}
                        step={10}
                        value={humanBehavior.presence?.idleReadingMinIntervalSec ?? 60}
                        onChange={v => updateHumanBehavior('presence.idleReadingMinIntervalSec', Math.max(30, v || 60))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingMinIntervalSec}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Online pré-envio"
                        suffix="ms"
                        min={500}
                        max={5000}
                        step={500}
                        value={humanBehavior.presence?.preSendOnlineMs ?? 1000}
                        onChange={v => updateHumanBehavior('presence.preSendOnlineMs', Math.max(500, v || 1000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.preSendOnlineMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Pausa pré-compose mínima"
                        suffix="ms"
                        min={500}
                        max={5000}
                        step={100}
                        value={humanBehavior.presence?.preComposePauseMinMs ?? 800}
                        onChange={v => updateHumanBehavior('presence.preComposePauseMinMs', Math.max(500, v || 800))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.preComposePauseMinMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Pausa pré-compose máxima"
                        suffix="ms"
                        min={500}
                        max={10000}
                        step={100}
                        value={humanBehavior.presence?.preComposePauseMaxMs ?? 3000}
                        onChange={v => updateHumanBehavior('presence.preComposePauseMaxMs', Math.max(500, v || 3000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.preComposePauseMaxMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Gravação de mídia mínima"
                        suffix="ms"
                        min={1000}
                        max={10000}
                        step={500}
                        value={humanBehavior.presence?.mediaRecordingMinMs ?? 2000}
                        onChange={v => updateHumanBehavior('presence.mediaRecordingMinMs', Math.max(1000, v || 2000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.mediaRecordingMinMs}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Gravação de mídia máxima"
                        suffix="ms"
                        min={1000}
                        max={15000}
                        step={500}
                        value={humanBehavior.presence?.mediaRecordingMaxMs ?? 4000}
                        onChange={v => updateHumanBehavior('presence.mediaRecordingMaxMs', Math.max(1000, v || 4000))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.mediaRecordingMaxMs}
                        disabled={saving}
                      />
                    </div>
                    <FieldNote>
                      Simula presença humana: fica online antes de digitar, demora para sair após enviar, aparece "online" aleatoriamente entre mensagens (como quem está lendo o WhatsApp). Sem isso, o chip entra e sai instantaneamente = comportamento de bot.
                    </FieldNote>
                  </FieldCard>

                  {/* Delivery Rate Auto-Adjust */}
                  <FieldCard
                    title="Ajuste por Taxa de Entrega"
                    description="Desacelera automaticamente quando a taxa de entrega cai"
                    icon={Activity}
                    accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SuffixNumberField
                        label="Threshold normal"
                        tooltip="Acima deste percentual, o sistema usa velocidade normal"
                        suffix="%"
                        min={0}
                        max={100}
                        step={5}
                        value={humanBehavior.deliveryRate?.normalThreshold ?? 60}
                        onChange={v => updateHumanBehavior('deliveryRate.normalThreshold', Math.max(0, v || 60))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.normalThreshold}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Threshold médio"
                        tooltip="Entre este e o normal, o sistema usa o multiplicador médio"
                        suffix="%"
                        min={0}
                        max={100}
                        step={5}
                        value={humanBehavior.deliveryRate?.mediumThreshold ?? 40}
                        onChange={v => updateHumanBehavior('deliveryRate.mediumThreshold', Math.max(0, v || 40))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.mediumThreshold}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Multiplicador médio"
                        suffix="x"
                        min={1}
                        max={5}
                        step={0.5}
                        value={humanBehavior.deliveryRate?.mediumMultiplier ?? 1.5}
                        onChange={v => updateHumanBehavior('deliveryRate.mediumMultiplier', Math.max(1, parseFloat(String(v)) || 1.5))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.mediumMultiplier}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Threshold baixo"
                        suffix="%"
                        min={0}
                        max={100}
                        step={5}
                        value={humanBehavior.deliveryRate?.lowThreshold ?? 20}
                        onChange={v => updateHumanBehavior('deliveryRate.lowThreshold', Math.max(0, v || 20))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.lowThreshold}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Multiplicador baixo"
                        suffix="x"
                        min={1}
                        max={10}
                        step={0.5}
                        value={humanBehavior.deliveryRate?.lowMultiplier ?? 2.5}
                        onChange={v => updateHumanBehavior('deliveryRate.lowMultiplier', Math.max(1, parseFloat(String(v)) || 2.5))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.lowMultiplier}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Multiplicador crítico"
                        tooltip="Aplicado quando a taxa está abaixo do threshold baixo"
                        suffix="x"
                        min={2}
                        max={10}
                        step={0.5}
                        value={humanBehavior.deliveryRate?.criticalMultiplier ?? 4.0}
                        onChange={v => updateHumanBehavior('deliveryRate.criticalMultiplier', Math.max(2, parseFloat(String(v)) || 4.0))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.criticalMultiplier}
                        disabled={saving}
                      />
                      <SuffixNumberField
                        label="Amostra mínima"
                        tooltip="Quantas mensagens precisam ter sido enviadas para calcular a taxa de entrega"
                        suffix="msgs"
                        min={5}
                        max={50}
                        step={5}
                        value={humanBehavior.deliveryRate?.minSample ?? 10}
                        onChange={v => updateHumanBehavior('deliveryRate.minSample', Math.max(5, v || 10))}
                        defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.minSample}
                        disabled={saving}
                        className="md:col-span-2"
                      />
                    </div>
                    <FieldNote>
                      Se a taxa de entrega cair (mensagens não chegam), o sistema desacelera automaticamente. Poucas entregas = sinal de spam para o WhatsApp. Desacelerar reduz o risco de ban.
                    </FieldNote>
                  </FieldCard>

                  {/* Summary */}
                  <Card className="shadow-lg border-cyan-200 dark:border-cyan-800">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Activity className="size-4 text-cyan-600" />
                        <CardTitle className="text-base text-cyan-700 dark:text-cyan-400">Resumo do Comportamento</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {humanBehavior.cluster?.enabled !== false && (
                          <>Clusters de {humanBehavior.cluster?.minSize ?? 2}-{humanBehavior.cluster?.maxSize ?? 4} msgs com pausa de {humanBehavior.cluster?.microPauseMinSec ?? 10}-{humanBehavior.cluster?.microPauseMaxSec ?? 25}s entre elas. </>
                        )}
                        {humanBehavior.cooldownPresence?.enabled !== false && (
                          <>Durante cooldown: {humanBehavior.cooldownPresence?.chancePercent ?? 40}% chance de aparecer online por {humanBehavior.cooldownPresence?.durationMinSec ?? 5}-{humanBehavior.cooldownPresence?.durationMaxSec ?? 25}s a cada {humanBehavior.cooldownPresence?.intervalMinMin ?? 2}-{humanBehavior.cooldownPresence?.intervalMaxMin ?? 5}min. </>
                        )}
                        {humanBehavior.dayRhythm?.enabled !== false && (
                          <>Ritmo: manhã {(humanBehavior.dayRhythm?.morningFactor ?? 130)}%, meio-dia {(humanBehavior.dayRhythm?.middayFactor ?? 80)}%, tarde {(humanBehavior.dayRhythm?.afternoonFactor ?? 100)}%. </>
                        )}
                        {humanBehavior.nonlinearPauses?.enabled !== false && (
                          <>Pausas: {(humanBehavior.nonlinearPauses?.short?.weight ?? 40)}% curta, {(humanBehavior.nonlinearPauses?.medium?.weight ?? 40)}% média, {(humanBehavior.nonlinearPauses?.long?.weight ?? 20)}% longa. </>
                        )}
                        <>Digitação: {humanBehavior.typingSimulation?.speedMin ?? 6}-{humanBehavior.typingSimulation?.speedMax ?? 14} carac/s. Presença: offline em {Math.round((humanBehavior.presence?.offlineDelayMinMs ?? 3000) / 1000)}-{Math.round((humanBehavior.presence?.offlineDelayMaxMs ?? 15000) / 1000)}s. </>
                        <>Entrega: normal ≥{humanBehavior.deliveryRate?.normalThreshold ?? 60}%, crítico {(humanBehavior.deliveryRate?.criticalMultiplier ?? 4.0)}x.</>
                      </p>
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}

          {/* ---------- SEÇÃO: RECONEXÃO ---------- */}
          {activeSection === 'reconexao' && (
            <>
              <SectionHeading
                title="Reconexão"
                description="Como o sistema reconecta chips que caem."
                icon={Network}
              />

              <FieldCard
                title="Reconexão"
                description="Tentativas, rate limit, delays e circuit breaker"
                icon={Wifi}
                accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30"
                onResetSection={() => resetSection('reconnection', 'Reconexão')}
                saving={saving}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SuffixNumberField
                    label="Máx. reconexões simultâneas"
                    suffix="chips"
                    min={1}
                    max={10}
                    step={1}
                    value={settings.reconnectMaxConcurrent ?? 2}
                    onChange={v => updateSetting('reconnectMaxConcurrent', Math.max(1, v || 2))}
                    defaultValue={DEFAULTS.reconnectMaxConcurrent as number}
                    onReset={() => resetField('reconnectMaxConcurrent')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Máx. tentativas"
                    suffix="vezes"
                    min={1}
                    max={50}
                    step={1}
                    value={settings.reconnectMaxAttempts ?? 10}
                    onChange={v => updateSetting('reconnectMaxAttempts', Math.max(1, v || 10))}
                    defaultValue={DEFAULTS.reconnectMaxAttempts as number}
                    onReset={() => resetField('reconnectMaxAttempts')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Rate limit"
                    tooltip="Máximo de tentativas de reconexão por janela de tempo"
                    suffix={`/ ${settings.reconnectRateWindowMin ?? 10}min`}
                    min={1}
                    max={50}
                    step={1}
                    value={settings.reconnectRateLimit ?? 5}
                    onChange={v => updateSetting('reconnectRateLimit', Math.max(1, v || 5))}
                    defaultValue={DEFAULTS.reconnectRateLimit as number}
                    onReset={() => resetField('reconnectRateLimit')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Janela de rate limit"
                    suffix="min"
                    min={1}
                    max={60}
                    step={1}
                    value={settings.reconnectRateWindowMin ?? 10}
                    onChange={v => updateSetting('reconnectRateWindowMin', Math.max(1, v || 10))}
                    defaultValue={DEFAULTS.reconnectRateWindowMin as number}
                    onReset={() => resetField('reconnectRateWindowMin')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Delay entre reconexões"
                    suffix="ms"
                    min={1000}
                    max={120000}
                    step={1000}
                    value={settings.reconnectInterDelayMs ?? 15000}
                    onChange={v => updateSetting('reconnectInterDelayMs', Math.max(1000, v || 15000))}
                    defaultValue={DEFAULTS.reconnectInterDelayMs as number}
                    onReset={() => resetField('reconnectInterDelayMs')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Timeout de conexão"
                    suffix="ms"
                    min={10000}
                    max={300000}
                    step={5000}
                    value={settings.reconnectConnectTimeoutMs ?? 60000}
                    onChange={v => updateSetting('reconnectConnectTimeoutMs', Math.max(10000, v || 60000))}
                    defaultValue={DEFAULTS.reconnectConnectTimeoutMs as number}
                    onReset={() => resetField('reconnectConnectTimeoutMs')}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Circuit breaker"
                    tooltip="Quantas falhas consecutivas até o circuit breaker abrir (parar de tentar)"
                    suffix="falhas"
                    min={1}
                    max={20}
                    step={1}
                    value={settings.circuitBreakerThreshold ?? 3}
                    onChange={v => updateSetting('circuitBreakerThreshold', Math.max(1, v || 3))}
                    defaultValue={DEFAULTS.circuitBreakerThreshold as number}
                    onReset={() => resetField('circuitBreakerThreshold')}
                    disabled={saving}
                    className="md:col-span-2"
                  />
                </div>

                <Separator />

                {/* Backoff progressivo (array<number> armazenado como JSON string) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">Backoff progressivo (ms)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Delays entre tentativas de reconexão (tentativa 1, 2, 3, ...). Ex: 5000 = 5s na 1ª tentativa, 15000 = 15s na 2ª, etc.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Textarea
                    className="min-h-[60px] text-sm font-mono"
                    value={(() => {
                      const v = (settings as any).reconnectBackoffMs
                      if (!v) return '5000, 15000, 45000, 120000, 300000, 600000'
                      if (Array.isArray(v)) return v.join(', ')
                      try { return JSON.parse(v).join(', ') } catch { return String(v) }
                    })()}
                    onChange={e => {
                      const arr = e.target.value
                        .split(',')
                        .map(s => parseInt(s.trim()))
                        .filter(n => !isNaN(n) && n >= 1000)
                      updateSetting('reconnectBackoffMs', JSON.stringify(arr))
                    }}
                    placeholder="5000, 15000, 45000, 120000, 300000, 600000"
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lista de delays em ms separados por vírgula. Mínimo 1000ms cada.
                  </p>
                </div>

                <Separator />

                <ToggleRow
                  title="Respeitar janela de envio"
                  description="Só reconecta durante horário comercial"
                  checked={settings.reconnectRespectWindow ?? false}
                  onCheckedChange={v => updateSetting('reconnectRespectWindow', v)}
                  onReset={() => resetField('reconnectRespectWindow')}
                />
              </FieldCard>
            </>
          )}

          {/* ---------- SEÇÃO: VERIFICADOR ---------- */}
          {activeSection === 'verificador' && (
            <>
              <SectionHeading
                title="Verificador"
                description="Limites e delays para verificação de números."
                icon={ScanSearch}
              />

              <FieldCard
                title="Verificador"
                description="Limites, delays, batches e cooldowns de verificação"
                icon={Search}
                accent="text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30"
                onResetSection={() => resetSection('verifier', 'Verificador')}
                saving={saving}
              >
                <div className="space-y-4">
                  <SuffixNumberField
                    label="Limite diário de verificações"
                    suffix="verific/chip/dia"
                    min={10}
                    max={5000}
                    step={10}
                    value={settings.verifyDailyLimit ?? 300}
                    onChange={v => updateSetting('verifyDailyLimit', Math.max(10, v || 300))}
                    defaultValue={DEFAULTS.verifyDailyLimit as number}
                    onReset={() => resetField('verifyDailyLimit')}
                    disabled={saving}
                  />

                  <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                    Cada chip pode verificar até <strong>{settings.verifyDailyLimit ?? 300}</strong> números por dia. Verificações demais podem acionar limites do WhatsApp.
                  </div>

                  <Separator />

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Delay entre verificações</Label>
                    <p className="text-xs text-muted-foreground">Pausa aleatória entre mínimo e máximo</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Delay mínimo"
                      suffix="seg"
                      min={1}
                      max={60}
                      step={1}
                      value={settings.verifierDelayMin ?? 8}
                      onChange={v => updateSetting('verifierDelayMin', Math.max(1, v || 8))}
                      defaultValue={DEFAULTS.verifierDelayMin as number}
                      onReset={() => resetField('verifierDelayMin')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Delay máximo"
                      suffix="seg"
                      min={1}
                      max={120}
                      step={1}
                      value={settings.verifierDelayMax ?? 15}
                      onChange={v => updateSetting('verifierDelayMax', Math.max(1, v || 15))}
                      defaultValue={DEFAULTS.verifierDelayMax as number}
                      onReset={() => resetField('verifierDelayMax')}
                      disabled={saving}
                    />
                  </div>

                  <Separator />

                  <SuffixNumberField
                    label="Batch por chip"
                    suffix="verific/batch"
                    min={1}
                    max={50}
                    step={1}
                    value={settings.verifierBatchSize ?? 5}
                    onChange={v => updateSetting('verifierBatchSize', Math.max(1, v || 5))}
                    defaultValue={DEFAULTS.verifierBatchSize as number}
                    onReset={() => resetField('verifierBatchSize')}
                    disabled={saving}
                  />

                  <SuffixNumberField
                    label="Cooldown após N verificações"
                    suffix="verific"
                    min={5}
                    max={200}
                    step={1}
                    value={settings.verifierCooldownAfter ?? 50}
                    onChange={v => updateSetting('verifierCooldownAfter', Math.max(5, v || 50))}
                    defaultValue={DEFAULTS.verifierCooldownAfter as number}
                    onReset={() => resetField('verifierCooldownAfter')}
                    disabled={saving}
                  />

                  <SuffixNumberField
                    label="Duração do cooldown"
                    suffix="min"
                    min={1}
                    max={60}
                    step={1}
                    value={settings.verifierCooldownMinutes ?? 5}
                    onChange={v => updateSetting('verifierCooldownMinutes', Math.max(1, v || 5))}
                    defaultValue={DEFAULTS.verifierCooldownMinutes as number}
                    onReset={() => resetField('verifierCooldownMinutes')}
                    disabled={saving}
                  />

                  <Separator />

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Cooldowns de quota e rate limit</Label>
                    <p className="text-xs text-muted-foreground">Quanto tempo esperar quando a quota esgota ou quando o WhatsApp retorna 429</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Cooldown de cota esgotada"
                      suffix="horas"
                      min={1}
                      max={168}
                      step={1}
                      value={Math.round((settings.verifierQuotaCooldownMs ?? 86400000) / 3600000)}
                      onChange={v => updateSetting('verifierQuotaCooldownMs', Math.max(60000, (v || 24) * 3600000))}
                      defaultValue={Number(DEFAULTS.verifierQuotaCooldownMs) / 3600000}
                      onReset={() => resetField('verifierQuotaCooldownMs')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Cooldown de 429 (rate limit)"
                      suffix="horas"
                      min={1}
                      max={168}
                      step={1}
                      value={Math.round((settings.verifierRateLimitCooldownMs ?? 86400000) / 3600000)}
                      onChange={v => updateSetting('verifierRateLimitCooldownMs', Math.max(60000, (v || 24) * 3600000))}
                      defaultValue={Number(DEFAULTS.verifierRateLimitCooldownMs) / 3600000}
                      onReset={() => resetField('verifierRateLimitCooldownMs')}
                      disabled={saving}
                    />
                  </div>

                  <SuffixNumberField
                    label="Retry após 429"
                    tooltip="Tempo de espera antes de tentar novamente após receber um erro 429 (rate limit) da API"
                    suffix="ms"
                    min={500}
                    max={10000}
                    step={100}
                    value={settings.verifierRateLimitRetryMs ?? 2000}
                    onChange={v => updateSetting('verifierRateLimitRetryMs', Math.max(500, v || 2000))}
                    defaultValue={DEFAULTS.verifierRateLimitRetryMs as number}
                    onReset={() => resetField('verifierRateLimitRetryMs')}
                    disabled={saving}
                  />
                </div>
              </FieldCard>
            </>
          )}

          {/* ---------- SEÇÃO: SEGURANÇA ---------- */}
          {activeSection === 'seguranca' && (
            <>
              <SectionHeading
                title="Segurança"
                description="Detecção de ban e configurações da Evolution API."
                icon={ShieldCheck}
              />

              {/* Ban Detection */}
              <FieldCard
                title="Detecção de Ban"
                description="Códigos HTTP, keywords de restrição/aviso e janela de monitoramento"
                icon={ShieldAlert}
                accent="text-purple-600 bg-purple-100 dark:bg-purple-900/30"
                onResetSection={() => resetSection('banDetection', 'Detecção de Ban')}
                saving={saving}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Códigos de ban</Label>
                      <ResetIconButton onClick={() => resetField('banCodes')} title="Restaurar padrão" />
                    </div>
                    <Input
                      type="text"
                      value={banCodesText}
                      onChange={e => {
                        setBanCodesText(e.target.value)
                        const arr = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                        updateSetting('banCodes', JSON.stringify(arr))
                      }}
                      placeholder="401, 403, 428, 440"
                      className="h-9 text-sm"
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">Separados por vírgula. Códigos HTTP que indicam ban.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Keywords de restrição</Label>
                      <ResetIconButton onClick={() => resetField('restrictionKeywords')} title="Restaurar padrão" />
                    </div>
                    <Textarea
                      value={restrictionKeywordsText}
                      onChange={e => {
                        setRestrictionKeywordsText(e.target.value)
                        const arr = e.target.value.split('\n').map(s => s.trim()).filter(s => s.length > 0)
                        updateSetting('restrictionKeywords', JSON.stringify(arr))
                      }}
                      placeholder="sua conta foi banida&#10;sua conta foi suspensa&#10;..."
                      className="min-h-24 text-sm"
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">Uma keyword por linha. Palavras que indicam restrição de conta.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Keywords de aviso</Label>
                      <ResetIconButton onClick={() => resetField('warningKeywords')} title="Restaurar padrão" />
                    </div>
                    <Textarea
                      value={warningKeywordsText}
                      onChange={e => {
                        setWarningKeywordsText(e.target.value)
                        const arr = e.target.value.split('\n').map(s => s.trim()).filter(s => s.length > 0)
                        updateSetting('warningKeywords', JSON.stringify(arr))
                      }}
                      placeholder="aviso&#10;advertência&#10;spam&#10;..."
                      className="min-h-24 text-sm"
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">Uma keyword por linha. Palavras que indicam aviso ou alerta.</p>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Lookback"
                      suffix="horas"
                      min={1}
                      max={168}
                      step={1}
                      value={settings.banLookbackHours ?? 24}
                      onChange={v => updateSetting('banLookbackHours', Math.max(1, v || 24))}
                      defaultValue={DEFAULTS.banLookbackHours as number}
                      onReset={() => resetField('banLookbackHours')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Threshold de keywords"
                      suffix="matches"
                      min={1}
                      max={10}
                      step={1}
                      value={settings.banKeywordThreshold ?? 2}
                      onChange={v => updateSetting('banKeywordThreshold', Math.max(1, v || 2))}
                      defaultValue={DEFAULTS.banKeywordThreshold as number}
                      onReset={() => resetField('banKeywordThreshold')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máx. mensagens (ban)"
                      suffix="msgs"
                      min={5}
                      max={200}
                      step={1}
                      value={settings.banMaxMessagesCheck ?? 50}
                      onChange={v => updateSetting('banMaxMessagesCheck', Math.max(5, v || 50))}
                      defaultValue={DEFAULTS.banMaxMessagesCheck as number}
                      onReset={() => resetField('banMaxMessagesCheck')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máx. mensagens (aviso)"
                      suffix="msgs"
                      min={5}
                      max={100}
                      step={1}
                      value={settings.warningMaxMessagesCheck ?? 20}
                      onChange={v => updateSetting('warningMaxMessagesCheck', Math.max(5, v || 20))}
                      defaultValue={DEFAULTS.warningMaxMessagesCheck as number}
                      onReset={() => resetField('warningMaxMessagesCheck')}
                      disabled={saving}
                    />
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                    Monitora as últimas <strong>{settings.banLookbackHours ?? 24}h</strong> de mensagens, verificando até <strong>{settings.banMaxMessagesCheck ?? 50}</strong> msgs para ban e <strong>{settings.warningMaxMessagesCheck ?? 20}</strong> para aviso. Aciona se ≥<strong>{settings.banKeywordThreshold ?? 2}</strong> keywords forem encontradas.
                  </div>
                </div>
              </FieldCard>

              {/* Evolution API */}
              <FieldCard
                title="Evolution API"
                description="Timeout, rejeição de chamadas e mensagem de resposta"
                icon={Server}
                accent="text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30"
                onResetSection={() => resetSection('evolutionApi', 'Evolution API')}
                saving={saving}
              >
                <div className="space-y-4">
                  <SuffixNumberField
                    label="Timeout da API"
                    suffix="ms"
                    min={5000}
                    max={120000}
                    step={1000}
                    value={settings.evolutionApiTimeoutMs ?? 15000}
                    onChange={v => updateSetting('evolutionApiTimeoutMs', Math.max(5000, v || 15000))}
                    defaultValue={DEFAULTS.evolutionApiTimeoutMs as number}
                    onReset={() => resetField('evolutionApiTimeoutMs')}
                    disabled={saving}
                  />

                  <ToggleRow
                    title="Rejeitar ligações"
                    description="Rejeita chamadas de voz automaticamente"
                    checked={settings.autoRejectCalls ?? true}
                    onCheckedChange={v => updateSetting('autoRejectCalls', v)}
                    onReset={() => resetField('autoRejectCalls')}
                  />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Mensagem de rejeição</Label>
                    <Input
                      type="text"
                      maxLength={200}
                      value={settings.autoRejectCallMessage ?? 'Desculpa, nao posso atender agora.'}
                      onChange={e => updateSetting('autoRejectCallMessage', e.target.value)}
                      className="h-9 text-sm"
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">Máx. 200 caracteres. Enviada quando uma chamada é rejeitada.</p>
                  </div>
                </div>
              </FieldCard>
            </>
          )}

          {/* ---------- SEÇÃO: AVANÇADO ---------- */}
          {activeSection === 'avancado' && (
            <>
              <SectionHeading
                title="Avançado"
                description="Motor de envio, padrões de campanha e dicas anti-ban."
                icon={Settings2}
              />

              {/* Sending Engine */}
              <FieldCard
                title="Motor de Envio"
                description="Parâmetros internos do motor que processa as filas"
                icon={Zap}
                accent="text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30"
                onResetSection={() => resetSection('sendingEngine', 'Motor de Envio')}
                saving={saving}
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Intervalo do berçário"
                      suffix="seg"
                      min={30}
                      max={600}
                      step={5}
                      value={settings.nurseryMinIntervalSec ?? 120}
                      onChange={v => updateSetting('nurseryMinIntervalSec', Math.max(30, v || 120))}
                      defaultValue={DEFAULTS.nurseryMinIntervalSec as number}
                      onReset={() => resetField('nurseryMinIntervalSec')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Intervalo do pré-aquecido"
                      suffix="seg"
                      min={15}
                      max={300}
                      step={5}
                      value={settings.prewarmMinIntervalSec ?? 60}
                      onChange={v => updateSetting('prewarmMinIntervalSec', Math.max(15, v || 60))}
                      defaultValue={DEFAULTS.prewarmMinIntervalSec as number}
                      onReset={() => resetField('prewarmMinIntervalSec')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Timeout da função"
                      suffix="ms"
                      min={10000}
                      max={120000}
                      step={1000}
                      value={settings.functionTimeoutMs ?? 50000}
                      onChange={v => updateSetting('functionTimeoutMs', Math.max(10000, v || 50000))}
                      defaultValue={DEFAULTS.functionTimeoutMs as number}
                      onReset={() => resetField('functionTimeoutMs')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máx. msgs por invocação"
                      suffix="msgs"
                      min={1}
                      max={50}
                      step={1}
                      value={settings.maxMessagesPerInvocation ?? 10}
                      onChange={v => updateSetting('maxMessagesPerInvocation', Math.max(1, v || 10))}
                      defaultValue={DEFAULTS.maxMessagesPerInvocation as number}
                      onReset={() => resetField('maxMessagesPerInvocation')}
                      disabled={saving}
                    />
                  </div>

                  <SuffixNumberField
                    label="Tempo mínimo restante"
                    tooltip="Se restar menos que este tempo na invocação atual, o motor não inicia uma nova mensagem"
                    suffix="ms"
                    min={1000}
                    max={10000}
                    step={500}
                    value={settings.minRemainingTimeMs ?? 3000}
                    onChange={v => updateSetting('minRemainingTimeMs', Math.max(1000, v || 3000))}
                    defaultValue={DEFAULTS.minRemainingTimeMs as number}
                    onReset={() => resetField('minRemainingTimeMs')}
                    disabled={saving}
                  />

                  <Separator />

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Stagger de presença</Label>
                    <p className="text-xs text-muted-foreground">Delay aleatório antes de enviar "digitando..."</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Mínimo"
                      suffix="ms"
                      min={100}
                      max={5000}
                      step={100}
                      value={settings.presenceStaggerMinMs ?? 500}
                      onChange={v => updateSetting('presenceStaggerMinMs', Math.max(100, v || 500))}
                      defaultValue={DEFAULTS.presenceStaggerMinMs as number}
                      onReset={() => resetField('presenceStaggerMinMs')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Máximo"
                      suffix="ms"
                      min={100}
                      max={10000}
                      step={100}
                      value={settings.presenceStaggerMaxMs ?? 2000}
                      onChange={v => updateSetting('presenceStaggerMaxMs', Math.max(100, v || 2000))}
                      defaultValue={DEFAULTS.presenceStaggerMaxMs as number}
                      onReset={() => resetField('presenceStaggerMaxMs')}
                      disabled={saving}
                    />
                  </div>

                  <SuffixNumberField
                    label="Timeout de verificação de mídia"
                    suffix="ms"
                    min={1000}
                    max={30000}
                    step={500}
                    value={settings.mediaCheckTimeoutMs ?? 5000}
                    onChange={v => updateSetting('mediaCheckTimeoutMs', Math.max(1000, v || 5000))}
                    defaultValue={DEFAULTS.mediaCheckTimeoutMs as number}
                    onReset={() => resetField('mediaCheckTimeoutMs')}
                    disabled={saving}
                  />
                </div>
              </FieldCard>

              {/* Campaign Defaults */}
              <FieldCard
                title="Padrões de Campanha"
                description="Valores aplicados a novas campanhas por padrão"
                icon={Star}
                accent="text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30"
                onResetSection={() => resetSection('campaignDefaults', 'Padrões de Campanha')}
                saving={saving}
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SuffixNumberField
                      label="Intervalo mínimo padrão"
                      suffix="seg"
                      min={5}
                      max={300}
                      step={1}
                      value={settings.defaultSendIntervalMin ?? 30}
                      onChange={v => updateSetting('defaultSendIntervalMin', Math.max(5, v || 30))}
                      defaultValue={DEFAULTS.defaultSendIntervalMin as number}
                      onReset={() => resetField('defaultSendIntervalMin')}
                      disabled={saving}
                    />
                    <SuffixNumberField
                      label="Intervalo máximo padrão"
                      suffix="seg"
                      min={5}
                      max={600}
                      step={1}
                      value={settings.defaultSendIntervalMax ?? 90}
                      onChange={v => updateSetting('defaultSendIntervalMax', Math.max(5, v || 90))}
                      defaultValue={DEFAULTS.defaultSendIntervalMax as number}
                      onReset={() => resetField('defaultSendIntervalMax')}
                      disabled={saving}
                    />
                  </div>

                  <ToggleRow
                    title="Anti-ban ativo por padrão"
                    description="Novas campanhas iniciam com anti-ban ligado"
                    checked={settings.defaultAntiBanEnabled ?? true}
                    onCheckedChange={v => updateSetting('defaultAntiBanEnabled', v)}
                    onReset={() => resetField('defaultAntiBanEnabled')}
                  />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Modo de aquecimento padrão</Label>
                      <ResetIconButton onClick={() => resetField('defaultWarmingMode')} title={`Padrão: ${DEFAULTS.defaultWarmingMode}`} />
                    </div>
                    <Select
                      value={settings.defaultWarmingMode ?? 'normal'}
                      onValueChange={v => updateSetting('defaultWarmingMode', v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="agressive">Agressivo</SelectItem>
                        <SelectItem value="stealth">Furtivo</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Modo de aquecimento aplicado a novas campanhas.</p>
                  </div>
                </div>
              </FieldCard>

              {/* Tips */}
              <FieldCard
                title="Dicas Anti-Ban"
                description="Boas práticas para reduzir risco de bloqueios"
                icon={Star}
                accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
              >
                <div className="space-y-2">
                  {tips.map((tip, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex size-8 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/20 shrink-0">
                        <tip.icon className="size-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{tip.title}</p>
                        <p className="text-xs text-muted-foreground">{tip.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </FieldCard>
            </>
          )}
        </main>
      </div>

      {/* ============== DIALOGS ============== */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar todas as configurações padrão?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai redefinir todas as configurações anti-ban para os valores originais. Suas personalizações serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={resetToDefaults}
              disabled={resetting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {resetting ? <RefreshCw className="size-4 animate-spin mr-2" /> : <RotateCcw className="size-4 mr-2" />}
              {resetting ? 'Restaurando...' : 'Restaurar Padrões'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingSection !== null} onOpenChange={open => { if (!open) setPendingSection(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterações não salvas</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem alterações não salvas. Continuar vai salvar agora e trocar de seção.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSectionChange}>
              Salvar e continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================
// Helper sub-components (inline)
// ============================================================

/** Big section heading shown at the top of each main panel */
function SectionHeading({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-5 text-primary" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

/** A Card with consistent padding and header (icon + title + optional reset) */
function FieldCard({
  title,
  description,
  icon: Icon,
  accent,
  onResetSection,
  saving,
  headerExtra,
  children,
}: {
  title: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  onResetSection?: () => void
  saving?: boolean
  headerExtra?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={cn('flex size-9 items-center justify-center rounded-lg shrink-0', accent)}>
              <Icon className="size-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">{title}</CardTitle>
              {description && (
                <CardDescription className="text-xs mt-1">{description}</CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerExtra}
            {onResetSection && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground gap-1 h-8"
                onClick={onResetSection}
                disabled={saving}
                title="Restaurar seção"
              >
                <RotateCcw className="size-3" />
                Restaurar
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

/** Small reset icon button for individual fields */
function ResetIconButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title={title}
    >
      <RotateCcw className="size-3" />
    </Button>
  )
}

/** Numeric input with suffix inside the input wrapper + optional tooltip + reset */
function SuffixNumberField({
  label,
  tooltip,
  suffix,
  min,
  max,
  step,
  value,
  onChange,
  defaultValue,
  onReset,
  disabled,
  className,
  extraHint,
}: {
  label: string
  tooltip?: string
  suffix: string
  min?: number
  max?: number
  step?: number
  value: number
  onChange: (value: number) => void
  defaultValue?: number
  onReset?: () => void
  disabled?: boolean
  className?: string
  extraHint?: string
}) {
  const widthClass = suffix.length > 6 ? 'pr-20' : suffix.length > 3 ? 'pr-14' : 'pr-10'
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Label className="text-sm font-medium truncate">{label}</Label>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Info">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-64">{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {onReset && defaultValue !== undefined && (
          <ResetIconButton onClick={onReset} title={`Padrão: ${defaultValue}`} />
        )}
      </div>
      <div className="relative">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseInt(e.target.value) || 0)}
          disabled={disabled}
          className={cn('h-9 w-full text-sm', widthClass)}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none whitespace-nowrap">
          {suffix}
        </span>
      </div>
      {extraHint && (
        <p className="text-xs text-muted-foreground">{extraHint}</p>
      )}
    </div>
  )
}

/** A row with title, description, switch, and optional reset */
function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  onReset,
}: {
  title: string
  description?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  onReset?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 bg-muted/40 rounded-lg">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
        {onReset && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={onReset}
            title="Restaurar padrão"
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

/** Small note / help text shown at the bottom of a field card */
function FieldNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground leading-relaxed">
      {children}
    </div>
  )
}

/** Editor for one pause tier (short/medium/long) in the Nonlinear Pauses card */
function PauseTierEditor({
  tierLabel,
  tierColor,
  weightValue,
  minMinValue,
  maxMinValue,
  onWeightChange,
  onMinMinChange,
  onMaxMinChange,
  disabled,
}: {
  tierLabel: string
  tierColor: string
  weightValue: number
  minMinValue: number
  maxMinValue: number
  onWeightChange: (v: number) => void
  onMinMinChange: (v: number) => void
  onMaxMinChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={cn('size-3 rounded-sm', tierColor)} />
        <Label className="text-sm font-medium">Pausa {tierLabel}</Label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SuffixNumberField
          label="Peso"
          suffix="%"
          min={0}
          max={100}
          step={5}
          value={weightValue}
          onChange={onWeightChange}
          disabled={disabled}
        />
        <SuffixNumberField
          label="Mín."
          suffix="min"
          min={1}
          max={60}
          step={1}
          value={minMinValue}
          onChange={onMinMinChange}
          disabled={disabled}
        />
        <SuffixNumberField
          label="Máx."
          suffix="min"
          min={1}
          max={120}
          step={1}
          value={maxMinValue}
          onChange={onMaxMinChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

/** Returns a human-readable label for day-rhythm factor values */
function factorLabel(factor: number): string {
  if (factor > 100) return 'mais lento'
  if (factor < 100) return 'mais rápido'
  return 'normal'
}
