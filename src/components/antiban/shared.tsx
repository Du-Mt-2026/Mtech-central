'use client'

// ============================================================
// Anti-Ban Tab — Shared types, helpers, constants, and
// inline sub-components used across all section files.
//
// Extracted verbatim from the original src/components/antiban-tab.tsx
// during the P2.1 refactor. NO logic changes — pure mechanical
// extraction so the section files can import a single shared module.
// ============================================================

import React from 'react'
import {
  RotateCcw, Type, Timer, Flame, Baby, CheckCircle2,
  Clock, AlertCircle, UserPlus, EyeOff, ShieldAlert, MessageCircle,
  Star, Brain, Activity, Zap, Coffee, Sun,
  BarChart3, Wifi, Search, Server, Info,
  LayoutGrid, Network, ScanSearch, ShieldCheck, Settings2, ChevronRight,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  type ScheduleEntry,
  type BreakWindow,
} from '@/lib/constants'

// ============================================================
// Types
// ============================================================

export type SectionId =
  | 'basico'
  | 'aquecimento'
  | 'comportamento'
  | 'reconexao'
  | 'verificador'
  | 'seguranca'
  | 'avancado'

export interface SidebarSection {
  id: SectionId
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string // tailwind classes for icon tint when active
}

export interface FieldRegistryEntry {
  id: string
  label: string
  description?: string
  section: SectionId
}

// ============================================================
// Static config: sidebar sections
// ============================================================

export const SIDEBAR_SECTIONS: SidebarSection[] = [
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

export const FIELD_REGISTRY: FieldRegistryEntry[] = [
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
export function minsToTime(mins: number) {
  const m = Math.max(0, Math.min(1440, mins))
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Convert HH:MM string to minutes-from-midnight */
export function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Parse break windows from raw JSON data */
export function parseBreakWindows(raw: unknown): BreakWindow[] {
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
export function parseScheduleFromSettings(jsonStr: string | undefined, fallback: ScheduleEntry[]): ScheduleEntry[] {
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
// Helper sub-components (inline)
// ============================================================

/** Big section heading shown at the top of each main panel */
export function SectionHeading({
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
export function FieldCard({
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
export function ResetIconButton({ onClick, title }: { onClick: () => void; title: string }) {
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
export function SuffixNumberField({
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
export function ToggleRow({
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
export function FieldNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground leading-relaxed">
      {children}
    </div>
  )
}

/** Editor for one pause tier (short/medium/long) in the Nonlinear Pauses card */
export function PauseTierEditor({
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
export function factorLabel(factor: number): string {
  if (factor > 100) return 'mais lento'
  if (factor < 100) return 'mais rápido'
  return 'normal'
}
