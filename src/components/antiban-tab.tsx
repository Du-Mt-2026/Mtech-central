'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  RotateCcw, RefreshCw, Type, Timer, Flame, Baby, CheckCircle2,
  Clock, AlertCircle, UserPlus, EyeOff, ShieldAlert, MessageCircle,
  Plus, Trash2, Star,
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
import { toast } from 'sonner'

import {
  NURSERY_SCHEDULE,
  PREWARM_SCHEDULE,
  FIELD_DEFAULTS as DEFAULTS,
  type ScheduleEntry,
  type BreakWindow,
  type AntiBanSettings,
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
