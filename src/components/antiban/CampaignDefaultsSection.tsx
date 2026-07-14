'use client'

// ============================================================
// Anti-Ban — CampaignDefaultsSection
// "Padrões de Campanha" FieldCard + "Dicas Anti-Ban" FieldCard
// from the Avançado section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { motion } from 'framer-motion'
import { Star, Clock, AlertCircle, UserPlus, Flame, RefreshCw, EyeOff } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, ResetIconButton, SuffixNumberField, ToggleRow } from './shared'

export interface CampaignDefaultsSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
  // Tips data — passed from the parent so the parent owns the tips array
  // exactly as in the original (lines 638-646 of antiban-tab.tsx).
  tips: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }[]
}

export function CampaignDefaultsSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
  tips,
}: CampaignDefaultsSectionProps) {
  return (
    <>
      <FieldCard
        title="Padrões de Campanha"
        description="Valores aplicados a novas campanhas por padrão"
        icon={Star}
        accent="text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30"
        onResetSection={() => resetSection('campaignDefaults', 'Padrões de Campanha')}
        saving={saving}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SuffixNumberField
              label="Intervalo mínimo padrão"
              suffix="seg"
              min={5}
              max={300}
              step={1}
              value={settings.defaultSendIntervalMin ?? 30}
              onChange={v => updateSetting('defaultSendIntervalMin', Math.max(5, v || 30))}
              defaultValue={DEFAULTS.defaultSendIntervalMin as number}
              onReset={() => resetField('defaultSendIntervalMin')}
              disabled={saving}
            />
            <SuffixNumberField
              label="Intervalo máximo padrão"
              suffix="seg"
              min={5}
              max={600}
              step={1}
              value={settings.defaultSendIntervalMax ?? 90}
              onChange={v => updateSetting('defaultSendIntervalMax', Math.max(5, v || 90))}
              defaultValue={DEFAULTS.defaultSendIntervalMax as number}
              onReset={() => resetField('defaultSendIntervalMax')}
              disabled={saving}
            />
          </div>

          <ToggleRow
            title="Anti-ban ativo por padrão"
            description="Novas campanhas iniciam com anti-ban ligado"
            checked={settings.defaultAntiBanEnabled ?? true}
            onCheckedChange={v => updateSetting('defaultAntiBanEnabled', v)}
            onReset={() => resetField('defaultAntiBanEnabled')}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Modo de aquecimento padrão</Label>
              <ResetIconButton onClick={() => resetField('defaultWarmingMode')} title={`Padrão: ${DEFAULTS.defaultWarmingMode}`} />
            </div>
            <Select
              value={settings.defaultWarmingMode ?? 'normal'}
              onValueChange={v => updateSetting('defaultWarmingMode', v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="agressive">Agressivo</SelectItem>
                <SelectItem value="stealth">Furtivo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Modo de aquecimento aplicado a novas campanhas.</p>
          </div>
        </div>
      </FieldCard>

      {/* Tips */}
      <FieldCard
        title="Dicas Anti-Ban"
        description="Boas práticas para reduzir risco de bloqueios"
        icon={Star}
        accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
      >
        <div className="space-y-2">
          {tips.map((tip, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors"
            >
              <div className="flex size-8 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/20 shrink-0">
                <tip.icon className="size-4 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{tip.title}</p>
                <p className="text-xs text-muted-foreground">{tip.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </FieldCard>
    </>
  )
}
