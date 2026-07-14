'use client'

// ============================================================
// Anti-Ban — WarmingSection
// "Aquecimento Progressivo" FieldCard from the Aquecimento section.
// Contains the 3-phase schedule tables (nursery / prewarm / ready)
// + timeline visual.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { motion } from 'framer-motion'
import { Flame, Baby, CheckCircle2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  FIELD_DEFAULTS as DEFAULTS,
  type AntiBanSettings,
  type ScheduleEntry,
} from '@/lib/constants'
import { FieldCard, SuffixNumberField } from './shared'

export interface WarmingSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
  nurserySchedule: ScheduleEntry[]
  prewarmSchedule: ScheduleEntry[]
  maxNursery: number
  maxPrewarm: number
  updateScheduleEntry: (scheduleType: 'nurserySchedule' | 'prewarmSchedule', index: number, newLimit: number) => void
  updateReadyDailyLimit: (newLimit: number) => void
}

export function WarmingSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
  nurserySchedule,
  prewarmSchedule,
  maxNursery,
  maxPrewarm,
  updateScheduleEntry,
  updateReadyDailyLimit,
}: WarmingSectionProps) {
  return (
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
  )
}
