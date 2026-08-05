'use client'

// ============================================================
// Anti-Ban — ReconnectionSection
// "Reconexão" FieldCard from the Reconnection section.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Wifi, Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { FIELD_DEFAULTS as DEFAULTS, type AntiBanSettings } from '@/lib/constants'
import { FieldCard, SuffixNumberField, ToggleRow } from './shared'

export interface ReconnectionSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  resetField: (field: string) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
}

export function ReconnectionSection({
  settings,
  updateSetting,
  resetField,
  resetSection,
  saving,
}: ReconnectionSectionProps) {
  return (
    <FieldCard
      title="Reconexão"
      description="Tentativas, rate limit, delays e circuit breaker"
      icon={Wifi}
      accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30"
      onResetSection={() => resetSection('reconnection', 'Reconexão')}
      saving={saving}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SuffixNumberField
          label="Máx. reconexões simultâneas"
          suffix="chips"
          min={1}
          max={10}
          step={1}
          value={settings.reconnectMaxConcurrent ?? 2}
          onChange={v => updateSetting('reconnectMaxConcurrent', Math.max(1, v || 2))}
          defaultValue={DEFAULTS.reconnectMaxConcurrent as number}
          onReset={() => resetField('reconnectMaxConcurrent')}
          disabled={saving}
        />
        <SuffixNumberField
          label="Máx. tentativas"
          suffix="vezes"
          min={1}
          max={50}
          step={1}
          value={settings.reconnectMaxAttempts ?? 10}
          onChange={v => updateSetting('reconnectMaxAttempts', Math.max(1, v || 10))}
          defaultValue={DEFAULTS.reconnectMaxAttempts as number}
          onReset={() => resetField('reconnectMaxAttempts')}
          disabled={saving}
        />
        <SuffixNumberField
          label="Rate limit"
          tooltip="Máximo de tentativas de reconexão por janela de tempo"
          suffix={`/ ${settings.reconnectRateWindowMin ?? 10}min`}
          min={1}
          max={50}
          step={1}
          value={settings.reconnectRateLimit ?? 5}
          onChange={v => updateSetting('reconnectRateLimit', Math.max(1, v || 5))}
          defaultValue={DEFAULTS.reconnectRateLimit as number}
          onReset={() => resetField('reconnectRateLimit')}
          disabled={saving}
        />
        <SuffixNumberField
          label="Janela de rate limit"
          suffix="min"
          min={1}
          max={60}
          step={1}
          value={settings.reconnectRateWindowMin ?? 10}
          onChange={v => updateSetting('reconnectRateWindowMin', Math.max(1, v || 10))}
          defaultValue={DEFAULTS.reconnectRateWindowMin as number}
          onReset={() => resetField('reconnectRateWindowMin')}
          disabled={saving}
        />
        <SuffixNumberField
          label="Delay entre reconexões"
          suffix="ms"
          min={1000}
          max={120000}
          step={1000}
          value={settings.reconnectInterDelayMs ?? 15000}
          onChange={v => updateSetting('reconnectInterDelayMs', Math.max(1000, v || 15000))}
          defaultValue={DEFAULTS.reconnectInterDelayMs as number}
          onReset={() => resetField('reconnectInterDelayMs')}
          disabled={saving}
        />
        <SuffixNumberField
          label="Timeout de conexão"
          suffix="ms"
          min={10000}
          max={300000}
          step={5000}
          value={settings.reconnectConnectTimeoutMs ?? 60000}
          onChange={v => updateSetting('reconnectConnectTimeoutMs', Math.max(10000, v || 60000))}
          defaultValue={DEFAULTS.reconnectConnectTimeoutMs as number}
          onReset={() => resetField('reconnectConnectTimeoutMs')}
          disabled={saving}
        />
        <SuffixNumberField
          label="Circuit breaker"
          tooltip="Quantas falhas consecutivas até o circuit breaker abrir (parar de tentar)"
          suffix="falhas"
          min={1}
          max={20}
          step={1}
          value={settings.circuitBreakerThreshold ?? 3}
          onChange={v => updateSetting('circuitBreakerThreshold', Math.max(1, v || 3))}
          defaultValue={DEFAULTS.circuitBreakerThreshold as number}
          onReset={() => resetField('circuitBreakerThreshold')}
          disabled={saving}
          className="md:col-span-2"
        />
      </div>

      <Separator />

      {/* Backoff progressivo (array<number> armazenado como JSON string) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Backoff progressivo (ms)</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Delays entre tentativas de reconexão (tentativa 1, 2, 3, ...). Ex: 5000 = 5s na 1ª tentativa, 15000 = 15s na 2ª, etc.
            </TooltipContent>
          </Tooltip>
        </div>
        <Textarea
          className="min-h-[60px] text-sm font-mono"
          value={(() => {
            const v = (settings as any).reconnectBackoffMs
            if (!v) return '5000, 15000, 45000, 120000, 300000, 600000'
            if (Array.isArray(v)) return v.join(', ')
            try { return JSON.parse(v).join(', ') } catch { return String(v) }
          })()}
          onChange={e => {
            const arr = e.target.value
              .split(',')
              .map(s => parseInt(s.trim()))
              .filter(n => !isNaN(n) && n >= 1000)
            updateSetting('reconnectBackoffMs', JSON.stringify(arr))
          }}
          placeholder="5000, 15000, 45000, 120000, 300000, 600000"
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">
          Lista de delays em ms separados por vírgula. Mínimo 1000ms cada.
        </p>
      </div>

      <Separator />

      <ToggleRow
        title="Respeitar janela de envio"
        description="Só reconecta durante horário comercial"
        checked={settings.reconnectRespectWindow ?? false}
        onCheckedChange={v => updateSetting('reconnectRespectWindow', v)}
        onReset={() => resetField('reconnectRespectWindow')}
      />
    </FieldCard>
  )
}
