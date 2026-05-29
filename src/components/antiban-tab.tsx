'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  RotateCcw, RefreshCw, Type, Timer, Flame, Baby, CheckCircle2,
  Clock, AlertCircle, UserPlus, EyeOff, ShieldAlert, MessageCircle,
  Plus, Trash2, Star, Brain, ChevronDown, ChevronUp, Activity, Zap,
  Coffee, Sun, Moon, BarChart3, Wifi, PhoneOff, Search, Server,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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
  type ClusterConfig,
  type CooldownPresenceConfig,
  type DayRhythmConfig,
  type NonlinearPausesConfig,
  type PauseTier,
} from '@/lib/constants'
import { toMins } from '@/lib/time-utils'

// ===== Anti-Ban Tab =====
export function AntiBanTab() {
  const [settings, setSettings] = useState<AntiBanSettings | null>(null)
  const [breakWindows, setBreakWindows] = useState<BreakWindow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [humanBehaviorExpanded, setHumanBehaviorExpanded] = useState(false)
  const [humanBehavior, setHumanBehavior] = useState<HumanBehaviorConfig>(DEFAULT_HUMAN_BEHAVIOR)
  const [banCodesText, setBanCodesText] = useState('')
  const [restrictionKeywordsText, setRestrictionKeywordsText] = useState('')
  const [warningKeywordsText, setWarningKeywordsText] = useState('')

  // Convert minutes-from-midnight to HH:MM string
  const minsToTime = (mins: number) => {
    const m = Math.max(0, Math.min(1440, mins))
    const h = Math.floor(m / 60)
    const min = m % 60
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }

  // Convert HH:MM string to minutes-from-midnight
  const timeToMins = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  // Helper to parse break windows from raw JSON data
  const parseBreakWindows = (raw: unknown): BreakWindow[] => {
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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/antiban')
      const data = await res.json()
      setSettings(data)
      // Parse breakWindows from JSON string
      try {
        const parsed = typeof data.breakWindows === 'string' ? JSON.parse(data.breakWindows) : (data.breakWindows || [])
        setBreakWindows(parseBreakWindows(parsed))
      } catch { setBreakWindows([]) }
      // Parse humanBehaviorConfig from JSON string
      try {
        const hbParsed = typeof data.humanBehaviorConfig === 'string' ? JSON.parse(data.humanBehaviorConfig) : (data.humanBehaviorConfig || DEFAULT_HUMAN_BEHAVIOR)
        setHumanBehavior(hbParsed)
      } catch { setHumanBehavior(DEFAULT_HUMAN_BEHAVIOR) }
      // Parse banCodes from JSON string
      try {
        const parsed = typeof data.banCodes === 'string' ? JSON.parse(data.banCodes) : (data.banCodes || [])
        setBanCodesText(Array.isArray(parsed) ? parsed.join(', ') : '')
      } catch { setBanCodesText('') }
      // Parse restrictionKeywords from JSON string
      try {
        const parsed = typeof data.restrictionKeywords === 'string' ? JSON.parse(data.restrictionKeywords) : (data.restrictionKeywords || [])
        setRestrictionKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
      } catch { setRestrictionKeywordsText('') }
      // Parse warningKeywords from JSON string
      try {
        const parsed = typeof data.warningKeywords === 'string' ? JSON.parse(data.warningKeywords) : (data.warningKeywords || [])
        setWarningKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
      } catch { setWarningKeywordsText('') }
    } catch { toast.error('Erro ao carregar configurações') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const updateSetting = async (key: string, value: unknown) => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) })
      const updated = await res.json()
      setSettings(updated)
      // Re-parse breakWindows if it was updated
      if (key === 'breakWindows') {
        try {
          const parsed = typeof updated.breakWindows === 'string' ? JSON.parse(updated.breakWindows) : (updated.breakWindows || [])
          setBreakWindows(parseBreakWindows(parsed))
        } catch { setBreakWindows([]) }
      }
      // Re-parse humanBehaviorConfig if it was updated
      if (key === 'humanBehaviorConfig') {
        try {
          const hbParsed = typeof updated.humanBehaviorConfig === 'string' ? JSON.parse(updated.humanBehaviorConfig) : (updated.humanBehaviorConfig || DEFAULT_HUMAN_BEHAVIOR)
          setHumanBehavior(hbParsed)
        } catch { setHumanBehavior(DEFAULT_HUMAN_BEHAVIOR) }
      }
      // Re-parse banCodes if it was updated
      if (key === 'banCodes') {
        try {
          const parsed = typeof updated.banCodes === 'string' ? JSON.parse(updated.banCodes) : (updated.banCodes || [])
          setBanCodesText(Array.isArray(parsed) ? parsed.join(', ') : '')
        } catch { setBanCodesText('') }
      }
      // Re-parse restrictionKeywords if it was updated
      if (key === 'restrictionKeywords') {
        try {
          const parsed = typeof updated.restrictionKeywords === 'string' ? JSON.parse(updated.restrictionKeywords) : (updated.restrictionKeywords || [])
          setRestrictionKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
        } catch { setRestrictionKeywordsText('') }
      }
      // Re-parse warningKeywords if it was updated
      if (key === 'warningKeywords') {
        try {
          const parsed = typeof updated.warningKeywords === 'string' ? JSON.parse(updated.warningKeywords) : (updated.warningKeywords || [])
          setWarningKeywordsText(Array.isArray(parsed) ? parsed.join('\n') : '')
        } catch { setWarningKeywordsText('') }
      }
      toast.success('Configuração atualizada!')
    } catch { toast.error('Erro ao atualizar') }
    finally { setSaving(false) }
  }

  // Break window helpers
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

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  if (!settings) return null

  // Parse schedules from settings (loaded from DB)
  const parseScheduleFromSettings = (jsonStr: string | undefined, fallback: ScheduleEntry[]): ScheduleEntry[] => {
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

  const nurserySchedule = parseScheduleFromSettings(settings.nurserySchedule, NURSERY_SCHEDULE)
  const prewarmSchedule = parseScheduleFromSettings(settings.prewarmSchedule, PREWARM_SCHEDULE)
  const maxNursery = nurserySchedule[nurserySchedule.length - 1]?.limit || 80
  const maxPrewarm = prewarmSchedule[prewarmSchedule.length - 1]?.limit || 200

  // Update a single schedule entry limit
  const updateScheduleEntry = async (scheduleType: 'nurserySchedule' | 'prewarmSchedule', index: number, newLimit: number) => {
    if (!settings) return
    const currentSchedule = scheduleType === 'nurserySchedule' ? nurserySchedule : prewarmSchedule
    const updated = [...currentSchedule]
    updated[index] = { ...updated[index], limit: newLimit }
    await updateSetting(scheduleType, updated)
  }

  // Update readyDailyLimit
  const updateReadyDailyLimit = async (newLimit: number) => {
    await updateSetting('readyDailyLimit', newLimit)
  }

  // Helper to update a nested path inside humanBehaviorConfig
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

  const tips = [
    { icon: Clock, title: 'Varie os horários de envio', desc: 'Não envie sempre no mesmo horário' },
    { icon: AlertCircle, title: 'Não envie links no primeiro dia', desc: 'Espere o chip aquecer antes' },
    { icon: UserPlus, title: 'Use mensagens personalizadas com {nome}', desc: 'Mensagens genéricas são mais detectáveis' },
    { icon: Flame, title: 'Aqueça chips novos gradualmente', desc: 'Comece com poucas mensagens' },
    { icon: RefreshCw, title: 'Alterne entre chips a cada 50 mensagens', desc: 'Distribua o envio entre múltiplos chips' },
    { icon: EyeOff, title: 'Evite mensagens idênticas para muitos contatos', desc: 'Use variações de texto' },
  ]

  // Backward-compat minutes for sending window display
  const windowStartMins = toMins(settings.sendingWindowStart)
  const windowEndMins = toMins(settings.sendingWindowEnd)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Anti-Ban</h2>
          <p className="text-sm text-muted-foreground">Configurações de envio para minimizar risco de bloqueios</p>
        </div>
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

      {/* Reset Confirmation Dialog */}
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

      {/* Row 1: Typing Simulation + Message Interval */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Typing Simulation */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Type className="size-3.5 text-amber-600" />
                </div>
                <CardTitle className="text-base">Simulação de Digitação</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-amber-600 gap-1 h-7" onClick={() => resetSection('typing', 'Simulação de Digitação')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Atraso mínimo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-amber-600" onClick={() => resetField('typingMinDelay')} title={`Padrão: ${DEFAULTS.typingMinDelay}ms`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1000} max={10000} step={100} value={settings.typingMinDelay} onChange={e => updateSetting('typingMinDelay', Math.max(1000, parseInt(e.target.value) || 1000))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">ms</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Atraso máximo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-amber-600" onClick={() => resetField('typingMaxDelay')} title={`Padrão: ${DEFAULTS.typingMaxDelay}ms`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={2000} max={30000} step={100} value={settings.typingMaxDelay} onChange={e => updateSetting('typingMaxDelay', Math.max(2000, parseInt(e.target.value) || 2000))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">ms</span>
                </div>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-emerald-600">
                  <MessageCircle className="size-3.5" />
                  <span className="text-xs">Digitando</span>
                  <span className="animate-pulse text-xs">...</span>
                </div>
                <span className="text-[11px] text-muted-foreground">({settings.typingMinDelay}–{settings.typingMaxDelay}ms)</span>
                <span className="text-xs">→ Olá, tudo bem?</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Message Interval */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                  <Timer className="size-3.5 text-sky-600" />
                </div>
                <CardTitle className="text-base">Intervalo entre Mensagens</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-sky-600 gap-1 h-7" onClick={() => resetSection('interval', 'Intervalo entre Mensagens')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo mínimo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-sky-600" onClick={() => resetField('messageIntervalMin')} title={`Padrão: ${DEFAULTS.messageIntervalMin}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={120} step={1} value={settings.messageIntervalMin} onChange={e => updateSetting('messageIntervalMin', Math.max(1, parseInt(e.target.value) || 1))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo máximo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-sky-600" onClick={() => resetField('messageIntervalMax')} title={`Padrão: ${DEFAULTS.messageIntervalMax}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={300} step={1} value={settings.messageIntervalMax} onChange={e => updateSetting('messageIntervalMax', Math.max(1, parseInt(e.target.value) || 1))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
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
              <p className="text-[11px] text-muted-foreground mt-1.5">Aleatório entre {settings.messageIntervalMin}–{settings.messageIntervalMax}s</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Progressive Warming (full width) + Cooldown & Limits */}
      <div className="grid grid-cols-1 gap-4">
        {/* Progressive Warming — Full Width with Two Phases */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                  <Flame className="size-3.5 text-orange-600" />
                </div>
                <CardTitle className="text-base">Aquecimento Progressivo</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={settings.warmingEnabled} onCheckedChange={v => updateSetting('warmingEnabled', v)} />
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-orange-600 gap-1 h-7" onClick={() => resetSection('warming', 'Aquecimento Progressivo')} disabled={saving}>
                  <RotateCcw className="size-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Phase Overview — 3 Phases */}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <Baby className="size-4 text-amber-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Berçário</p>
                  <p className="text-[10px] text-muted-foreground">14 dias • Até {maxNursery} msg/dia</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                <Flame className="size-4 text-orange-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Pré-aquecido</p>
                  <p className="text-[10px] text-muted-foreground">20 dias • 11→{maxPrewarm} msg/dia</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Aquecido</p>
                  <p className="text-[10px] text-muted-foreground">{settings.readyDailyLimit || 200} msg/dia (editável)</p>
                </div>
              </div>
            </div>

            {/* Three-phase schedule tables */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Phase 1: Nursery (Berçário) — Editable */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-5 items-center justify-center rounded bg-amber-100 dark:bg-amber-900/30">
                    <Baby className="size-3 text-amber-600" />
                  </div>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Fase 1: Berçário (Chip Novo)</span>
                </div>
                <div className="space-y-1.5">
                  {nurserySchedule.map((entry, i) => {
                    const pct = Math.max(5, (entry.limit / maxNursery) * 100)
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-10 shrink-0 text-right">Dia {entry.dayRange}</span>
                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full flex items-center justify-end pr-1"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: i * 0.1 }}
                          >
                            <span className="text-[9px] font-bold text-white">{entry.limit}</span>
                          </motion.div>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={entry.limit}
                          onChange={e => {
                            const val = Math.max(1, parseInt(e.target.value) || 1)
                            updateScheduleEntry('nurserySchedule', i, val)
                          }}
                          className="w-14 h-5 text-[10px] px-1 text-center border-amber-200 dark:border-amber-800"
                          disabled={saving}
                        />
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 italic">Após 14 dias → chip pré-aquecido</p>
              </div>

              {/* Phase 2: Prewarm (Pré-aquecido) — Editable */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-5 items-center justify-center rounded bg-orange-100 dark:bg-orange-900/30">
                    <Flame className="size-3 text-orange-600" />
                  </div>
                  <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">Fase 2: Pré-aquecido (Ramp-up)</span>
                </div>
                <div className="space-y-1 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                  {prewarmSchedule.map((entry, i) => {
                    const pct = Math.max(5, (entry.limit / maxPrewarm) * 100)
                    return (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground w-6 shrink-0 text-right">D{entry.dayRange}</span>
                        <div className="flex-1 h-3.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-orange-400 to-emerald-500 rounded-full flex items-center justify-end pr-1"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, delay: i * 0.05 }}
                          >
                            {pct > 15 && <span className="text-[8px] font-bold text-white">{entry.limit}</span>}
                          </motion.div>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={500}
                          value={entry.limit}
                          onChange={e => {
                            const val = Math.max(1, parseInt(e.target.value) || 1)
                            updateScheduleEntry('prewarmSchedule', i, val)
                          }}
                          className="w-14 h-5 text-[10px] px-1 text-center border-orange-200 dark:border-orange-800"
                          disabled={saving}
                        />
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 italic">Após 20 dias → chip aquecido</p>
              </div>

              {/* Phase 3: Aquecido (Ready) — Editable */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-5 items-center justify-center rounded bg-emerald-100 dark:bg-emerald-900/30">
                    <CheckCircle2 className="size-3 text-emerald-600" />
                  </div>
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Fase 3: Aquecido</span>
                </div>
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-3">
                  <div className="text-center">
                    <CheckCircle2 className="size-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Chip Aquecido</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Sem restrições de aquecimento. Limite diário configurável.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Limite diário por chip</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={5000}
                        step={1}
                        value={settings.readyDailyLimit || 200}
                        onChange={e => updateReadyDailyLimit(Math.max(1, parseInt(e.target.value) || 200))}
                        className="w-24 h-8 text-sm border-emerald-200 dark:border-emerald-800"
                        disabled={saving}
                      />
                      <span className="text-[11px] text-muted-foreground">msgs/dia</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Limite por hora por chip</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        value={settings.hourlyLimit || 30}
                        onChange={e => updateSetting('hourlyLimit', Math.max(1, parseInt(e.target.value) || 30))}
                        className="w-24 h-8 text-sm border-emerald-200 dark:border-emerald-800"
                        disabled={saving}
                      />
                      <span className="text-[11px] text-muted-foreground">msgs/hora</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline visual */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[11px] font-medium mb-2">Timeline completa do aquecimento</p>
              <div className="flex items-center gap-0.5">
                {/* Nursery phase: 14 days */}
                {Array.from({ length: 14 }, (_, i) => {
                  const day = i + 1
                  const limit = nurserySchedule.find(s => day >= s.days[0] && day <= s.days[1])?.limit || 10
                  return (
                    <div
                      key={`n-${i}`}
                      className="flex-1 h-5 rounded-sm bg-amber-400 flex items-center justify-center"
                      title={`Berçário Dia ${day}: ${limit} msg/dia`}
                    >
                      <span className="text-[7px] font-bold text-white">{limit}</span>
                    </div>
                  )
                })}
                {/* Prewarm phase: 20 days */}
                {Array.from({ length: 20 }, (_, i) => {
                  const day = i + 1
                  const entry = prewarmSchedule.find(s => day >= s.days[0] && day <= s.days[1])
                  const limit = entry?.limit || 11
                  const intensity = limit / maxPrewarm
                  return (
                    <div
                      key={`p-${i}`}
                      className="flex-1 h-5 rounded-sm flex items-center justify-center"
                      style={{ backgroundColor: `rgba(16, 185, 129, ${0.2 + intensity * 0.8})` }}
                      title={`Pré-aquecido Dia ${day}: ${limit} msg/dia`}
                    >
                      <span className="text-[7px] font-bold text-white">{limit}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-amber-600 font-medium">← Berçário (14 dias)</span>
                <span className="text-[9px] text-emerald-600 font-medium">Aquecido ({settings.readyDailyLimit || 200}/dia) ✓</span>
                <span className="text-[9px] text-orange-600 font-medium">Pré-aquecido (20 dias) →</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2.5: Cooldown & Limits + Sending Window */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
                  <ShieldAlert className="size-3.5 text-rose-600" />
                </div>
                <CardTitle className="text-base">Cooldown & Limites</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-rose-600 gap-1 h-7" onClick={() => resetSection('cooldown', 'Cooldown & Limites')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Limite diário/chip</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('dailyLimitPerChip')} title={`Padrão: ${DEFAULTS.dailyLimitPerChip}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={500} step={1} value={settings.dailyLimitPerChip} onChange={e => updateSetting('dailyLimitPerChip', Math.max(1, parseInt(e.target.value) || 1))} className="w-24 h-8 text-sm" />
                <span className="text-[11px] text-muted-foreground">msgs</span>
              </div>
            </div>

            {/* Variable Cooldown Duration — min/max range */}
            <div className="border-t pt-3">
              <Label className="text-xs font-semibold">Duração do Cooldown</Label>
              <p className="text-[10px] text-muted-foreground mb-2">O sistema escolhe aleatoriamente entre mín e máx a cada ciclo</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={1} max={120} step={1} value={settings.cooldownMinutes} onChange={e => {
                      const val = Math.max(1, parseInt(e.target.value) || 1)
                      updateSetting('cooldownMinutes', val)
                      if (settings.cooldownMinutesMax < val) updateSetting('cooldownMinutesMax', val)
                    }} className="w-20 h-8 text-sm" />
                    <span className="text-[11px] text-muted-foreground">min</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={settings.cooldownMinutes} max={180} step={1} value={settings.cooldownMinutesMax} onChange={e => updateSetting('cooldownMinutesMax', Math.max(settings.cooldownMinutes, parseInt(e.target.value) || settings.cooldownMinutes))} className="w-20 h-8 text-sm" />
                    <span className="text-[11px] text-muted-foreground">min</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Variable Cooldown Threshold — min/max range */}
            <div className="border-t pt-3">
              <Label className="text-xs font-semibold">Cooldown após N mensagens</Label>
              <p className="text-[10px] text-muted-foreground mb-2">Após enviar entre mín e máx mensagens, o chip entra em cooldown</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={1} max={100} step={1} value={settings.cooldownAfterMessages} onChange={e => {
                      const val = Math.max(1, parseInt(e.target.value) || 1)
                      updateSetting('cooldownAfterMessages', val)
                      if (settings.cooldownAfterMessagesMax < val) updateSetting('cooldownAfterMessagesMax', val)
                    }} className="w-20 h-8 text-sm" />
                    <span className="text-[11px] text-muted-foreground">msgs</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={settings.cooldownAfterMessages} max={200} step={1} value={settings.cooldownAfterMessagesMax} onChange={e => updateSetting('cooldownAfterMessagesMax', Math.max(settings.cooldownAfterMessages, parseInt(e.target.value) || settings.cooldownAfterMessages))} className="w-20 h-8 text-sm" />
                    <span className="text-[11px] text-muted-foreground">msgs</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[11px] text-muted-foreground">
                Após enviar <strong>{settings.cooldownAfterMessages === settings.cooldownAfterMessagesMax ? settings.cooldownAfterMessages : `${settings.cooldownAfterMessages}-${settings.cooldownAfterMessagesMax}`}</strong> mensagens, o chip faz uma pausa de <strong>{settings.cooldownMinutes === settings.cooldownMinutesMax ? settings.cooldownMinutes : `${settings.cooldownMinutes}-${settings.cooldownMinutesMax}`}</strong> min. Valores são aleatórios dentro dos ranges.
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs font-medium">Parada em Aviso</p>
                <p className="text-[10px] text-muted-foreground">Para ao detectar aviso</p>
              </div>
              <div className="flex items-center gap-1">
                <Switch checked={settings.stopOnWarning} onCheckedChange={v => updateSetting('stopOnWarning', v)} />
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('stopOnWarning')} title="Restaurar padrão">
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs font-medium">Preview de Links</p>
                <p className="text-[10px] text-muted-foreground">Mostra preview de URLs nas mensagens (desativado por padrão — previews em massa são detectáveis como bot)</p>
              </div>
              <div className="flex items-center gap-1">
                <Switch checked={settings.linkPreviewEnabled} onCheckedChange={v => updateSetting('linkPreviewEnabled', v)} />
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('linkPreviewEnabled')} title="Restaurar padrão">
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sending Window */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                  <Clock className="size-3.5 text-violet-600" />
                </div>
                <CardTitle className="text-base">Janela de Envio</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-violet-600 gap-1 h-7" onClick={() => resetSection('sendingWindow', 'Janela de Envio')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Início</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-violet-600" onClick={() => resetField('sendingWindowStart')} title={`Padrão: ${minsToTime(DEFAULTS.sendingWindowStart as number)}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <Select
                  value={String(windowStartMins)}
                  onValueChange={v => updateSetting('sendingWindowStart', parseInt(v))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {Array.from({ length: 289 }, (_, i) => i * 5).map(mins => (
                      <SelectItem key={mins} value={String(mins)}>
                        {minsToTime(mins)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Término</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-violet-600" onClick={() => resetField('sendingWindowEnd')} title={`Padrão: ${minsToTime(DEFAULTS.sendingWindowEnd as number)}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <Select
                  value={String(windowEndMins)}
                  onValueChange={v => updateSetting('sendingWindowEnd', parseInt(v))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
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
                      className={`flex-1 h-5 rounded-sm ${isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                      title={`${i}h`}
                    />
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">Envio permitido das <strong>{minsToTime(windowStartMins)}</strong> às <strong>{minsToTime(windowEndMins)}</strong> (fuso: {settings.timezone})</p>
            </div>

            {/* Break Windows — Pausas dentro da janela */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label className="text-xs font-semibold">Pausas dentro da janela</Label>
                  <p className="text-[10px] text-muted-foreground">Almoço, reuniões, etc. O envio para e retoma automaticamente.</p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs text-orange-500 border-orange-500/30 hover:bg-orange-500/10" onClick={addBreakWindow} disabled={saving}>
                  <Plus className="size-3 mr-1" />
                  Adicionar Pausa
                </Button>
              </div>
              {breakWindows.length === 0 ? (
                <div className="text-center py-2 bg-muted/30 rounded-lg">
                  <p className="text-[10px] text-muted-foreground">Nenhuma pausa configurada</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {breakWindows.map((bw, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-orange-500/5 border border-orange-500/20 rounded-lg p-2">
                      <Input
                        type="time"
                        value={minsToTime(bw.start)}
                        onChange={e => updateBreakWindow(idx, 'start', timeToMins(e.target.value))}
                        className="w-28 h-7 text-xs"
                      />
                      <span className="text-[10px] text-muted-foreground">até</span>
                      <Input
                        type="time"
                        value={minsToTime(bw.end)}
                        onChange={e => updateBreakWindow(idx, 'end', timeToMins(e.target.value))}
                        className="w-28 h-7 text-xs"
                      />
                      <Input
                        type="text"
                        value={bw.label}
                        onChange={e => updateBreakWindow(idx, 'label', e.target.value)}
                        placeholder="Ex: Almoço"
                        className="flex-1 h-7 text-xs"
                      />
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => removeBreakWindow(idx)} disabled={saving}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Human Behavior — Collapsible Section */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div
                className="flex items-center gap-2 cursor-pointer flex-1"
                onClick={() => setHumanBehaviorExpanded(!humanBehaviorExpanded)}
              >
                <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                  <Brain className="size-3.5 text-cyan-600" />
                </div>
                <CardTitle className="text-base">Comportamento Humano</CardTitle>
                <span className="text-[10px] text-muted-foreground ml-1">Simula padrões de uso reais</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={settings.humanBehaviorEnabled ?? true} onCheckedChange={v => updateSetting('humanBehaviorEnabled', v)} />
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-cyan-600 gap-1 h-7" onClick={() => resetSection('humanBehavior', 'Comportamento Humano')} disabled={saving}>
                  <RotateCcw className="size-3" />
                </Button>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1 h-7" onClick={() => setHumanBehaviorExpanded(!humanBehaviorExpanded)}>
                  {humanBehaviorExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </Button>
              </div>
            </div>
          </CardHeader>
          {humanBehaviorExpanded && settings.humanBehaviorEnabled !== false && (
            <CardContent className="space-y-5">
              {/* Cluster Sending */}
              <div className="border border-cyan-200 dark:border-cyan-800 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="size-4 text-cyan-600" />
                    <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-400">Envio em Clusters</span>
                    <span className="text-[10px] text-muted-foreground">Rajadas de mensagens com micro-pausas</span>
                  </div>
                  <Switch
                    checked={humanBehavior.cluster?.enabled ?? true}
                    onCheckedChange={v => updateHumanBehavior('cluster.enabled', v)}
                  />
                </div>
                {humanBehavior.cluster?.enabled !== false && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Tamanho do cluster (min-max)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min={2} max={6} step={1} value={humanBehavior.cluster?.minSize ?? 2} onChange={e => updateHumanBehavior('cluster.minSize', Math.max(2, parseInt(e.target.value) || 2))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">-</span>
                        <Input type="number" min={2} max={8} step={1} value={humanBehavior.cluster?.maxSize ?? 4} onChange={e => updateHumanBehavior('cluster.maxSize', Math.max(2, parseInt(e.target.value) || 4))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">msgs</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Micro-pausa entre msgs (seg)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min={1} max={30} step={1} value={humanBehavior.cluster?.microPauseMinSec ?? 3} onChange={e => updateHumanBehavior('cluster.microPauseMinSec', Math.max(1, parseInt(e.target.value) || 3))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">-</span>
                        <Input type="number" min={1} max={60} step={1} value={humanBehavior.cluster?.microPauseMaxSec ?? 8} onChange={e => updateHumanBehavior('cluster.microPauseMaxSec', Math.max(1, parseInt(e.target.value) || 8))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">s</span>
                      </div>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Pausa após cluster (seg)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min={10} max={300} step={5} value={humanBehavior.cluster?.afterClusterPauseMinSec ?? 30} onChange={e => updateHumanBehavior('cluster.afterClusterPauseMinSec', Math.max(10, parseInt(e.target.value) || 30))} className="w-16 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">-</span>
                        <Input type="number" min={10} max={600} step={5} value={humanBehavior.cluster?.afterClusterPauseMaxSec ?? 90} onChange={e => updateHumanBehavior('cluster.afterClusterPauseMaxSec', Math.max(10, parseInt(e.target.value) || 90))} className="w-16 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">s</span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-2 bg-muted/50 rounded text-[10px] text-muted-foreground">
                  Humano: manda 2-4 msgs rápidas, faz pausa, mais 3 msgs, pausa longa...
                </div>
              </div>

              {/* Cooldown Presence */}
              <div className="border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coffee className="size-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Presença no Cooldown</span>
                    <span className="text-[10px] text-muted-foreground">Aparece online durante pausas</span>
                  </div>
                  <Switch
                    checked={humanBehavior.cooldownPresence?.enabled ?? true}
                    onCheckedChange={v => updateHumanBehavior('cooldownPresence.enabled', v)}
                  />
                </div>
                {humanBehavior.cooldownPresence?.enabled !== false && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Chance de aparecer</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min={5} max={100} step={5} value={humanBehavior.cooldownPresence?.chancePercent ?? 40} onChange={e => updateHumanBehavior('cooldownPresence.chancePercent', Math.max(5, parseInt(e.target.value) || 40))} className="w-16 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">%</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Duração online (seg)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min={2} max={120} step={1} value={humanBehavior.cooldownPresence?.durationMinSec ?? 5} onChange={e => updateHumanBehavior('cooldownPresence.durationMinSec', Math.max(2, parseInt(e.target.value) || 5))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">-</span>
                        <Input type="number" min={2} max={120} step={1} value={humanBehavior.cooldownPresence?.durationMaxSec ?? 25} onChange={e => updateHumanBehavior('cooldownPresence.durationMaxSec', Math.max(2, parseInt(e.target.value) || 25))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">s</span>
                      </div>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Intervalo entre aparições (min)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min={1} max={30} step={1} value={humanBehavior.cooldownPresence?.intervalMinMin ?? 2} onChange={e => updateHumanBehavior('cooldownPresence.intervalMinMin', Math.max(1, parseInt(e.target.value) || 2))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">-</span>
                        <Input type="number" min={1} max={60} step={1} value={humanBehavior.cooldownPresence?.intervalMaxMin ?? 5} onChange={e => updateHumanBehavior('cooldownPresence.intervalMaxMin', Math.max(1, parseInt(e.target.value) || 5))} className="w-14 h-7 text-[11px]" disabled={saving} />
                        <span className="text-[10px] text-muted-foreground">min</span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-2 bg-muted/50 rounded text-[10px] text-muted-foreground">
                  Humano: durante pausa, abre WhatsApp pra checar msgs, depois fecha. Bot fica 100% offline = detectável.
                </div>
              </div>

              {/* Day Rhythm */}
              <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sun className="size-4 text-amber-600" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Ritmo do Dia</span>
                    <span className="text-[10px] text-muted-foreground">Velocidade varia por horário</span>
                  </div>
                  <Switch
                    checked={humanBehavior.dayRhythm?.enabled ?? true}
                    onCheckedChange={v => updateHumanBehavior('dayRhythm.enabled', v)}
                  />
                </div>
                {humanBehavior.dayRhythm?.enabled !== false && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 w-28">
                        <Sun className="size-3 text-amber-500" />
                        <span className="text-[10px] text-muted-foreground">Manhã (9-12h)</span>
                      </div>
                      <Input type="number" min={50} max={300} step={5} value={humanBehavior.dayRhythm?.morningFactor ?? 130} onChange={e => updateHumanBehavior('dayRhythm.morningFactor', Math.max(50, parseInt(e.target.value) || 130))} className="w-16 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">%{((humanBehavior.dayRhythm?.morningFactor ?? 130) > 100) ? ' (mais lento)' : ((humanBehavior.dayRhythm?.morningFactor ?? 130) < 100) ? ' (mais rápido)' : ' (normal)'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 w-28">
                        <Sun className="size-3 text-orange-500" />
                        <span className="text-[10px] text-muted-foreground">Meio-dia (12-14h)</span>
                      </div>
                      <Input type="number" min={50} max={300} step={5} value={humanBehavior.dayRhythm?.middayFactor ?? 80} onChange={e => updateHumanBehavior('dayRhythm.middayFactor', Math.max(50, parseInt(e.target.value) || 80))} className="w-16 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">%{((humanBehavior.dayRhythm?.middayFactor ?? 80) > 100) ? ' (mais lento)' : ((humanBehavior.dayRhythm?.middayFactor ?? 80) < 100) ? ' (mais rápido)' : ' (normal)'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 w-28">
                        <Moon className="size-3 text-violet-500" />
                        <span className="text-[10px] text-muted-foreground">Tarde (14-17h)</span>
                      </div>
                      <Input type="number" min={50} max={300} step={5} value={humanBehavior.dayRhythm?.afternoonFactor ?? 100} onChange={e => updateHumanBehavior('dayRhythm.afternoonFactor', Math.max(50, parseInt(e.target.value) || 100))} className="w-16 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">%{((humanBehavior.dayRhythm?.afternoonFactor ?? 100) > 100) ? ' (mais lento)' : ((humanBehavior.dayRhythm?.afternoonFactor ?? 100) < 100) ? ' (mais rápido)' : ' (normal)'}</span>
                    </div>
                  </div>
                )}
                <div className="p-2 bg-muted/50 rounded text-[10px] text-muted-foreground">
                  100% = velocidade normal. &gt;100% = mais lento (multiplica o intervalo). &lt;100% = mais rápido. Humano é mais devagar de manhã e noite.
                </div>
              </div>

              {/* Non-linear Pauses */}
              <div className="border border-violet-200 dark:border-violet-800 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-violet-600" />
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-400">Pausas Não-Lineares</span>
                    <span className="text-[10px] text-muted-foreground">Distribuição realista de pausas</span>
                  </div>
                  <Switch
                    checked={humanBehavior.nonlinearPauses?.enabled ?? true}
                    onCheckedChange={v => updateHumanBehavior('nonlinearPauses.enabled', v)}
                  />
                </div>
                {humanBehavior.nonlinearPauses?.enabled !== false && (
                  <div className="space-y-2">
                    {/* Short */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-14 text-right text-muted-foreground shrink-0">Curta</span>
                      <Input type="number" min={0} max={100} step={5} value={humanBehavior.nonlinearPauses?.short?.weight ?? 40} onChange={e => updateHumanBehavior('nonlinearPauses.short.weight', Math.max(0, parseInt(e.target.value) || 40))} className="w-14 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">%</span>
                      <Input type="number" min={1} max={60} step={1} value={humanBehavior.nonlinearPauses?.short?.minMin ?? 2} onChange={e => updateHumanBehavior('nonlinearPauses.short.minMin', Math.max(1, parseInt(e.target.value) || 2))} className="w-12 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">-</span>
                      <Input type="number" min={1} max={120} step={1} value={humanBehavior.nonlinearPauses?.short?.maxMin ?? 5} onChange={e => updateHumanBehavior('nonlinearPauses.short.maxMin', Math.max(1, parseInt(e.target.value) || 5))} className="w-12 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">min</span>
                    </div>
                    {/* Medium */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-14 text-right text-muted-foreground shrink-0">Média</span>
                      <Input type="number" min={0} max={100} step={5} value={humanBehavior.nonlinearPauses?.medium?.weight ?? 40} onChange={e => updateHumanBehavior('nonlinearPauses.medium.weight', Math.max(0, parseInt(e.target.value) || 40))} className="w-14 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">%</span>
                      <Input type="number" min={1} max={60} step={1} value={humanBehavior.nonlinearPauses?.medium?.minMin ?? 8} onChange={e => updateHumanBehavior('nonlinearPauses.medium.minMin', Math.max(1, parseInt(e.target.value) || 8))} className="w-12 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">-</span>
                      <Input type="number" min={1} max={120} step={1} value={humanBehavior.nonlinearPauses?.medium?.maxMin ?? 15} onChange={e => updateHumanBehavior('nonlinearPauses.medium.maxMin', Math.max(1, parseInt(e.target.value) || 15))} className="w-12 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">min</span>
                    </div>
                    {/* Long */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-14 text-right text-muted-foreground shrink-0">Longa</span>
                      <Input type="number" min={0} max={100} step={5} value={humanBehavior.nonlinearPauses?.long?.weight ?? 20} onChange={e => updateHumanBehavior('nonlinearPauses.long.weight', Math.max(0, parseInt(e.target.value) || 20))} className="w-14 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">%</span>
                      <Input type="number" min={1} max={60} step={1} value={humanBehavior.nonlinearPauses?.long?.minMin ?? 20} onChange={e => updateHumanBehavior('nonlinearPauses.long.minMin', Math.max(1, parseInt(e.target.value) || 20))} className="w-12 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">-</span>
                      <Input type="number" min={1} max={120} step={1} value={humanBehavior.nonlinearPauses?.long?.maxMin ?? 35} onChange={e => updateHumanBehavior('nonlinearPauses.long.maxMin', Math.max(1, parseInt(e.target.value) || 35))} className="w-12 h-7 text-[11px]" disabled={saving} />
                      <span className="text-[10px] text-muted-foreground">min</span>
                    </div>
                    {/* Visual bar */}
                    <div className="flex h-3 rounded-full overflow-hidden mt-1">
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
                )}
                <div className="p-2 bg-muted/50 rounded text-[10px] text-muted-foreground">
                  Humano: pausa curta (foi ao banheiro), média (café), longa (almoçou/ligação). Bot sempre faz a mesma pausa = padrão detectável.
                </div>
              </div>

              {/* Summary */}
              <div className="p-3 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg border border-cyan-200 dark:border-cyan-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <Activity className="size-3.5 text-cyan-600" />
                  <span className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-400">Resumo do Comportamento</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {humanBehavior.cluster?.enabled !== false && (
                    <>Clusters de {humanBehavior.cluster?.minSize ?? 2}-{humanBehavior.cluster?.maxSize ?? 4} msgs com pausa de {humanBehavior.cluster?.microPauseMinSec ?? 3}-{humanBehavior.cluster?.microPauseMaxSec ?? 8}s entre elas. </>
                  )}
                  {humanBehavior.cooldownPresence?.enabled !== false && (
                    <>Durante cooldown: {humanBehavior.cooldownPresence?.chancePercent ?? 40}% chance de aparecer online por {humanBehavior.cooldownPresence?.durationMinSec ?? 5}-{humanBehavior.cooldownPresence?.durationMaxSec ?? 25}s a cada {humanBehavior.cooldownPresence?.intervalMinMin ?? 2}-{humanBehavior.cooldownPresence?.intervalMaxMin ?? 5}min. </>
                  )}
                  {humanBehavior.dayRhythm?.enabled !== false && (
                    <>Ritmo: manhã {(humanBehavior.dayRhythm?.morningFactor ?? 130)}%, meio-dia {(humanBehavior.dayRhythm?.middayFactor ?? 80)}%, tarde {(humanBehavior.dayRhythm?.afternoonFactor ?? 100)}%. </>
                  )}
                  {humanBehavior.nonlinearPauses?.enabled !== false && (
                    <>Pausas: {(humanBehavior.nonlinearPauses?.short?.weight ?? 40)}% curta, {(humanBehavior.nonlinearPauses?.medium?.weight ?? 40)}% média, {(humanBehavior.nonlinearPauses?.long?.weight ?? 20)}% longa.</>
                  )}
                </p>
              </div>
            </CardContent>
          )}
        </Card>

      {/* Row: Reconnection + Verifier + Evolution API */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reconnection Queue */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                  <Wifi className="size-3.5 text-violet-600" />
                </div>
                <CardTitle className="text-base">Reconexao</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-violet-600 gap-1 h-7" onClick={() => resetSection('reconnection', 'Reconexão')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Max simultaneas</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={10} step={1} value={settings.reconnectMaxConcurrent ?? 2} onChange={e => updateSetting('reconnectMaxConcurrent', Math.max(1, parseInt(e.target.value) || 2))} className="w-16 h-7 text-xs" disabled={saving} />
                  <span className="text-[9px] text-muted-foreground">chips</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Max tentativas</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={50} step={1} value={settings.reconnectMaxAttempts ?? 10} onChange={e => updateSetting('reconnectMaxAttempts', Math.max(1, parseInt(e.target.value) || 10))} className="w-16 h-7 text-xs" disabled={saving} />
                  <span className="text-[9px] text-muted-foreground">vezes</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Rate limit</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={50} step={1} value={settings.reconnectRateLimit ?? 5} onChange={e => updateSetting('reconnectRateLimit', Math.max(1, parseInt(e.target.value) || 5))} className="w-16 h-7 text-xs" disabled={saving} />
                  <span className="text-[9px] text-muted-foreground">/{settings.reconnectRateWindowMin ?? 10}min</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Janela rate (min)</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={60} step={1} value={settings.reconnectRateWindowMin ?? 10} onChange={e => updateSetting('reconnectRateWindowMin', Math.max(1, parseInt(e.target.value) || 10))} className="w-16 h-7 text-xs" disabled={saving} />
                  <span className="text-[9px] text-muted-foreground">min</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Delay entre reconexoes</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1000} max={120000} step={1000} value={settings.reconnectInterDelayMs ?? 15000} onChange={e => updateSetting('reconnectInterDelayMs', Math.max(1000, parseInt(e.target.value) || 15000))} className="w-16 h-7 text-xs" disabled={saving} />
                  <span className="text-[9px] text-muted-foreground">ms</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Timeout conexao</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={10000} max={300000} step={5000} value={settings.reconnectConnectTimeoutMs ?? 60000} onChange={e => updateSetting('reconnectConnectTimeoutMs', Math.max(10000, parseInt(e.target.value) || 60000))} className="w-16 h-7 text-xs" disabled={saving} />
                  <span className="text-[9px] text-muted-foreground">ms</span>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Circuit breaker (falhas consecutivas)</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min={1} max={20} step={1} value={settings.circuitBreakerThreshold ?? 3} onChange={e => updateSetting('circuitBreakerThreshold', Math.max(1, parseInt(e.target.value) || 3))} className="w-16 h-7 text-xs" disabled={saving} />
                <span className="text-[9px] text-muted-foreground">falhas</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
              <div>
                <p className="text-[10px] font-medium">Respeitar janela de envio</p>
                <p className="text-[9px] text-muted-foreground">So reconecta durante horario comercial</p>
              </div>
              <Switch checked={settings.reconnectRespectWindow ?? false} onCheckedChange={v => updateSetting('reconnectRespectWindow', v)} />
            </div>
          </CardContent>
        </Card>

        {/* Verifier Settings */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                  <Search className="size-3.5 text-cyan-600" />
                </div>
                <CardTitle className="text-base">Verificador</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-cyan-600 gap-1 h-7" onClick={() => resetSection('verifier', 'Verificador')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Limite diario de verificacoes</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifyDailyLimit')} title={`Padrao: ${DEFAULTS.verifyDailyLimit}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={10} max={5000} step={10} value={settings.verifyDailyLimit ?? 300} onChange={e => updateSetting('verifyDailyLimit', Math.max(10, parseInt(e.target.value) || 300))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">verific/chip/dia</span>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[10px] text-muted-foreground">
                Cada chip pode verificar ate <strong>{settings.verifyDailyLimit ?? 300}</strong> numeros por dia. Verificacoes demais podem acionar limites do WhatsApp.
              </p>
            </div>

            {/* Verifier Delay Settings */}
            <div className="border-t pt-3">
              <Label className="text-xs font-semibold">Delay entre verificacoes</Label>
              <div className="grid grid-cols-2 gap-3 mt-1.5">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Delay minimo</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierDelayMin')} title={`Padrao: ${DEFAULTS.verifierDelayMin}s`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} max={60} step={1} value={settings.verifierDelayMin ?? 8} onChange={e => updateSetting('verifierDelayMin', Math.max(1, parseInt(e.target.value) || 8))} className="w-16 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">seg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Delay maximo</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierDelayMax')} title={`Padrao: ${DEFAULTS.verifierDelayMax}s`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} max={120} step={1} value={settings.verifierDelayMax ?? 15} onChange={e => updateSetting('verifierDelayMax', Math.max(1, parseInt(e.target.value) || 15))} className="w-16 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">seg</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Verifier Batch & Cooldown */}
            <div className="border-t pt-3 space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Batch por chip</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierBatchSize')} title={`Padrao: ${DEFAULTS.verifierBatchSize}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={50} step={1} value={settings.verifierBatchSize ?? 5} onChange={e => updateSetting('verifierBatchSize', Math.max(1, parseInt(e.target.value) || 5))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">verific/batch</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Cooldown apos N verificacoes</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierCooldownAfter')} title={`Padrao: ${DEFAULTS.verifierCooldownAfter}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={5} max={200} step={1} value={settings.verifierCooldownAfter ?? 50} onChange={e => updateSetting('verifierCooldownAfter', Math.max(5, parseInt(e.target.value) || 50))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">verific</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Duracao cooldown (min)</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierCooldownMinutes')} title={`Padrao: ${DEFAULTS.verifierCooldownMinutes}min`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={60} step={1} value={settings.verifierCooldownMinutes ?? 5} onChange={e => updateSetting('verifierCooldownMinutes', Math.max(1, parseInt(e.target.value) || 5))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">min</span>
              </div>
            </div>

            {/* Verifier Quota & Rate Limit Cooldowns */}
            <div className="border-t pt-3">
              <Label className="text-xs font-semibold">Cooldowns de quota e rate limit</Label>
              <div className="grid grid-cols-2 gap-3 mt-1.5">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Cooldown cota esgotada</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierQuotaCooldownMs')} title={`Padrao: ${(Number(DEFAULTS.verifierQuotaCooldownMs) / 3600000).toFixed(0)}h`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} max={168} step={1} value={Math.round((settings.verifierQuotaCooldownMs ?? 86400000) / 3600000)} onChange={e => updateSetting('verifierQuotaCooldownMs', Math.max(60000, (parseInt(e.target.value) || 24) * 3600000))} className="w-16 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">horas</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Cooldown 429</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierRateLimitCooldownMs')} title={`Padrao: ${(Number(DEFAULTS.verifierRateLimitCooldownMs) / 3600000).toFixed(0)}h`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} max={168} step={1} value={Math.round((settings.verifierRateLimitCooldownMs ?? 86400000) / 3600000)} onChange={e => updateSetting('verifierRateLimitCooldownMs', Math.max(60000, (parseInt(e.target.value) || 24) * 3600000))} className="w-16 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">horas</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Retry apos 429</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('verifierRateLimitRetryMs')} title={`Padrao: ${DEFAULTS.verifierRateLimitRetryMs}ms`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={500} max={10000} step={100} value={settings.verifierRateLimitRetryMs ?? 2000} onChange={e => updateSetting('verifierRateLimitRetryMs', Math.max(500, parseInt(e.target.value) || 2000))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">ms</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Evolution API Settings */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                  <Server className="size-3.5 text-indigo-600" />
                </div>
                <CardTitle className="text-base">Evolution API</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-indigo-600 gap-1 h-7" onClick={() => resetSection('evolutionApi', 'Evolution API')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Timeout da API</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-indigo-600" onClick={() => resetField('evolutionApiTimeoutMs')} title={`Padrao: ${DEFAULTS.evolutionApiTimeoutMs}ms`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={5000} max={120000} step={1000} value={settings.evolutionApiTimeoutMs ?? 15000} onChange={e => updateSetting('evolutionApiTimeoutMs', Math.max(5000, parseInt(e.target.value) || 15000))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">ms</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs font-medium">Rejeitar ligacoes</p>
                <p className="text-[10px] text-muted-foreground">Rejeita chamadas de voz automaticamente</p>
              </div>
              <div className="flex items-center gap-1">
                <Switch checked={settings.autoRejectCalls ?? true} onCheckedChange={v => updateSetting('autoRejectCalls', v)} />
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-indigo-600" onClick={() => resetField('autoRejectCalls')} title="Restaurar padrao">
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem de rejeicao</Label>
              <Input type="text" maxLength={200} value={settings.autoRejectCallMessage ?? 'Desculpa, nao posso atender agora.'} onChange={e => updateSetting('autoRejectCallMessage', e.target.value)} className="h-8 text-sm" disabled={saving} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row: Ban Detection + Sending Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ban Detection */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <ShieldAlert className="size-3.5 text-purple-600" />
                </div>
                <CardTitle className="text-base">Detecção de Ban</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-purple-600 gap-1 h-7" onClick={() => resetSection('banDetection', 'Detecção de Ban')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Códigos de ban</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('banCodes')} title="Restaurar padrão">
                  <RotateCcw className="size-2.5" />
                </Button>
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
                className="h-8 text-sm"
                disabled={saving}
              />
              <p className="text-[10px] text-muted-foreground">Separados por vírgula. Códigos HTTP que indicam ban.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Keywords de restrição</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('restrictionKeywords')} title="Restaurar padrão">
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <Textarea
                value={restrictionKeywordsText}
                onChange={e => {
                  setRestrictionKeywordsText(e.target.value)
                  const arr = e.target.value.split('\n').map(s => s.trim()).filter(s => s.length > 0)
                  updateSetting('restrictionKeywords', JSON.stringify(arr))
                }}
                placeholder="sua conta foi banida&#10;sua conta foi suspensa&#10;..."
                className="min-h-[80px] text-xs"
                disabled={saving}
              />
              <p className="text-[10px] text-muted-foreground">Uma keyword por linha. Palavras que indicam restrição de conta.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Keywords de aviso</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('warningKeywords')} title="Restaurar padrão">
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <Textarea
                value={warningKeywordsText}
                onChange={e => {
                  setWarningKeywordsText(e.target.value)
                  const arr = e.target.value.split('\n').map(s => s.trim()).filter(s => s.length > 0)
                  updateSetting('warningKeywords', JSON.stringify(arr))
                }}
                placeholder="aviso&#10;advertência&#10;spam&#10;..."
                className="min-h-[80px] text-xs"
                disabled={saving}
              />
              <p className="text-[10px] text-muted-foreground">Uma keyword por linha. Palavras que indicam aviso ou alerta.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Lookback (horas)</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('banLookbackHours')} title={`Padrão: ${DEFAULTS.banLookbackHours}h`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={168} step={1} value={settings.banLookbackHours ?? 24} onChange={e => updateSetting('banLookbackHours', Math.max(1, parseInt(e.target.value) || 24))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">h</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Threshold keywords</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('banKeywordThreshold')} title={`Padrão: ${DEFAULTS.banKeywordThreshold}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={10} step={1} value={settings.banKeywordThreshold ?? 2} onChange={e => updateSetting('banKeywordThreshold', Math.max(1, parseInt(e.target.value) || 2))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">matches</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Máx. mensagens (ban)</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('banMaxMessagesCheck')} title={`Padrão: ${DEFAULTS.banMaxMessagesCheck}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={5} max={200} step={1} value={settings.banMaxMessagesCheck ?? 50} onChange={e => updateSetting('banMaxMessagesCheck', Math.max(5, parseInt(e.target.value) || 50))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">msgs</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Máx. mensagens (aviso)</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-purple-600" onClick={() => resetField('warningMaxMessagesCheck')} title={`Padrão: ${DEFAULTS.warningMaxMessagesCheck}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={5} max={100} step={1} value={settings.warningMaxMessagesCheck ?? 20} onChange={e => updateSetting('warningMaxMessagesCheck', Math.max(5, parseInt(e.target.value) || 20))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">msgs</span>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[10px] text-muted-foreground">
                Monitora as últimas <strong>{settings.banLookbackHours ?? 24}h</strong> de mensagens, verificando até <strong>{settings.banMaxMessagesCheck ?? 50}</strong> msgs para ban e <strong>{settings.warningMaxMessagesCheck ?? 20}</strong> para aviso. Aciona se ≥<strong>{settings.banKeywordThreshold ?? 2}</strong> keywords forem encontradas.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sending Engine */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                  <Zap className="size-3.5 text-cyan-600" />
                </div>
                <CardTitle className="text-base">Motor de Envio</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-cyan-600 gap-1 h-7" onClick={() => resetSection('sendingEngine', 'Motor de Envio')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo berçário</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('nurseryMinIntervalSec')} title={`Padrão: ${DEFAULTS.nurseryMinIntervalSec}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={30} max={600} step={5} value={settings.nurseryMinIntervalSec ?? 120} onChange={e => updateSetting('nurseryMinIntervalSec', Math.max(30, parseInt(e.target.value) || 120))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo pré-aquecido</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('prewarmMinIntervalSec')} title={`Padrão: ${DEFAULTS.prewarmMinIntervalSec}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={15} max={300} step={5} value={settings.prewarmMinIntervalSec ?? 60} onChange={e => updateSetting('prewarmMinIntervalSec', Math.max(15, parseInt(e.target.value) || 60))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Timeout função</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('functionTimeoutMs')} title={`Padrão: ${DEFAULTS.functionTimeoutMs}ms`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={10000} max={120000} step={1000} value={settings.functionTimeoutMs ?? 50000} onChange={e => updateSetting('functionTimeoutMs', Math.max(10000, parseInt(e.target.value) || 50000))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">ms</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Máx. msgs/invocação</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('maxMessagesPerInvocation')} title={`Padrão: ${DEFAULTS.maxMessagesPerInvocation}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={50} step={1} value={settings.maxMessagesPerInvocation ?? 10} onChange={e => updateSetting('maxMessagesPerInvocation', Math.max(1, parseInt(e.target.value) || 10))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">msgs</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Tempo mínimo restante</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('minRemainingTimeMs')} title={`Padrão: ${DEFAULTS.minRemainingTimeMs}ms`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1000} max={10000} step={500} value={settings.minRemainingTimeMs ?? 3000} onChange={e => updateSetting('minRemainingTimeMs', Math.max(1000, parseInt(e.target.value) || 3000))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">ms</span>
              </div>
            </div>

            <div className="border-t pt-3">
              <Label className="text-xs font-semibold">Stagger de presença</Label>
              <p className="text-[10px] text-muted-foreground mb-2">Delay aleatório antes de enviar "digitando..."</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('presenceStaggerMinMs')} title={`Padrão: ${DEFAULTS.presenceStaggerMinMs}ms`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={100} max={5000} step={100} value={settings.presenceStaggerMinMs ?? 500} onChange={e => updateSetting('presenceStaggerMinMs', Math.max(100, parseInt(e.target.value) || 500))} className="w-20 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">ms</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('presenceStaggerMaxMs')} title={`Padrão: ${DEFAULTS.presenceStaggerMaxMs}ms`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={100} max={10000} step={100} value={settings.presenceStaggerMaxMs ?? 2000} onChange={e => updateSetting('presenceStaggerMaxMs', Math.max(100, parseInt(e.target.value) || 2000))} className="w-20 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">ms</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Timeout verificação mídia</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-cyan-600" onClick={() => resetField('mediaCheckTimeoutMs')} title={`Padrão: ${DEFAULTS.mediaCheckTimeoutMs}ms`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1000} max={30000} step={500} value={settings.mediaCheckTimeoutMs ?? 5000} onChange={e => updateSetting('mediaCheckTimeoutMs', Math.max(1000, parseInt(e.target.value) || 5000))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">ms</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row: Campaign Defaults + Warming Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Campaign Defaults */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                  <Star className="size-3.5 text-indigo-600" />
                </div>
                <CardTitle className="text-base">Padrões de Campanha</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-indigo-600 gap-1 h-7" onClick={() => resetSection('campaignDefaults', 'Padrões de Campanha')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo mínimo padrão</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-indigo-600" onClick={() => resetField('defaultSendIntervalMin')} title={`Padrão: ${DEFAULTS.defaultSendIntervalMin}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={5} max={300} step={1} value={settings.defaultSendIntervalMin ?? 30} onChange={e => updateSetting('defaultSendIntervalMin', Math.max(5, parseInt(e.target.value) || 30))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo máximo padrão</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-indigo-600" onClick={() => resetField('defaultSendIntervalMax')} title={`Padrão: ${DEFAULTS.defaultSendIntervalMax}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={5} max={600} step={1} value={settings.defaultSendIntervalMax ?? 90} onChange={e => updateSetting('defaultSendIntervalMax', Math.max(5, parseInt(e.target.value) || 90))} className="w-24 h-8 text-sm" disabled={saving} />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs font-medium">Anti-ban ativo por padrão</p>
                <p className="text-[10px] text-muted-foreground">Novas campanhas iniciam com anti-ban ligado</p>
              </div>
              <div className="flex items-center gap-1">
                <Switch checked={settings.defaultAntiBanEnabled ?? true} onCheckedChange={v => updateSetting('defaultAntiBanEnabled', v)} />
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-indigo-600" onClick={() => resetField('defaultAntiBanEnabled')} title="Restaurar padrão">
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Modo de aquecimento padrão</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-indigo-600" onClick={() => resetField('defaultWarmingMode')} title={`Padrão: ${DEFAULTS.defaultWarmingMode}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <Select value={settings.defaultWarmingMode ?? 'normal'} onValueChange={v => updateSetting('defaultWarmingMode', v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="agressive">Agressivo</SelectItem>
                  <SelectItem value="stealth">Furtivo</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Modo de aquecimento aplicado a novas campanhas.</p>
            </div>
          </CardContent>
        </Card>

        {/* Warming Engine */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                  <Flame className="size-3.5 text-orange-600" />
                </div>
                <CardTitle className="text-base">Motor de Aquecimento</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-orange-600 gap-1 h-7" onClick={() => resetSection('warmingEngine', 'Motor de Aquecimento')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Mín. chips para aquecer</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-orange-600" onClick={() => resetField('minChipsForWarming')} title={`Padrão: ${DEFAULTS.minChipsForWarming}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={2} max={10} step={1} value={settings.minChipsForWarming ?? 3} onChange={e => updateSetting('minChipsForWarming', Math.max(2, parseInt(e.target.value) || 3))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">chips</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Auto-pausa após erros</Label>
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-orange-600" onClick={() => resetField('warmingAutoPauseErrors')} title={`Padrão: ${DEFAULTS.warmingAutoPauseErrors}`}>
                  <RotateCcw className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={3} max={50} step={1} value={settings.warmingAutoPauseErrors ?? 10} onChange={e => updateSetting('warmingAutoPauseErrors', Math.max(3, parseInt(e.target.value) || 10))} className="w-24 h-8 text-sm" disabled={saving} />
                <span className="text-[11px] text-muted-foreground">erros</span>
              </div>
            </div>

            <div className="border-t pt-3">
              <Label className="text-xs font-semibold">Retry após erro</Label>
              <p className="text-[10px] text-muted-foreground mb-2">Intervalo aleatório entre mín e máx antes de tentar novamente</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-orange-600" onClick={() => resetField('warmingErrorRetryMinSec')} title={`Padrão: ${DEFAULTS.warmingErrorRetryMinSec}s`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={5} max={120} step={1} value={settings.warmingErrorRetryMinSec ?? 15} onChange={e => updateSetting('warmingErrorRetryMinSec', Math.max(5, parseInt(e.target.value) || 15))} className="w-20 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">seg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                    <Button variant="ghost" size="icon" className="size-4 text-muted-foreground hover:text-orange-600" onClick={() => resetField('warmingErrorRetryMaxSec')} title={`Padrão: ${DEFAULTS.warmingErrorRetryMaxSec}s`}>
                      <RotateCcw className="size-2" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={10} max={300} step={1} value={settings.warmingErrorRetryMaxSec ?? 60} onChange={e => updateSetting('warmingErrorRetryMaxSec', Math.max(10, parseInt(e.target.value) || 60))} className="w-20 h-7 text-xs" disabled={saving} />
                    <span className="text-[9px] text-muted-foreground">seg</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[10px] text-muted-foreground">
                O motor de aquecimento precisa de pelo menos <strong>{settings.minChipsForWarming ?? 3}</strong> chips disponíveis. Após <strong>{settings.warmingAutoPauseErrors ?? 10}</strong> erros consecutivos, o aquecimento é pausado automaticamente. Retry aguarda <strong>{settings.warmingErrorRetryMinSec ?? 15}–{settings.warmingErrorRetryMaxSec ?? 60}s</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tips */}
      <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Star className="size-3.5 text-amber-600" />
            </div>
            <CardTitle className="text-base">Dicas Anti-Ban</CardTitle>
          </div>
        </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tips.map((tip, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                  className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex size-6 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/20 shrink-0">
                    <tip.icon className="size-3 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium">{tip.title}</p>
                    <p className="text-[10px] text-muted-foreground">{tip.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
