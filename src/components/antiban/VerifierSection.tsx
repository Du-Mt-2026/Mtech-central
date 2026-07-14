'use client'

// ============================================================
// Anti-Ban — VerifierSection
// "Verificador" FieldCard from the Verificador section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Search } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField } from './shared'

export interface VerifierSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function VerifierSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: VerifierSectionProps) {
  return (
    <FieldCard
      title="Verificador"
      description="Limites, delays, batches e cooldowns de verificação"
      icon={Search}
      accent="text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30"
      onResetSection={() => resetSection('verifier', 'Verificador')}
      saving={saving}
    >
      <div className="space-y-4">
        <SuffixNumberField
          label="Limite diário de verificações"
          suffix="verific/chip/dia"
          min={10}
          max={5000}
          step={10}
          value={settings.verifyDailyLimit ?? 300}
          onChange={v => updateSetting('verifyDailyLimit', Math.max(10, v || 300))}
          defaultValue={DEFAULTS.verifyDailyLimit as number}
          onReset={() => resetField('verifyDailyLimit')}
          disabled={saving}
        />

        <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
          Cada chip pode verificar até <strong>{settings.verifyDailyLimit ?? 300}</strong> números por dia. Verificações demais podem acionar limites do WhatsApp.
        </div>

        <Separator />

        <div className="space-y-1">
          <Label className="text-sm font-medium">Delay entre verificações</Label>
          <p className="text-xs text-muted-foreground">Pausa aleatória entre mínimo e máximo</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Delay mínimo"
            suffix="seg"
            min={1}
            max={60}
            step={1}
            value={settings.verifierDelayMin ?? 8}
            onChange={v => updateSetting('verifierDelayMin', Math.max(1, v || 8))}
            defaultValue={DEFAULTS.verifierDelayMin as number}
            onReset={() => resetField('verifierDelayMin')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Delay máximo"
            suffix="seg"
            min={1}
            max={120}
            step={1}
            value={settings.verifierDelayMax ?? 15}
            onChange={v => updateSetting('verifierDelayMax', Math.max(1, v || 15))}
            defaultValue={DEFAULTS.verifierDelayMax as number}
            onReset={() => resetField('verifierDelayMax')}
            disabled={saving}
          />
        </div>

        <Separator />

        <SuffixNumberField
          label="Batch por chip"
          suffix="verific/batch"
          min={1}
          max={50}
          step={1}
          value={settings.verifierBatchSize ?? 5}
          onChange={v => updateSetting('verifierBatchSize', Math.max(1, v || 5))}
          defaultValue={DEFAULTS.verifierBatchSize as number}
          onReset={() => resetField('verifierBatchSize')}
          disabled={saving}
        />

        <SuffixNumberField
          label="Cooldown após N verificações"
          suffix="verific"
          min={5}
          max={200}
          step={1}
          value={settings.verifierCooldownAfter ?? 50}
          onChange={v => updateSetting('verifierCooldownAfter', Math.max(5, v || 50))}
          defaultValue={DEFAULTS.verifierCooldownAfter as number}
          onReset={() => resetField('verifierCooldownAfter')}
          disabled={saving}
        />

        <SuffixNumberField
          label="Duração do cooldown"
          suffix="min"
          min={1}
          max={60}
          step={1}
          value={settings.verifierCooldownMinutes ?? 5}
          onChange={v => updateSetting('verifierCooldownMinutes', Math.max(1, v || 5))}
          defaultValue={DEFAULTS.verifierCooldownMinutes as number}
          onReset={() => resetField('verifierCooldownMinutes')}
          disabled={saving}
        />

        <Separator />

        <div className="space-y-1">
          <Label className="text-sm font-medium">Cooldowns de quota e rate limit</Label>
          <p className="text-xs text-muted-foreground">Quanto tempo esperar quando a quota esgota ou quando o WhatsApp retorna 429</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Cooldown de cota esgotada"
            suffix="horas"
            min={1}
            max={168}
            step={1}
            value={Math.round((settings.verifierQuotaCooldownMs ?? 86400000) / 3600000)}
            onChange={v => updateSetting('verifierQuotaCooldownMs', Math.max(60000, (v || 24) * 3600000))}
            defaultValue={Number(DEFAULTS.verifierQuotaCooldownMs) / 3600000}
            onReset={() => resetField('verifierQuotaCooldownMs')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Cooldown de 429 (rate limit)"
            suffix="horas"
            min={1}
            max={168}
            step={1}
            value={Math.round((settings.verifierRateLimitCooldownMs ?? 86400000) / 3600000)}
            onChange={v => updateSetting('verifierRateLimitCooldownMs', Math.max(60000, (v || 24) * 3600000))}
            defaultValue={Number(DEFAULTS.verifierRateLimitCooldownMs) / 3600000}
            onReset={() => resetField('verifierRateLimitCooldownMs')}
            disabled={saving}
          />
        </div>

        <SuffixNumberField
          label="Retry após 429"
          tooltip="Tempo de espera antes de tentar novamente após receber um erro 429 (rate limit) da API"
          suffix="ms"
          min={500}
          max={10000}
          step={100}
          value={settings.verifierRateLimitRetryMs ?? 2000}
          onChange={v => updateSetting('verifierRateLimitRetryMs', Math.max(500, v || 2000))}
          defaultValue={DEFAULTS.verifierRateLimitRetryMs as number}
          onReset={() => resetField('verifierRateLimitRetryMs')}
          disabled={saving}
        />
      </div>
    </FieldCard>
  )
}
