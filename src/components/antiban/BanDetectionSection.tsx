'use client'

// ============================================================
// Anti-Ban — BanDetectionSection
// "Detecção de Ban" FieldCard from the Segurança section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { ShieldAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, ResetIconButton, SuffixNumberField } from './shared'

export interface BanDetectionSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
  banCodesText: string
  setBanCodesText: (v: string) => void
  restrictionKeywordsText: string
  setRestrictionKeywordsText: (v: string) => void
  warningKeywordsText: string
  setWarningKeywordsText: (v: string) => void
}

export function BanDetectionSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
  banCodesText,
  setBanCodesText,
  restrictionKeywordsText,
  setRestrictionKeywordsText,
  warningKeywordsText,
  setWarningKeywordsText,
}: BanDetectionSectionProps) {
  return (
    <FieldCard
      title="Detecção de Ban"
      description="Códigos HTTP, keywords de restrição/aviso e janela de monitoramento"
      icon={ShieldAlert}
      accent="text-purple-600 bg-purple-100 dark:bg-purple-900/30"
      onResetSection={() => resetSection('banDetection', 'Detecção de Ban')}
      saving={saving}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Códigos de ban</Label>
            <ResetIconButton onClick={() => resetField('banCodes')} title="Restaurar padrão" />
          </div>
          <Input
            type="text"
            value={banCodesText}
            onChange={e => {
              setBanCodesText(e.target.value)
              const arr = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
              updateSetting('banCodes', JSON.stringify(arr))
            }}
            placeholder="401, 403, 428, 440"
            className="h-9 text-sm"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">Separados por vírgula. Códigos HTTP que indicam ban.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Keywords de restrição</Label>
            <ResetIconButton onClick={() => resetField('restrictionKeywords')} title="Restaurar padrão" />
          </div>
          <Textarea
            value={restrictionKeywordsText}
            onChange={e => {
              setRestrictionKeywordsText(e.target.value)
              const arr = e.target.value.split('\n').map(s => s.trim()).filter(s => s.length > 0)
              updateSetting('restrictionKeywords', JSON.stringify(arr))
            }}
            placeholder="sua conta foi banida&#10;sua conta foi suspensa&#10;..."
            className="min-h-24 text-sm"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">Uma keyword por linha. Palavras que indicam restrição de conta.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Keywords de aviso</Label>
            <ResetIconButton onClick={() => resetField('warningKeywords')} title="Restaurar padrão" />
          </div>
          <Textarea
            value={warningKeywordsText}
            onChange={e => {
              setWarningKeywordsText(e.target.value)
              const arr = e.target.value.split('\n').map(s => s.trim()).filter(s => s.length > 0)
              updateSetting('warningKeywords', JSON.stringify(arr))
            }}
            placeholder="aviso&#10;advertência&#10;spam&#10;..."
            className="min-h-24 text-sm"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">Uma keyword por linha. Palavras que indicam aviso ou alerta.</p>
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SuffixNumberField
            label="Lookback"
            suffix="horas"
            min={1}
            max={168}
            step={1}
            value={settings.banLookbackHours ?? 24}
            onChange={v => updateSetting('banLookbackHours', Math.max(1, v || 24))}
            defaultValue={DEFAULTS.banLookbackHours as number}
            onReset={() => resetField('banLookbackHours')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Threshold de keywords"
            suffix="matches"
            min={1}
            max={10}
            step={1}
            value={settings.banKeywordThreshold ?? 2}
            onChange={v => updateSetting('banKeywordThreshold', Math.max(1, v || 2))}
            defaultValue={DEFAULTS.banKeywordThreshold as number}
            onReset={() => resetField('banKeywordThreshold')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Máx. mensagens (ban)"
            suffix="msgs"
            min={5}
            max={200}
            step={1}
            value={settings.banMaxMessagesCheck ?? 50}
            onChange={v => updateSetting('banMaxMessagesCheck', Math.max(5, v || 50))}
            defaultValue={DEFAULTS.banMaxMessagesCheck as number}
            onReset={() => resetField('banMaxMessagesCheck')}
            disabled={saving}
          />
          <SuffixNumberField
            label="Máx. mensagens (aviso)"
            suffix="msgs"
            min={5}
            max={100}
            step={1}
            value={settings.warningMaxMessagesCheck ?? 20}
            onChange={v => updateSetting('warningMaxMessagesCheck', Math.max(5, v || 20))}
            defaultValue={DEFAULTS.warningMaxMessagesCheck as number}
            onReset={() => resetField('warningMaxMessagesCheck')}
            disabled={saving}
          />
        </div>

        <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
          Monitora as últimas <strong>{settings.banLookbackHours ?? 24}h</strong> de mensagens, verificando até <strong>{settings.banMaxMessagesCheck ?? 50}</strong> msgs para ban e <strong>{settings.warningMaxMessagesCheck ?? 20}</strong> para aviso. Aciona se ≥<strong>{settings.banKeywordThreshold ?? 2}</strong> keywords forem encontradas.
        </div>
      </div>
    </FieldCard>
  )
}
