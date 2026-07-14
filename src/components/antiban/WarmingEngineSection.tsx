'use client'

// ============================================================
// Anti-Ban — WarmingEngineSection
// "Motor de Aquecimento" FieldCard from the Aquecimento section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Flame } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField } from './shared'

export interface WarmingEngineSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function WarmingEngineSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: WarmingEngineSectionProps) {
  return (
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
  )
}
