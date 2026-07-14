'use client'

// ============================================================
// Anti-Ban Tab — Redesigned (refactored into multiple files)
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
//
// P2.1 refactor: the body of each section is now extracted into its own file
// under ./antiban/ — see shared.tsx for types/helpers/sub-components and the
// *Section.tsx files for each card. NO logic was changed; this is a pure
// mechanical extraction.
// ============================================================

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  RotateCcw, RefreshCw, Type, Timer, Flame, Baby, CheckCircle2,
  Clock, AlertCircle, UserPlus, EyeOff, ShieldAlert, MessageCircle,
  Star, Brain, Activity, Zap, Coffee, Sun, Moon,
  BarChart3, Wifi, PhoneOff, Search, Server, Info, Save,
  LayoutGrid, Network, ScanSearch, ShieldCheck, Settings2, ChevronRight,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
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

// Shared types / helpers / sub-components
import {
  SIDEBAR_SECTIONS,
  FIELD_REGISTRY,
  SectionHeading,
  parseBreakWindows,
  parseScheduleFromSettings,
  type SectionId,
} from './shared'

// Section components
import { TypingSection } from './TypingSection'
import { IntervalsSection } from './IntervalsSection'
import { CooldownSection } from './CooldownSection'
import { SendingWindowSection } from './SendingWindowSection'
import { WarmingSection } from './WarmingSection'
import { WarmingEngineSection } from './WarmingEngineSection'
import { HumanBehaviorSection } from './HumanBehaviorSection'
import { ReconnectionSection } from './ReconnectionSection'
import { VerifierSection } from './VerifierSection'
import { BanDetectionSection } from './BanDetectionSection'
import { EvolutionSection } from './EvolutionSection'
import { SendingEngineSection } from './SendingEngineSection'
import { CampaignDefaultsSection } from './CampaignDefaultsSection'

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
                      : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                  )}
                >
                  <div className={cn(
                    'flex size-7 lg:size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                    isActive
                      ? section.accent
                      : 'bg-muted/60 text-foreground/70 group-hover:bg-muted group-hover:text-foreground'
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
              <TypingSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />

              {/* Message Interval */}
              <IntervalsSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />

              {/* Cooldown & Limits */}
              <CooldownSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />

              {/* Sending Window */}
              <SendingWindowSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
                breakWindows={breakWindows}
                addBreakWindow={addBreakWindow}
                removeBreakWindow={removeBreakWindow}
                updateBreakWindow={updateBreakWindow}
              />
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

              <WarmingSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
                nurserySchedule={nurserySchedule}
                prewarmSchedule={prewarmSchedule}
                maxNursery={maxNursery}
                maxPrewarm={maxPrewarm}
                updateScheduleEntry={updateScheduleEntry}
                updateReadyDailyLimit={updateReadyDailyLimit}
              />

              {/* Warming Engine */}
              <WarmingEngineSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />
            </>
          )}

          {/* ---------- SEÇÃO: COMPORTAMENTO HUMANO ---------- */}
          {activeSection === 'comportamento' && (
            <HumanBehaviorSection
              settings={settings}
              updateSetting={updateSetting}
              updateHumanBehavior={updateHumanBehavior}
              resetSection={resetSection}
              saving={saving}
              humanBehavior={humanBehavior}
            />
          )}

          {/* ---------- SEÇÃO: RECONEXÃO ---------- */}
          {activeSection === 'reconexao' && (
            <>
              <SectionHeading
                title="Reconexão"
                description="Como o sistema reconecta chips que caem."
                icon={Network}
              />

              <ReconnectionSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />
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

              <VerifierSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />
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
              <BanDetectionSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
                banCodesText={banCodesText}
                setBanCodesText={setBanCodesText}
                restrictionKeywordsText={restrictionKeywordsText}
                setRestrictionKeywordsText={setRestrictionKeywordsText}
                warningKeywordsText={warningKeywordsText}
                setWarningKeywordsText={setWarningKeywordsText}
              />

              {/* Evolution API */}
              <EvolutionSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />
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
              <SendingEngineSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
              />

              {/* Campaign Defaults + Tips */}
              <CampaignDefaultsSection
                settings={settings}
                updateSetting={updateSetting}
                resetField={resetField}
                resetSection={resetSection}
                saving={saving}
                tips={tips}
              />
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

export default AntiBanTab
