'use client'

// ============================================================
// Anti-Ban — TypingSection
// "Simulação de Digitação" FieldCard from the Básico section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes). Receives settings + handlers as props from the parent
// AntiBanTab shell.
// ============================================================

import React from 'react'
import { Type, MessageCircle } from 'lucide-react'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField } from './shared'

export interface TypingSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function TypingSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: TypingSectionProps) {
  return (
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
  )
}
