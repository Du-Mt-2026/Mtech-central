'use client'

import { useEffect, useState, useCallback } from 'react'
import { Shield, Clock, Zap, Loader2, Save, AlertTriangle, Plus, Trash2, Coffee, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'

interface BreakWindow {
  start: number
  end: number
  label: string
}

interface AntiBanSettings {
  id: string
  typingMinDelay: number
  typingMaxDelay: number
  messageIntervalMin: number
  messageIntervalMax: number
  randomLineBreaks: boolean
  emojiVariation: boolean
  dailyLimitPerChip: number
  warmingEnabled: boolean
  warmingDays: number
  cooldownMinutes: number
  cooldownMinutesMax: number
  cooldownAfterMessages: number
  cooldownAfterMessagesMax: number
  stopOnWarning: boolean
  sendingWindowStart: number
  sendingWindowEnd: number
  timezone: string
  breakWindows: string // JSON string from DB
}

const defaultSettings: AntiBanSettings = {
  id: '',
  typingMinDelay: 3000,
  typingMaxDelay: 15000,
  messageIntervalMin: 30,
  messageIntervalMax: 90,
  randomLineBreaks: true,
  emojiVariation: true,
  dailyLimitPerChip: 200,
  warmingEnabled: true,
  warmingDays: 7,
  cooldownMinutes: 30,
  cooldownMinutesMax: 30,
  cooldownAfterMessages: 50,
  cooldownAfterMessagesMax: 50,
  stopOnWarning: true,
  sendingWindowStart: 480,
  sendingWindowEnd: 1260,
  timezone: 'America/Sao_Paulo',
  breakWindows: '[]',
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeToMins(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function AntibanSection() {
  const [settings, setSettings] = useState<AntiBanSettings>(defaultSettings)
  const [breakWindows, setBreakWindows] = useState<BreakWindow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/antiban')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        // Parse breakWindows
        try {
          const parsed = typeof data.breakWindows === 'string' ? JSON.parse(data.breakWindows) : (data.breakWindows || [])
          if (Array.isArray(parsed)) {
            setBreakWindows(parsed)
          }
        } catch { setBreakWindows([]) }
      } else {
        toast({ title: 'Erro ao carregar configurações', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao carregar configurações', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...settings,
        breakWindows: JSON.stringify(breakWindows),
      }
      const res = await fetch('/api/antiban', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        toast({ title: data.error || 'Erro ao salvar', variant: 'destructive' })
        return
      }

      toast({ title: 'Configurações salvas!' })
      const updated = await res.json()
      setSettings(updated)
      // Re-parse breakWindows from updated
      try {
        const parsed = typeof updated.breakWindows === 'string' ? JSON.parse(updated.breakWindows) : (updated.breakWindows || [])
        if (Array.isArray(parsed)) {
          setBreakWindows(parsed)
        }
      } catch { /* ignore */ }
    } catch {
      toast({ title: 'Erro ao salvar configurações', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const updateField = <K extends keyof AntiBanSettings>(key: K, value: AntiBanSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const addBreakWindow = () => {
    setBreakWindows((prev) => [...prev, { start: 720, end: 810, label: 'Almoço' }])
  }

  const removeBreakWindow = (index: number) => {
    setBreakWindows((prev) => prev.filter((_, i) => i !== index))
  }

  const updateBreakWindow = (index: number, field: keyof BreakWindow, value: string | number) => {
    setBreakWindows((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  // Calculate anti-ban score
  const calculateScore = () => {
    let score = 0

    // Typing speed (0-15 points)
    if (settings.typingMinDelay >= 2000) score += 5
    else if (settings.typingMinDelay >= 1000) score += 3
    if (settings.typingMaxDelay >= 10000) score += 5
    else if (settings.typingMaxDelay >= 5000) score += 3
    if (settings.typingMaxDelay > settings.typingMinDelay + 5000) score += 5

    // Message interval (0-20 points)
    if (settings.messageIntervalMin >= 20) score += 5
    if (settings.messageIntervalMax >= 60) score += 5
    if (settings.messageIntervalMax - settings.messageIntervalMin >= 30) score += 5
    if (settings.messageIntervalMin >= 30 && settings.messageIntervalMax >= 90) score += 5

    // Sending window (0-10 points)
    const wsStart = settings.sendingWindowStart < 25 ? settings.sendingWindowStart * 60 : settings.sendingWindowStart
    const wsEnd = settings.sendingWindowEnd < 25 ? settings.sendingWindowEnd * 60 : settings.sendingWindowEnd
    if (wsStart >= 480 && wsEnd <= 1320) score += 10
    else if (wsStart >= 420 && wsEnd <= 1380) score += 5

    // Daily limit (0-10 points)
    if (settings.dailyLimitPerChip <= 150) score += 10
    else if (settings.dailyLimitPerChip <= 200) score += 7
    else if (settings.dailyLimitPerChip <= 300) score += 3

    // Humanization features (0-20 points)
    if (settings.randomLineBreaks) score += 10
    if (settings.emojiVariation) score += 10

    // Warming (0-10 points)
    if (settings.warmingEnabled) score += 5
    if (settings.warmingDays >= 7) score += 5
    else if (settings.warmingDays >= 3) score += 3

    // Cooldown (0-10 points)
    if (settings.cooldownMinutes >= 20) score += 5
    if (settings.cooldownAfterMessages <= 60) score += 5

    // Break windows (0-5 points) — having breaks is good for anti-ban
    if (breakWindows.length > 0) score += 5

    // Warning detection (0-5 points)
    if (settings.stopOnWarning) score += 5

    return Math.min(score, 100)
  }

  const score = calculateScore()
  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400'
  const scoreBg = score >= 80 ? 'bg-emerald-500/10 border-emerald-500/30' : score >= 60 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30'

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-5 w-40 bg-muted rounded mb-3" />
              <div className="h-4 w-64 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  // Format cooldown range for display
  const cooldownRangeDisplay = settings.cooldownMinutes === settings.cooldownMinutesMax
    ? `${settings.cooldownMinutes} min`
    : `${settings.cooldownMinutes}-${settings.cooldownMinutesMax} min`

  const cooldownThresholdDisplay = settings.cooldownAfterMessages === settings.cooldownAfterMessagesMax
    ? `${settings.cooldownAfterMessages} msgs`
    : `${settings.cooldownAfterMessages}-${settings.cooldownAfterMessagesMax} msgs`

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Anti-Ban</h2>
          <p className="text-sm text-muted-foreground">
            Configure o comportamento de envio para evitar bloqueios do WhatsApp
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Salvar Configurações
            </>
          )}
        </Button>
      </div>

      {/* Score Card */}
      <Card className={`mb-6 border ${scoreBg}`}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`text-5xl font-bold ${scoreColor}`}>
                {score}
              </div>
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Score Anti-Ban
                </h3>
                <p className="text-sm text-muted-foreground">
                  {score >= 80 ? 'Excelente — comportamento muito natural' :
                   score >= 60 ? 'Bom — mas pode melhorar' :
                   'Atenção — risco elevado de bloqueio'}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-sm px-3 py-1 ${
                score >= 80 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                score >= 60 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                'bg-red-500/20 text-red-400 border-red-500/30'
              }`}
            >
              {score >= 80 ? '🟢 Seguro' : score >= 60 ? '🟡 Moderado' : '🔴 Arriscado'}
            </Badge>
          </div>
          {/* Progress bar */}
          <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${score}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Settings Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Typing & Speed */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Digitação & Velocidade
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Delay mínimo de digitação</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1000}
                    step={500}
                    value={settings.typingMinDelay}
                    onChange={(e) => updateField('typingMinDelay', parseInt(e.target.value) || 1000)}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">ms</span>
                </div>
                <p className="text-xs text-muted-foreground">{formatMs(settings.typingMinDelay)} antes de enviar</p>
              </div>
              <div className="space-y-2">
                <Label>Delay máximo de digitação</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={2000}
                    step={500}
                    value={settings.typingMaxDelay}
                    onChange={(e) => updateField('typingMaxDelay', parseInt(e.target.value) || 2000)}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">ms</span>
                </div>
                <p className="text-xs text-muted-foreground">{formatMs(settings.typingMaxDelay)} antes de enviar</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Intervalo mín entre mensagens</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={5}
                    value={settings.messageIntervalMin}
                    onChange={(e) => updateField('messageIntervalMin', parseInt(e.target.value) || 5)}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">seg</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Intervalo máx entre mensagens</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={10}
                    value={settings.messageIntervalMax}
                    onChange={(e) => updateField('messageIntervalMax', parseInt(e.target.value) || 10)}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">seg</span>
                </div>
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                O sistema calcula o tempo de digitação proporcional ao tamanho da mensagem (6-14 chars/seg).
                Os delays acima são limites adicionais de segurança.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sending Window + Break Windows */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-500" />
              Janela de Envio
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Mensagens só são enviadas dentro da janela configurada. As pausas (breaks) são horários dentro dessa janela onde o envio para temporariamente.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Início</Label>
                <Select
                  value={String(settings.sendingWindowStart)}
                  onValueChange={(v) => updateField('sendingWindowStart', parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00h</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Término</Label>
                <Select
                  value={String(settings.sendingWindowEnd)}
                  onValueChange={(v) => updateField('sendingWindowEnd', parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((i) => (
                      <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00h</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fuso Horário</Label>
              <Select
                value={settings.timezone}
                onValueChange={(v) => updateField('timezone', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">Brasília (BRT)</SelectItem>
                  <SelectItem value="America/Manaus">Manaus (AMT)</SelectItem>
                  <SelectItem value="America/Belem">Belém (BRT)</SelectItem>
                  <SelectItem value="America/Cuiaba">Cuiabá (AMT)</SelectItem>
                  <SelectItem value="America/Recife">Recife (BRT)</SelectItem>
                  <SelectItem value="America/Fortaleza">Fortaleza (BRT)</SelectItem>
                  <SelectItem value="America/Porto_Velho">Porto Velho (AMT)</SelectItem>
                  <SelectItem value="America/Rio_Branco">Rio Branco (ACT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-500 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Mensagens só serão enviadas entre <strong>{String(settings.sendingWindowStart).padStart(2, '0')}:00</strong> e <strong>{String(settings.sendingWindowEnd).padStart(2, '0')}:00</strong> no fuso <strong>BRT</strong>.
              </p>
            </div>

            {/* Break Windows */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Coffee className="w-4 h-4 text-orange-500" />
                  <Label className="text-sm font-semibold">Pausas dentro da janela</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Adicione pausas para almoço, reuniões ou outros momentos que o time precise ficar indisponível. O envio para automaticamente e retoma ao fim da pausa.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addBreakWindow}
                  className="h-7 text-xs text-orange-500 border-orange-500/30 hover:bg-orange-500/10"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Adicionar Pausa
                </Button>
              </div>
              {breakWindows.length === 0 ? (
                <div className="text-center py-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">Nenhuma pausa configurada. Adicione pausas para almoço, reuniões, etc.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {breakWindows.map((bw, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-orange-500/5 border border-orange-500/20 rounded-lg p-2">
                      <Input
                        type="time"
                        value={minsToTime(bw.start)}
                        onChange={(e) => updateBreakWindow(idx, 'start', timeToMins(e.target.value))}
                        className="w-28 h-8 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">até</span>
                      <Input
                        type="time"
                        value={minsToTime(bw.end)}
                        onChange={(e) => updateBreakWindow(idx, 'end', timeToMins(e.target.value))}
                        className="w-28 h-8 text-xs"
                      />
                      <Input
                        type="text"
                        value={bw.label}
                        onChange={(e) => updateBreakWindow(idx, 'label', e.target.value)}
                        placeholder="Ex: Almoço"
                        className="flex-1 h-8 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBreakWindow(idx)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Humanization */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              Humanização
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Quebras de linha aleatórias</Label>
                <p className="text-xs text-muted-foreground">Insere quebras após pontuação (20-40% chance)</p>
              </div>
              <Switch
                checked={settings.randomLineBreaks}
                onCheckedChange={(v) => updateField('randomLineBreaks', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Variação de emoji</Label>
                <p className="text-xs text-muted-foreground">Troca emojis similares (50% chance): 👍↔👌, 😊↔😄</p>
              </div>
              <Switch
                checked={settings.emojiVariation}
                onCheckedChange={(v) => updateField('emojiVariation', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Parar ao receber aviso</Label>
                <p className="text-xs text-muted-foreground">Pausa campanha automaticamente se detectar alerta do WhatsApp</p>
              </div>
              <Switch
                checked={settings.stopOnWarning}
                onCheckedChange={(v) => updateField('stopOnWarning', v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Limits & Warming */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Limites & Cooldown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Limite diário por chip</Label>
              <Input
                type="number"
                min={10}
                max={500}
                value={settings.dailyLimitPerChip}
                onChange={(e) => updateField('dailyLimitPerChip', parseInt(e.target.value) || 100)}
              />
              <p className="text-xs text-muted-foreground">Máximo de mensagens por chip por dia</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Aquecimento ativado</Label>
                <p className="text-xs text-muted-foreground">Aumenta o volume gradualmente nos primeiros dias</p>
              </div>
              <Switch
                checked={settings.warmingEnabled}
                onCheckedChange={(v) => updateField('warmingEnabled', v)}
              />
            </div>
            {settings.warmingEnabled && (
              <div className="space-y-2">
                <Label>Dias de aquecimento</Label>
                <Input
                  type="number"
                  min={3}
                  max={30}
                  value={settings.warmingDays}
                  onChange={(e) => updateField('warmingDays', parseInt(e.target.value) || 7)}
                />
                <p className="text-xs text-muted-foreground">
                  Dia 1: {Math.round(settings.dailyLimitPerChip / settings.warmingDays)} msgs — Dia {settings.warmingDays}: {settings.dailyLimitPerChip} msgs
                </p>
              </div>
            )}

            {/* Variable Cooldown Duration */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Label className="text-sm font-semibold">Duração do Cooldown</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>A cada ciclo de mensagens, o sistema escolhe um tempo de pausa aleatório entre o mínimo e o máximo configurados. Isso torna o comportamento mais natural e imprevisível.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Mínimo</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={5}
                      value={settings.cooldownMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 5
                        updateField('cooldownMinutes', val)
                        // Auto-adjust max if it's less than min
                        if (settings.cooldownMinutesMax < val) {
                          updateField('cooldownMinutesMax', val)
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Máximo</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={settings.cooldownMinutes}
                      value={settings.cooldownMinutesMax}
                      onChange={(e) => updateField('cooldownMinutesMax', parseInt(e.target.value) || settings.cooldownMinutes)}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Variable Cooldown Threshold */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Label className="text-sm font-semibold">Cooldown após N mensagens</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>A cada ciclo, o sistema escolhe aleatoriamente um número entre o mínimo e o máximo. Após enviar essa quantidade de mensagens, o chip entra em cooldown. Ex: 5-10 significa que o cooldown pode ocorrer após 5, 6, 7, 8, 9 ou 10 mensagens.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Mínimo</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={5}
                      value={settings.cooldownAfterMessages}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 5
                        updateField('cooldownAfterMessages', val)
                        if (settings.cooldownAfterMessagesMax < val) {
                          updateField('cooldownAfterMessagesMax', val)
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">msgs</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Máximo</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={settings.cooldownAfterMessages}
                      value={settings.cooldownAfterMessagesMax}
                      onChange={(e) => updateField('cooldownAfterMessagesMax', parseInt(e.target.value) || settings.cooldownAfterMessages)}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">msgs</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                Após enviar {cooldownThresholdDisplay}, o chip faz uma pausa de {cooldownRangeDisplay} antes de continuar.
                Os valores são aleatórios dentro dos ranges, tornando o comportamento mais imprevisível.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
