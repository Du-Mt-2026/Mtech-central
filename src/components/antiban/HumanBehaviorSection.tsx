'use client'

// ============================================================
// Anti-Ban — HumanBehaviorSection
// Entire "Comportamento Humano" sidebar section from the original
// antiban-tab.tsx. Includes the master toggle + 7 FieldCards
// (Cluster Sending, Cooldown Presence, Day Rhythm, Nonlinear
// Pauses, Typing Simulation HB, Presence Online, Delivery Rate
// Auto-Adjust) + the summary card.
// Extracted verbatim from the original antiban-tab.tsx (no logic
// changes).
// ============================================================

import React from 'react'
import { Brain, Zap, Coffee, Sun, BarChart3, Type, EyeOff, Activity } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_HUMAN_BEHAVIOR,
  type AntiBanSettings,
  type HumanBehaviorConfig,
} from '@/lib/constants'
import {
  FieldCard,
  FieldNote,
  SectionHeading,
  SuffixNumberField,
  ToggleRow,
  PauseTierEditor,
  factorLabel,
} from './shared'

export interface HumanBehaviorSectionProps {
  settings: AntiBanSettings
  updateSetting: (key: string, value: unknown) => void
  updateHumanBehavior: (path: string, value: unknown) => void
  resetSection: (section: string, sectionLabel: string) => void
  saving: boolean
  humanBehavior: HumanBehaviorConfig
}

