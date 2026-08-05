'use client'

// ============================================================
// Anti-Ban — IntervalsSection
// "Intervalo entre Mensagens" FieldCard from the Básico section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Timer } from 'lucide-react'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField } from './shared'

export interface IntervalsSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function IntervalsSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: IntervalsSectionProps) {
  return (
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
  )
}
