'use client'

// ============================================================
// Anti-Ban — SendingEngineSection
// "Motor de Envio" FieldCard from the Avançado section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Zap } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField } from './shared'

export interface SendingEngineSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function SendingEngineSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: SendingEngineSectionProps) {
  return (
    <FieldCard
      title="Motor de Envio"
      description="Parâmetros internos do motor que processa as filas"
      icon={Zap}
      accent="text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30"
      onResetSection={() => resetSection('sendingEngine', 'Motor de Envio')}
      saving={saving}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Intervalo do berçário"
            suffix="seg"
            min={30}
            max={600}
            step={5}
            value={settings.nurseryMinIntervalSec ?? 120}
            onChange={v => updateSetting('nurseryMinIntervalSec', Math.max(30, v || 120))}
            defaultValue={DEFAULTS.nurseryMinIntervalSec as number}
            onReset={() => resetField('nurseryMinIntervalSec')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Intervalo do pré-aquecido"
            suffix="seg"
            min={15}
            max={300}
            step={5}
            value={settings.prewarmMinIntervalSec ?? 60}
            onChange={v => updateSetting('prewarmMinIntervalSec', Math.max(15, v || 60))}
            defaultValue={DEFAULTS.prewarmMinIntervalSec as number}
            onReset={() => resetField('prewarmMinIntervalSec')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Timeout da função"
            suffix="ms"
            min={10000}
            max={120000}
            step={1000}
            value={settings.functionTimeoutMs ?? 50000}
            onChange={v => updateSetting('functionTimeoutMs', Math.max(10000, v || 50000))}
            defaultValue={DEFAULTS.functionTimeoutMs as number}
            onReset={() => resetField('functionTimeoutMs')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Máx. msgs por invocação"
            suffix="msgs"
            min={1}
            max={50}
            step={1}
            value={settings.maxMessagesPerInvocation ?? 10}
            onChange={v => updateSetting('maxMessagesPerInvocation', Math.max(1, v || 10))}
            defaultValue={DEFAULTS.maxMessagesPerInvocation as number}
            onReset={() => resetField('maxMessagesPerInvocation')}
            disabled={saving}
          />
        </div>

        <SuffixNumberField
          label="Tempo mínimo restante"
          tooltip="Se restar menos que este tempo na invocação atual, o motor não inicia uma nova mensagem"
          suffix="ms"
          min={1000}
          max={10000}
          step={500}
          value={settings.minRemainingTimeMs ?? 3000}
          onChange={v => updateSetting('minRemainingTimeMs', Math.max(1000, v || 3000))}
          defaultValue={DEFAULTS.minRemainingTimeMs as number}
          onReset={() => resetField('minRemainingTimeMs')}
          disabled={saving}
        />

        <Separator />

        <div className="space-y-1">
          <Label className="text-sm font-medium">Stagger de presença</Label>
          <p className="text-xs text-muted-foreground">Delay aleatório antes de enviar "digitando..."</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Mínimo"
            suffix="ms"
            min={100}
            max={5000}
            step={100}
            value={settings.presenceStaggerMinMs ?? 500}
            onChange={v => updateSetting('presenceStaggerMinMs', Math.max(100, v || 500))}
            defaultValue={DEFAULTS.presenceStaggerMinMs as number}
            onReset={() => resetField('presenceStaggerMinMs')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Máximo"
            suffix="ms"
            min={100}
            max={10000}
            step={100}
            value={settings.presenceStaggerMaxMs ?? 2000}
            onChange={v => updateSetting('presenceStaggerMaxMs', Math.max(100, v || 2000))}
            defaultValue={DEFAULTS.presenceStaggerMaxMs as number}
            onReset={() => resetField('presenceStaggerMaxMs')}
            disabled={saving}
          />
        </div>

        <SuffixNumberField
          label="Timeout de verificação de mídia"
          suffix="ms"
          min={1000}
          max={30000}
          step={500}
          value={settings.mediaCheckTimeoutMs ?? 5000}
          onChange={v => updateSetting('mediaCheckTimeoutMs', Math.max(1000, v || 5000))}
          defaultValue={DEFAULTS.mediaCheckTimeoutMs as number}
          onReset={() => resetField('mediaCheckTimeoutMs')}
          disabled={saving}
        />
      </div>
    </FieldCard>
  )
}