export function HumanBehaviorSection({
  settings,
  updateSetting,
  updateHumanBehavior,
  resetSection,
  saving,
  humanBehavior,
}: HumanBehaviorSectionProps) {
  return (
    <>
      <SectionHeading
        title="Comportamento Humano"
        description="Faz o bot se parecer com um humano real, evitando padrões detectáveis."
        icon={Brain}
      />

      {/* Wrapper com space-y-8 (vs space-y-6 padrão) — seção densa pede mais respiro vertical */}
      <div className="space-y-8">
        {/* Master toggle */}
        <Card className="shadow-lg">
          <CardContent className="p-5">
            <ToggleRow
              title="Comportamento Humano"
              description="Ativa todos os módulos abaixo (clusters, presença, ritmo, pausas, digitação, presença online, ajuste por entrega)"
              checked={settings.humanBehaviorEnabled ?? true}
              onCheckedChange={v => updateSetting('humanBehaviorEnabled', v)}
              onReset={() => resetSection('humanBehavior', 'Comportamento Humano')}
            />
          </CardContent>
        </Card>

        {settings.humanBehaviorEnabled !== false && (
          <>
            {/* Cluster Sending */}
            <FieldCard
              title="Envio em Clusters"
              description="Rajadas de mensagens com micro-pausas (como um humano que manda várias seguidas)"
              icon={Zap}
              accent="text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30"
            >
              <ToggleRow
                title="Ativar clusters"
                checked={humanBehavior.cluster?.enabled ?? true}
                onCheckedChange={v => updateHumanBehavior('cluster.enabled', v)}
              />
              {humanBehavior.cluster?.enabled !== false && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SuffixNumberField
                    label="Tamanho mínimo do cluster"
                    suffix="msgs"
                    min={2}
                    max={6}
                    step={1}
                    value={humanBehavior.cluster?.minSize ?? 2}
                    onChange={v => updateHumanBehavior('cluster.minSize', Math.max(2, v || 2))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.minSize}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Tamanho máximo do cluster"
                    suffix="msgs"
                    min={2}
                    max={8}
                    step={1}
                    value={humanBehavior.cluster?.maxSize ?? 4}
                    onChange={v => updateHumanBehavior('cluster.maxSize', Math.max(2, v || 4))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.maxSize}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Micro-pausa mínima entre msgs"
                    suffix="seg"
                    min={1}
                    max={30}
                    step={1}
                    value={humanBehavior.cluster?.microPauseMinSec ?? 3}
                    onChange={v => updateHumanBehavior('cluster.microPauseMinSec', Math.max(1, v || 3))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.microPauseMinSec}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Micro-pausa máxima entre msgs"
                    suffix="seg"
                    min={1}
                    max={60}
                    step={1}
                    value={humanBehavior.cluster?.microPauseMaxSec ?? 8}
                    onChange={v => updateHumanBehavior('cluster.microPauseMaxSec', Math.max(1, v || 8))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.microPauseMaxSec}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Pausa mínima após cluster"
                    suffix="seg"
                    min={10}
                    max={300}
                    step={5}
                    value={humanBehavior.cluster?.afterClusterPauseMinSec ?? 30}
                    onChange={v => updateHumanBehavior('cluster.afterClusterPauseMinSec', Math.max(10, v || 30))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.afterClusterPauseMinSec}
                    disabled={saving}
                    className="md:col-span-1"
                  />
                  <SuffixNumberField
                    label="Pausa máxima após cluster"
                    suffix="seg"
                    min={10}
                    max={600}
                    step={5}
                    value={humanBehavior.cluster?.afterClusterPauseMaxSec ?? 90}
                    onChange={v => updateHumanBehavior('cluster.afterClusterPauseMaxSec', Math.max(10, v || 90))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cluster.afterClusterPauseMaxSec}
                    disabled={saving}
                    className="md:col-span-1"
                  />
                </div>
              )}
              <FieldNote>
                Humano: manda 2-4 msgs rápidas, faz pausa, mais 3 msgs, pausa longa...
              </FieldNote>
            </FieldCard>

            {/* Cooldown Presence */}
            <FieldCard
              title="Presença no Cooldown"
              description="Aparece online aleatoriamente durante pausas longas"
              icon={Coffee}
              accent="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30"
            >
              <ToggleRow
                title="Ativar presença no cooldown"
                checked={humanBehavior.cooldownPresence?.enabled ?? true}
                onCheckedChange={v => updateHumanBehavior('cooldownPresence.enabled', v)}
              />
              {humanBehavior.cooldownPresence?.enabled !== false && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SuffixNumberField
                    label="Chance de aparecer"
                    suffix="%"
                    min={5}
                    max={100}
                    step={5}
                    value={humanBehavior.cooldownPresence?.chancePercent ?? 40}
                    onChange={v => updateHumanBehavior('cooldownPresence.chancePercent', Math.max(5, v || 40))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.chancePercent}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Duração mínima online"
                    suffix="seg"
                    min={2}
                    max={120}
                    step={1}
                    value={humanBehavior.cooldownPresence?.durationMinSec ?? 5}
                    onChange={v => updateHumanBehavior('cooldownPresence.durationMinSec', Math.max(2, v || 5))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.durationMinSec}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Duração máxima online"
                    suffix="seg"
                    min={2}
                    max={120}
                    step={1}
                    value={humanBehavior.cooldownPresence?.durationMaxSec ?? 25}
                    onChange={v => updateHumanBehavior('cooldownPresence.durationMaxSec', Math.max(2, v || 25))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.durationMaxSec}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Intervalo mínimo entre aparições"
                    suffix="min"
                    min={1}
                    max={30}
                    step={1}
                    value={humanBehavior.cooldownPresence?.intervalMinMin ?? 2}
                    onChange={v => updateHumanBehavior('cooldownPresence.intervalMinMin', Math.max(1, v || 2))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.intervalMinMin}
                    disabled={saving}
                  />
                  <SuffixNumberField
                    label="Intervalo máximo entre aparições"
                    suffix="min"
                    min={1}
                    max={60}
                    step={1}
                    value={humanBehavior.cooldownPresence?.intervalMaxMin ?? 5}
                    onChange={v => updateHumanBehavior('cooldownPresence.intervalMaxMin', Math.max(1, v || 5))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.intervalMaxMin}
                    disabled={saving}
                  />
                </div>
              )}
              <FieldNote>
                Humano: durante pausa, abre WhatsApp pra checar msgs, depois fecha. Bot fica 100% offline = detectável.
              </FieldNote>
            </FieldCard>

            {/* Day Rhythm */}
            <FieldCard
              title="Ritmo do Dia"
              description="Velocidade varia conforme o horário (manhã mais lento, meio-dia mais rápido)"
              icon={Sun}
              accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
            >
              <ToggleRow
                title="Ativar ritmo do dia"
                checked={humanBehavior.dayRhythm?.enabled ?? true}
                onCheckedChange={v => updateHumanBehavior('dayRhythm.enabled', v)}
              />
              {humanBehavior.dayRhythm?.enabled !== false && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <SuffixNumberField
                    label="Manhã (9-12h)"
                    tooltip="100% = velocidade normal. >100% = mais lento. <100% = mais rápido."
                    suffix="%"
                    min={50}
                    max={300}
                    step={5}
                    value={humanBehavior.dayRhythm?.morningFactor ?? 130}
                    onChange={v => updateHumanBehavior('dayRhythm.morningFactor', Math.max(50, v || 130))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.dayRhythm.morningFactor}
                    disabled={saving}
                    extraHint={factorLabel(humanBehavior.dayRhythm?.morningFactor ?? 130)}
                  />
                  <SuffixNumberField
                    label="Meio-dia (12-14h)"
                    tooltip="100% = velocidade normal. >100% = mais lento. <100% = mais rápido."
                    suffix="%"
                    min={50}
                    max={300}
                    step={5}
                    value={humanBehavior.dayRhythm?.middayFactor ?? 80}
                    onChange={v => updateHumanBehavior('dayRhythm.middayFactor', Math.max(50, v || 80))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.dayRhythm.middayFactor}
                    disabled={saving}
                    extraHint={factorLabel(humanBehavior.dayRhythm?.middayFactor ?? 80)}
                  />
                  <SuffixNumberField
                    label="Tarde (14-17h)"
                    tooltip="100% = velocidade normal. >100% = mais lento. <100% = mais rápido."
                    suffix="%"
                    min={50}
                    max={300}
                    step={5}
                    value={humanBehavior.dayRhythm?.afternoonFactor ?? 100}
                    onChange={v => updateHumanBehavior('dayRhythm.afternoonFactor', Math.max(50, v || 100))}
                    defaultValue={DEFAULT_HUMAN_BEHAVIOR.dayRhythm.afternoonFactor}
                    disabled={saving}
                    extraHint={factorLabel(humanBehavior.dayRhythm?.afternoonFactor ?? 100)}
                  />
                </div>
              )}
              <FieldNote>
                100% = velocidade normal. &gt;100% = mais lento (multiplica o intervalo). &lt;100% = mais rápido. Humano é mais devagar de manhã e noite.
              </FieldNote>
            </FieldCard>

            {/* Nonlinear Pauses */}
            <FieldCard
              title="Pausas Não-Lineares"
              description="Distribuição realista de pausas: curtas, médias e longas com pesos"
              icon={BarChart3}
              accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30"
            >
              <ToggleRow
                title="Ativar pausas não-lineares"
                checked={humanBehavior.nonlinearPauses?.enabled ?? true}
                onCheckedChange={v => updateHumanBehavior('nonlinearPauses.enabled', v)}
              />
              {humanBehavior.nonlinearPauses?.enabled !== false && (
                <div className="space-y-4">
                  <PauseTierEditor
                    tierLabel="Curta"
                    tierColor="bg-emerald-400"
                    weightValue={humanBehavior.nonlinearPauses?.short?.weight ?? 40}
                    minMinValue={humanBehavior.nonlinearPauses?.short?.minMin ?? 2}
                    maxMinValue={humanBehavior.nonlinearPauses?.short?.maxMin ?? 5}
                    onWeightChange={v => updateHumanBehavior('nonlinearPauses.short.weight', Math.max(0, v || 40))}
                    onMinMinChange={v => updateHumanBehavior('nonlinearPauses.short.minMin', Math.max(1, v || 2))}
                    onMaxMinChange={v => updateHumanBehavior('nonlinearPauses.short.maxMin', Math.max(1, v || 5))}
                    disabled={saving}
                  />
                  <PauseTierEditor
                    tierLabel="Média"
                    tierColor="bg-amber-400"
                    weightValue={humanBehavior.nonlinearPauses?.medium?.weight ?? 40}
                    minMinValue={humanBehavior.nonlinearPauses?.medium?.minMin ?? 8}
                    maxMinValue={humanBehavior.nonlinearPauses?.medium?.maxMin ?? 15}
                    onWeightChange={v => updateHumanBehavior('nonlinearPauses.medium.weight', Math.max(0, v || 40))}
                    onMinMinChange={v => updateHumanBehavior('nonlinearPauses.medium.minMin', Math.max(1, v || 8))}
                    onMaxMinChange={v => updateHumanBehavior('nonlinearPauses.medium.maxMin', Math.max(1, v || 15))}
                    disabled={saving}
                  />
                  <PauseTierEditor
                    tierLabel="Longa"
                    tierColor="bg-violet-400"
                    weightValue={humanBehavior.nonlinearPauses?.long?.weight ?? 20}
                    minMinValue={humanBehavior.nonlinearPauses?.long?.minMin ?? 20}
                    maxMinValue={humanBehavior.nonlinearPauses?.long?.maxMin ?? 35}
                    onWeightChange={v => updateHumanBehavior('nonlinearPauses.long.weight', Math.max(0, v || 20))}
                    onMinMinChange={v => updateHumanBehavior('nonlinearPauses.long.minMin', Math.max(1, v || 20))}
                    onMaxMinChange={v => updateHumanBehavior('nonlinearPauses.long.maxMin', Math.max(1, v || 35))}
                    disabled={saving}
                  />

                  {/* Visual bar */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Distribuição</Label>
                    <div className="flex h-3 rounded-full overflow-hidden">
                      {(() => {
                        const total = (humanBehavior.nonlinearPauses?.short?.weight ?? 40) + (humanBehavior.nonlinearPauses?.medium?.weight ?? 40) + (humanBehavior.nonlinearPauses?.long?.weight ?? 20)
                        const shortPct = total > 0 ? ((humanBehavior.nonlinearPauses?.short?.weight ?? 40) / total) * 100 : 33
                        const medPct = total > 0 ? ((humanBehavior.nonlinearPauses?.medium?.weight ?? 40) / total) * 100 : 33
                        const longPct = total > 0 ? ((humanBehavior.nonlinearPauses?.long?.weight ?? 20) / total) * 100 : 33
                        return (
                          <>
                            <div className="bg-emerald-400" style={{ width: `${shortPct}%` }} title={`Curta: ${shortPct.toFixed(0)}%`} />
                            <div className="bg-amber-400" style={{ width: `${medPct}%` }} title={`Média: ${medPct.toFixed(0)}%`} />
                            <div className="bg-violet-400" style={{ width: `${longPct}%` }} title={`Longa: ${longPct.toFixed(0)}%`} />
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}
              <FieldNote>
                Humano: pausa curta (foi ao banheiro), média (café), longa (almoçou/ligação). Bot sempre faz a mesma pausa = padrão detectável.
              </FieldNote>
            </FieldCard>

            {/* Typing Simulation (HB) */}
            <FieldCard
              title="Simulação de Digitação (HB)"
              description="Detalhes finos de digitação humana: velocidade variável, pausas, segmentos"
              icon={Type}
              accent="text-pink-600 bg-pink-100 dark:bg-pink-900/30"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SuffixNumberField
                  label="Velocidade mínima"
                  suffix="carac/s"
                  min={1}
                  max={30}
                  step={1}
                  value={humanBehavior.typingSimulation?.speedMin ?? 6}
                  onChange={v => updateHumanBehavior('typingSimulation.speedMin', Math.max(1, v || 6))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.speedMin}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Velocidade máxima"
                  suffix="carac/s"
                  min={1}
                  max={40}
                  step={1}
                  value={humanBehavior.typingSimulation?.speedMax ?? 14}
                  onChange={v => updateHumanBehavior('typingSimulation.speedMax', Math.max(1, v || 14))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.speedMax}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Chance de pausa no meio"
                  suffix="%"
                  min={0}
                  max={100}
                  step={5}
                  value={humanBehavior.typingSimulation?.pauseChance ?? 30}
                  onChange={v => updateHumanBehavior('typingSimulation.pauseChance', Math.max(0, v || 30))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.pauseChance}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Pausa mínima no meio"
                  suffix="ms"
                  min={500}
                  max={10000}
                  step={500}
                  value={humanBehavior.typingSimulation?.pauseMinMs ?? 1000}
                  onChange={v => updateHumanBehavior('typingSimulation.pauseMinMs', Math.max(500, v || 1000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.pauseMinMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Pausa máxima no meio"
                  suffix="ms"
                  min={500}
                  max={15000}
                  step={500}
                  value={humanBehavior.typingSimulation?.pauseMaxMs ?? 4000}
                  onChange={v => updateHumanBehavior('typingSimulation.pauseMaxMs', Math.max(500, v || 4000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.pauseMaxMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Threshold de mensagem longa"
                  suffix="carac"
                  min={50}
                  max={500}
                  step={10}
                  value={humanBehavior.typingSimulation?.longMsgThreshold ?? 100}
                  onChange={v => updateHumanBehavior('typingSimulation.longMsgThreshold', Math.max(50, v || 100))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.longMsgThreshold}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Chance de pausa em msgs longas"
                  suffix="%"
                  min={0}
                  max={100}
                  step={5}
                  value={humanBehavior.typingSimulation?.longMsgPauseChance ?? 40}
                  onChange={v => updateHumanBehavior('typingSimulation.longMsgPauseChance', Math.max(0, v || 40))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.longMsgPauseChance}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Segmentos mínimos (msgs longas)"
                  suffix="seg"
                  min={2}
                  max={5}
                  step={1}
                  value={humanBehavior.typingSimulation?.segmentsMin ?? 2}
                  onChange={v => updateHumanBehavior('typingSimulation.segmentsMin', Math.max(2, v || 2))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.segmentsMin}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Segmentos máximos (msgs longas)"
                  suffix="seg"
                  min={2}
                  max={6}
                  step={1}
                  value={humanBehavior.typingSimulation?.segmentsMax ?? 3}
                  onChange={v => updateHumanBehavior('typingSimulation.segmentsMax', Math.max(2, v || 3))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.typingSimulation!.segmentsMax}
                  disabled={saving}
                />
              </div>
              <FieldNote>
                Simula digitação humana: velocidade variável, pausas no meio da mensagem, segmentos para textos longos. Sem isso, o "digitando..." aparece e desaparece no mesmo tempo = padrão de bot.
              </FieldNote>
            </FieldCard>

            {/* Presence Online */}
            <FieldCard
              title="Presença Online"
              description="Online/offline realista antes e depois de enviar, com leitura idle"
              icon={EyeOff}
              accent="text-teal-600 bg-teal-100 dark:bg-teal-900/30"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SuffixNumberField
                  label="Offline após envio (mínimo)"
                  suffix="ms"
                  min={1000}
                  max={30000}
                  step={1000}
                  value={humanBehavior.presence?.offlineDelayMinMs ?? 3000}
                  onChange={v => updateHumanBehavior('presence.offlineDelayMinMs', Math.max(1000, v || 3000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.offlineDelayMinMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Offline após envio (máximo)"
                  suffix="ms"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={humanBehavior.presence?.offlineDelayMaxMs ?? 15000}
                  onChange={v => updateHumanBehavior('presence.offlineDelayMaxMs', Math.max(1000, v || 15000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.offlineDelayMaxMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Chance de leitura idle"
                  suffix="%"
                  min={0}
                  max={100}
                  step={5}
                  value={humanBehavior.presence?.idleReadingChance ?? 25}
                  onChange={v => updateHumanBehavior('presence.idleReadingChance', Math.max(0, v || 25))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingChance}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Duração mínima de leitura idle"
                  suffix="ms"
                  min={1000}
                  max={30000}
                  step={1000}
                  value={humanBehavior.presence?.idleReadingDurationMinMs ?? 2000}
                  onChange={v => updateHumanBehavior('presence.idleReadingDurationMinMs', Math.max(1000, v || 2000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingDurationMinMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Duração máxima de leitura idle"
                  suffix="ms"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={humanBehavior.presence?.idleReadingDurationMaxMs ?? 8000}
                  onChange={v => updateHumanBehavior('presence.idleReadingDurationMaxMs', Math.max(1000, v || 8000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingDurationMaxMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Intervalo mínimo para leitura idle"
                  suffix="seg"
                  min={30}
                  max={300}
                  step={10}
                  value={humanBehavior.presence?.idleReadingMinIntervalSec ?? 60}
                  onChange={v => updateHumanBehavior('presence.idleReadingMinIntervalSec', Math.max(30, v || 60))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.idleReadingMinIntervalSec}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Online pré-envio"
                  suffix="ms"
                  min={500}
                  max={5000}
                  step={500}
                  value={humanBehavior.presence?.preSendOnlineMs ?? 1000}
                  onChange={v => updateHumanBehavior('presence.preSendOnlineMs', Math.max(500, v || 1000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.preSendOnlineMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Pausa pré-compose mínima"
                  suffix="ms"
                  min={500}
                  max={5000}
                  step={100}
                  value={humanBehavior.presence?.preComposePauseMinMs ?? 800}
                  onChange={v => updateHumanBehavior('presence.preComposePauseMinMs', Math.max(500, v || 800))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.preComposePauseMinMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Pausa pré-compose máxima"
                  suffix="ms"
                  min={500}
                  max={10000}
                  step={100}
                  value={humanBehavior.presence?.preComposePauseMaxMs ?? 3000}
                  onChange={v => updateHumanBehavior('presence.preComposePauseMaxMs', Math.max(500, v || 3000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.preComposePauseMaxMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Gravação de mídia mínima"
                  suffix="ms"
                  min={1000}
                  max={10000}
                  step={500}
                  value={humanBehavior.presence?.mediaRecordingMinMs ?? 2000}
                  onChange={v => updateHumanBehavior('presence.mediaRecordingMinMs', Math.max(1000, v || 2000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.mediaRecordingMinMs}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Gravação de mídia máxima"
                  suffix="ms"
                  min={1000}
                  max={15000}
                  step={500}
                  value={humanBehavior.presence?.mediaRecordingMaxMs ?? 4000}
                  onChange={v => updateHumanBehavior('presence.mediaRecordingMaxMs', Math.max(1000, v || 4000))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.presence!.mediaRecordingMaxMs}
                  disabled={saving}
                />
              </div>
              <FieldNote>
                Simula presença humana: fica online antes de digitar, demora para sair após enviar, aparece "online" aleatoriamente entre mensagens (como quem está lendo o WhatsApp). Sem isso, o chip entra e sai instantaneamente = comportamento de bot.
              </FieldNote>
            </FieldCard>

            {/* Delivery Rate Auto-Adjust */}
            <FieldCard
              title="Ajuste por Taxa de Entrega"
              description="Desacelera automaticamente quando a taxa de entrega cai"
              icon={Activity}
              accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SuffixNumberField
                  label="Threshold normal"
                  tooltip="Acima deste percentual, o sistema usa velocidade normal"
                  suffix="%"
                  min={0}
                  max={100}
                  step={5}
                  value={humanBehavior.deliveryRate?.normalThreshold ?? 60}
                  onChange={v => updateHumanBehavior('deliveryRate.normalThreshold', Math.max(0, v || 60))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.normalThreshold}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Threshold médio"
                  tooltip="Entre este e o normal, o sistema usa o multiplicador médio"
                  suffix="%"
                  min={0}
                  max={100}
                  step={5}
                  value={humanBehavior.deliveryRate?.mediumThreshold ?? 40}
                  onChange={v => updateHumanBehavior('deliveryRate.mediumThreshold', Math.max(0, v || 40))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.mediumThreshold}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Multiplicador médio"
                  suffix="x"
                  min={1}
                  max={5}
                  step={0.5}
                  value={humanBehavior.deliveryRate?.mediumMultiplier ?? 1.5}
                  onChange={v => updateHumanBehavior('deliveryRate.mediumMultiplier', Math.max(1, parseFloat(String(v)) || 1.5))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.mediumMultiplier}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Threshold baixo"
                  suffix="%"
                  min={0}
                  max={100}
                  step={5}
                  value={humanBehavior.deliveryRate?.lowThreshold ?? 20}
                  onChange={v => updateHumanBehavior('deliveryRate.lowThreshold', Math.max(0, v || 20))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.lowThreshold}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Multiplicador baixo"
                  suffix="x"
                  min={1}
                  max={10}
                  step={0.5}
                  value={humanBehavior.deliveryRate?.lowMultiplier ?? 2.5}
                  onChange={v => updateHumanBehavior('deliveryRate.lowMultiplier', Math.max(1, parseFloat(String(v)) || 2.5))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.lowMultiplier}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Multiplicador crítico"
                  tooltip="Aplicado quando a taxa está abaixo do threshold baixo"
                  suffix="x"
                  min={2}
                  max={10}
                  step={0.5}
                  value={humanBehavior.deliveryRate?.criticalMultiplier ?? 4.0}
                  onChange={v => updateHumanBehavior('deliveryRate.criticalMultiplier', Math.max(2, parseFloat(String(v)) || 4.0))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.criticalMultiplier}
                  disabled={saving}
                />
                <SuffixNumberField
                  label="Amostra mínima"
                  tooltip="Quantas mensagens precisam ter sido enviadas para calcular a taxa de entrega"
                  suffix="msgs"
                  min={5}
                  max={50}
                  step={5}
                  value={humanBehavior.deliveryRate?.minSample ?? 10}
                  onChange={v => updateHumanBehavior('deliveryRate.minSample', Math.max(5, v || 10))}
                  defaultValue={DEFAULT_HUMAN_BEHAVIOR.deliveryRate!.minSample}
                  disabled={saving}
                  className="md:col-span-2"
                />
              </div>
              <FieldNote>
                Se a taxa de entrega cair (mensagens não chegam), o sistema desacelera automaticamente. Poucas entregas = sinal de spam para o WhatsApp. Desacelerar reduz o risco de ban.
              </FieldNote>
            </FieldCard>

            {/* Summary */}
            <Card className="shadow-lg border-cyan-200 dark:border-cyan-800">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-cyan-600" />
                  <CardTitle className="text-base text-cyan-700 dark:text-cyan-400">Resumo do Comportamento</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {humanBehavior.cluster?.enabled !== false && (
                    <>Clusters de {humanBehavior.cluster?.minSize ?? 2}-{humanBehavior.cluster?.maxSize ?? 4} msgs com pausa de {humanBehavior.cluster?.microPauseMinSec ?? 10}-{humanBehavior.cluster?.microPauseMaxSec ?? 25}s entre elas. </>
                  )}
                  {humanBehavior.cooldownPresence?.enabled !== false && (
                    <>Durante cooldown: {humanBehavior.cooldownPresence?.chancePercent ?? 40}% chance de aparecer online por {humanBehavior.cooldownPresence?.durationMinSec ?? 5}-{humanBehavior.cooldownPresence?.durationMaxSec ?? 25}s a cada {humanBehavior.cooldownPresence?.intervalMinMin ?? 2}-{humanBehavior.cooldownPresence?.intervalMaxMin ?? 5}min. </>
                  )}
                  {humanBehavior.dayRhythm?.enabled !== false && (
                    <>Ritmo: manhã {(humanBehavior.dayRhythm?.morningFactor ?? 130)}%, meio-dia {(humanBehavior.dayRhythm?.middayFactor ?? 80)}%, tarde {(humanBehavior.dayRhythm?.afternoonFactor ?? 100)}%. </>
                  )}
                  {humanBehavior.nonlinearPauses?.enabled !== false && (
                    <>Pausas: {(humanBehavior.nonlinearPauses?.short?.weight ?? 40)}% curta, {(humanBehavior.nonlinearPauses?.medium?.weight ?? 40)}% média, {(humanBehavior.nonlinearPauses?.long?.weight ?? 20)}% longa. </>
                  )}
                  <>Digitação: {humanBehavior.typingSimulation?.speedMin ?? 6}-{humanBehavior.typingSimulation?.speedMax ?? 14} carac/s. Presença: offline em {Math.round((humanBehavior.presence?.offlineDelayMinMs ?? 3000) / 1000)}-{Math.round((humanBehavior.presence?.offlineDelayMaxMs ?? 15000) / 1000)}s. </>
                  <>Entrega: normal ≥{humanBehavior.deliveryRate?.normalThreshold ?? 60}%, crítico {(humanBehavior.deliveryRate?.criticalMultiplier ?? 4.0)}x.</>
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
