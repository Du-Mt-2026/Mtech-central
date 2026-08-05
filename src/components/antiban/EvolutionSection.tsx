'use client'

// ============================================================
// Anti-Ban — EvolutionSection
// "Evolution API" FieldCard from the Segurança section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Server } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField, ToggleRow } from './shared'

export interface EvolutionSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function EvolutionSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: EvolutionSectionProps) {
  return (
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
  )
}
