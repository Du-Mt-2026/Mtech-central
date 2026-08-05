'use client'

// ============================================================
// Anti-Ban — SendingWindowSection
// "Janela de Envio" FieldCard from the Básico section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Clock, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings, type BreakWindow } from '@/lib/constants'
import { toMins } from '@/lib/time-utils'
import { FieldCard, ResetIconButton, minsToTime, timeToMins } from './shared'

export interface SendingWindowSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
  breakWindows: BreakWindow[]
  addBreakWindow: () => void
  removeBreakWindow: (index: number) => void
  updateBreakWindow: (index: number, field: keyof BreakWindow, value: string | number) => void
}

export function SendingWindowSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
  breakWindows,
  addBreakWindow,
  removeBreakWindow,
  updateBreakWindow,
}: SendingWindowSectionProps) {
  // Backward-compat minutes for sending window display
  const windowStartMins = toMins(settings.sendingWindowStart)
  const windowEndMins = toMins(settings.sendingWindowEnd)

  return (
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
  )
}
