'use client'

// ============================================================
// Anti-Ban — CooldownSection
// "Cooldown & Limites" FieldCard from the Básico section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { ShieldAlert } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField, ToggleRow } from './shared'

export interface CooldownSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function CooldownSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: CooldownSectionProps) {
  return (
    <FieldCard
      title="Cooldown & Limites"
      description="Pausas obrigatórias após N mensagens e limites por chip"
      icon={ShieldAlert}
      accent="text-rose-600 bg-rose-100 dark:bg-rose-900/30"
      onResetSection={() => resetSection('cooldown', 'Cooldown & Limites')}
      saving={saving}
    >
      <div className="space-y-4">
        <SuffixNumberField
          label="Limite diário por chip"
          suffix="msgs"
          min={1}
          max={500}
          step={1}
          value={settings.dailyLimitPerChip}
          onChange={v => updateSetting('dailyLimitPerChip', Math.max(1, v || 1))}
          defaultValue={DEFAULTS.dailyLimitPerChip as number}
          onReset={() => resetField('dailyLimitPerChip')}
          disabled={saving}
        />

        <Separator />

        <div className="space-y-1">
          <Label className="text-sm font-medium">Duração do Cooldown</Label>
          <p className="text-xs text-muted-foreground">
            O sistema escolhe aleatoriamente entre mínimo e máximo a cada ciclo
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Mínimo"
            suffix="min"
            min={1}
            max={120}
            step={1}
            value={settings.cooldownMinutes}
            onChange={v => {
              const val = Math.max(1, v || 1)
              updateSetting('cooldownMinutes', val)
              if (settings.cooldownMinutesMax < val) updateSetting('cooldownMinutesMax', val)
            }}
            defaultValue={DEFAULTS.cooldownMinutes as number}
            onReset={() => resetField('cooldownMinutes')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Máximo"
            suffix="min"
            min={settings.cooldownMinutes}
            max={180}
            step={1}
            value={settings.cooldownMinutesMax}
            onChange={v => updateSetting('cooldownMinutesMax', Math.max(settings.cooldownMinutes, v || settings.cooldownMinutes))}
            defaultValue={DEFAULTS.cooldownMinutesMax as number}
            onReset={() => resetField('cooldownMinutesMax')}
            disabled={saving}
          />
        </div>

        <Separator />

        <div className="space-y-1">
          <Label className="text-sm font-medium">Cooldown após N mensagens</Label>
          <p className="text-xs text-muted-foreground">
            Após enviar entre mínimo e máximo mensagens, o chip entra em cooldown
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Mínimo"
            suffix="msgs"
            min={1}
            max={100}
            step={1}
            value={settings.cooldownAfterMessages}
            onChange={v => {
              const val = Math.max(1, v || 1)
              updateSetting('cooldownAfterMessages', val)
              if (settings.cooldownAfterMessagesMax < val) updateSetting('cooldownAfterMessagesMax', val)
            }}
            defaultValue={DEFAULTS.cooldownAfterMessages as number}
            onReset={() => resetField('cooldownAfterMessages')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Máximo"
            suffix="msgs"
            min={settings.cooldownAfterMessages}
            max={200}
            step={1}
            value={settings.cooldownAfterMessagesMax}
            onChange={v => updateSetting('cooldownAfterMessagesMax', Math.max(settings.cooldownAfterMessages, v || settings.cooldownAfterMessages))}
            defaultValue={DEFAULTS.cooldownAfterMessagesMax as number}
            onReset={() => resetField('cooldownAfterMessagesMax')}
            disabled={saving}
          />
        </div>

        <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
          Após enviar <strong>{settings.cooldownAfterMessages === settings.cooldownAfterMessagesMax ? settings.cooldownAfterMessages : `${settings.cooldownAfterMessages}-${settings.cooldownAfterMessagesMax}`}</strong> mensagens, o chip faz uma pausa de <strong>{settings.cooldownMinutes === settings.cooldownMinutesMax ? settings.cooldownMinutes : `${settings.cooldownMinutes}-${settings.cooldownMinutesMax}`}</strong> min. Valores são aleatórios dentro dos ranges.
        </div>

        <Separator />

        <ToggleRow
          title="Parada em Aviso"
          description="Para ao detectar aviso"
          checked={settings.stopOnWarning}
          onCheckedChange={v => updateSetting('stopOnWarning', v)}
          onReset={() => resetField('stopOnWarning')}
        />

        <ToggleRow
          title="Preview de Links"
          description="Mostra preview de URLs nas mensagens (desativado por padrão — previews em massa são detectáveis como bot)"
          checked={settings.linkPreviewEnabled}
          onCheckedChange={v => updateSetting('linkPreviewEnabled', v)}
          onReset={() => resetField('linkPreviewEnabled')}
        />
      </div>
    </FieldCard>
  )
}
