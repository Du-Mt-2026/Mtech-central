'use client'

// Warming Tab — Aquecimento de Chips
// ==============================================
// UI para gerenciar sessões de aquecimento onde chips
// "conversam entre si" antes de irem para operação.
//
// Funcionalidades:
//   - Criar sessões de aquecimento
//   - Selecionar chips participantes
//   - Configurar estratégia (round_robin, pairs, random, group)
//   - Definir templates de mensagens (texto, imagem, áudio)
//   - Acompanhar progresso em tempo real
//   - Iniciar/pausar/retomar/cancelar sessões

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'

// ============================================================
// TYPES
// ============================================================

interface Chip {
  id: string
  name: string
  phoneNumber: string
  status: string
  warmingPhase: string
  evolutionInstance: string | null
}

interface WarmingSession {
  id: string
  name: string
  status: string
  strategy: string
  chipIds: string
  messageTemplates: string
  messagesPerChip: number
  messagesSent: number
  messagesFailed: number
  intervalMin: number
  intervalMax: number
  activeHoursStart: number
  activeHoursEnd: number
  breakWindows: string
  timezone: string
  messageTypeDistribution: string
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  pausedAt: string | null
  lastMessageAt: string | null
  chipProgress: string
  lastError: string | null
  errorCount: number
  // ai_bot strategy fields
  aiBotPhoneNumber: string | null
  aiBotReplyTimeoutSec: number
  aiBotMaxMissedReplies: number
  createdAt: string
  updatedAt: string
}

interface ChipStats {
  id: string
  name: string
  phone: string
  status: string
  warmingPhase: string
  sent: number
  received: number
  total: number
  target: number
  percentage: number
}

interface WarmingStats {
  id: string
  name: string
  status: string
  strategy: string
  messagesSent: number
  messagesFailed: number
  messagesPerChip: number
  totalTarget: number
  overallProgress: number
  errorCount: number
  lastError: string | null
  startedAt: string | null
  completedAt: string | null
  lastMessageAt: string | null
  chipStats: ChipStats[]
}

// ============================================================
// MESSAGE POOL TYPES (estratégia "ai_bot")
// ============================================================

interface PoolMessage {
  id: string
  category: string
  content: string
  weight: number
  active: boolean
  createdAt: string
  updatedAt: string
}

const POOL_CATEGORIES = [
  { value: 'saudacao', label: 'Saudação', count: 0 },
  { value: 'emoji_unico', label: 'Emoji Único', count: 0 },
  { value: 'emoji_combo', label: 'Combo de Emojis', count: 0 },
  { value: 'pergunta_geral', label: 'Pergunta Geral', count: 0 },
  { value: 'declaracao_casual', label: 'Declaração Casual', count: 0 },
  { value: 'produto_mtech', label: 'Produto Mtech', count: 0 },
  { value: 'info_pedido', label: 'Info de Pedido', count: 0 },
  { value: 'conversa_fiada', label: 'Conversa Fiada', count: 0 },
] as const

// ============================================================
// HELPERS
// ============================================================

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-gray-500' },
  running: { label: 'Executando', color: 'bg-green-500' },
  paused: { label: 'Pausado', color: 'bg-yellow-500' },
  completed: { label: 'Concluído', color: 'bg-blue-500' },
  cancelled: { label: 'Cancelado', color: 'bg-red-500' },
}

const STRATEGY_LABELS: Record<string, string> = {
  round_robin: 'Round Robin (A→B→C→A)',
  pairs: 'Pares (A↔B, C↔D)',
  random: 'Aleatório',
  group: 'Grupo (rotação livre)',
  ai_bot: 'AI Bot (chips → Duda)',
}

const WARMING_PHASE_LABELS: Record<string, string> = {
  nursery: 'Berçário',
  prewarm: 'Pré-aquecido',
  ready: 'Aquecido',
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function WarmingTab() {
  const [sessions, setSessions] = useState<WarmingSession[]>([])
  const [chips, setChips] = useState<Chip[]>([])
  const [selectedSession, setSelectedSession] = useState<WarmingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [editingSession, setEditingSession] = useState<WarmingSession | null>(null)

  // New session form state
  const [formName, setFormName] = useState('')
  const [formStrategy, setFormStrategy] = useState('round_robin')
  const [formChipIds, setFormChipIds] = useState<string[]>([])
  const [formMessagesPerChip, setFormMessagesPerChip] = useState(150)
  const [formIntervalMin, setFormIntervalMin] = useState(45)
  const [formIntervalMax, setFormIntervalMax] = useState(120)
  const [formActiveStart, setFormActiveStart] = useState(480)
  const [formActiveEnd, setFormActiveEnd] = useState(1260)
  const [applyingAntiBan, setApplyingAntiBan] = useState(false)

  // AI Bot strategy fields
  const [formAiBotPhone, setFormAiBotPhone] = useState('48999670797')
  const [formAiBotReplyTimeout, setFormAiBotReplyTimeout] = useState(300)
  const [formAiBotMaxMissed, setFormAiBotMaxMissed] = useState(2)

  // Message Pool tab state
  const [poolMessages, setPoolMessages] = useState<PoolMessage[]>([])
  const [poolCategoryCounts, setPoolCategoryCounts] = useState<Record<string, number>>({})
  const [poolLoading, setPoolLoading] = useState(false)
  const [poolFilterCategory, setPoolFilterCategory] = useState<string>('all')
  const [poolNewCategory, setPoolNewCategory] = useState<string>('saudacao')
  const [poolNewContent, setPoolNewContent] = useState('')
  const [poolSeedLoading, setPoolSeedLoading] = useState(false)

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/warming')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch (error: any) {
      console.error('Error fetching warming sessions:', error)
    }
  }, [])

  // Fetch chips — show ALL chips that have an Evolution instance (connected or not)
  // Chips need to be connected to actually warm, but we show disconnected ones too
  // so the user knows which ones need to be connected first.
  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      if (res.ok) {
        const data = await res.json()
        // API returns array directly, not { chips: [...] }
        const chipList = Array.isArray(data) ? data : (data.chips || [])
        // Show chips that have an evolutionInstance (can send messages) OR are connected
        // This way disconnected chips still appear so user knows to connect them
        setChips(chipList.filter((c: any) => c.evolutionInstance || c.status === 'connected'))
      }
    } catch (error: any) {
      console.error('Error fetching chips:', error)
    }
  }, [])

  // Fetch session stats
  const fetchStats = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/warming/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedSession(data.stats)
      }
    } catch (error: any) {
      console.error('Error fetching stats:', error)
    }
  }, [])

  // ============================================================
  // MESSAGE POOL FUNCTIONS (estratégia "ai_bot")
  // ============================================================

  const fetchPool = useCallback(async () => {
    setPoolLoading(true)
    try {
      const res = await fetch('/api/warming/message-pool?limit=1000')
      if (res.ok) {
        const data = await res.json()
        setPoolMessages(data.messages || [])
        setPoolCategoryCounts(data.categoryCounts || {})
      }
    } catch (error: any) {
      console.error('Error fetching message pool:', error)
    } finally {
      setPoolLoading(false)
    }
  }, [])

  const handlePoolCreate = async () => {
    if (!poolNewContent.trim()) {
      toast.error('Conteúdo da mensagem é obrigatório')
      return
    }
    try {
      const res = await fetch('/api/warming/message-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: poolNewCategory,
          content: poolNewContent.trim(),
        }),
      })
      if (res.ok) {
        toast.success('Mensagem adicionada ao pool')
        setPoolNewContent('')
        fetchPool()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Erro ao criar mensagem')
      }
    } catch (error: any) {
      toast.error('Erro ao criar mensagem: ' + error.message)
    }
  }

  const handlePoolDelete = async (id: string) => {
    if (!confirm('Deletar esta mensagem do pool?')) return
    try {
      const res = await fetch(`/api/warming/message-pool/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Mensagem deletada')
        fetchPool()
      }
    } catch (error: any) {
      toast.error('Erro ao deletar: ' + error.message)
    }
  }

  const handlePoolToggleActive = async (msg: PoolMessage) => {
    try {
      const res = await fetch(`/api/warming/message-pool/${msg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !msg.active }),
      })
      if (res.ok) {
        fetchPool()
      }
    } catch (error: any) {
      toast.error('Erro ao alternar status: ' + error.message)
    }
  }

  const handlePoolSeed = async (reset: boolean = false) => {
    if (reset && !confirm('Isso vai APAGAR todas as mensagens atuais e recriar as 568 padrão. Continuar?')) {
      return
    }
    if (!reset && !confirm('Popular o pool com as 568 mensagens padrão?')) {
      return
    }
    setPoolSeedLoading(true)
    try {
      const res = await fetch('/api/warming/message-pool/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(data.message || `${data.seeded} mensagens adicionadas`)
        fetchPool()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Erro ao popular pool')
      }
    } catch (error: any) {
      toast.error('Erro: ' + error.message)
    } finally {
      setPoolSeedLoading(false)
    }
  }

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchSessions(), fetchChips(), fetchPool()])
      setLoading(false)
    }
    load()
  }, [fetchSessions, fetchChips, fetchPool])

  // Auto-refresh running sessions
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSessions()
      // Also refresh detail view if open
      if (detailOpen && selectedSession?.status === 'running') {
        fetchStats(selectedSession.id)
      }
    }, 10000) // every 10s

    return () => clearInterval(interval)
  }, [fetchSessions, fetchStats, detailOpen, selectedSession?.id, selectedSession?.status])

  // Start editing a session
  const startEditing = (session: WarmingSession) => {
    setEditingSession(session)
    setFormName(session.name)
    setFormStrategy(session.strategy)
    setFormChipIds(JSON.parse(session.chipIds || '[]'))
    setFormMessagesPerChip(session.messagesPerChip)
    setFormIntervalMin(session.intervalMin)
    setFormIntervalMax(session.intervalMax)
    setFormActiveStart(session.activeHoursStart)
    setFormActiveEnd(session.activeHoursEnd)
    setCreateOpen(true)
  }

  // Aplicar configurações do Anti-Ban ao formulário atual
  const applyAntiBanSettings = async () => {
    setApplyingAntiBan(true)
    try {
      const res = await fetch('/api/antiban')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const s = data.settings || data
      if (!s || typeof s.messageIntervalMin !== 'number') {
        throw new Error('Anti-ban não configurado. Configure primeiro na aba Anti-Ban.')
      }
      setFormIntervalMin(s.messageIntervalMin)
      setFormIntervalMax(s.messageIntervalMax)
      setFormActiveStart(s.sendingWindowStart)
      setFormActiveEnd(s.sendingWindowEnd)
      toast.success('🛡️ Configurações do Anti-Ban aplicadas com sucesso!')
    } catch (e: any) {
      toast.error(e.message || 'Erro ao aplicar configurações do Anti-Ban')
    } finally {
      setApplyingAntiBan(false)
    }
  }

  // Create or update session
  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error('Nome é obrigatório')
      return
    }
    const minChips = formStrategy === 'ai_bot' ? 1 : 3
    if (formChipIds.length < minChips && !editingSession) {
      const reason = formStrategy === 'ai_bot'
        ? 'estratégia ai_bot requer no mínimo 1 chip'
        : '2 chips trocando msgs só entre si é detectável pelo Meta (grafo social artificial)'
      toast.error(`Selecione pelo menos ${minChips} chips — ${reason}`)
      return
    }
    if (formChipIds.length < minChips && editingSession?.status !== 'running') {
      toast.error(`Selecione pelo menos ${minChips} chips`)
      return
    }

    // Validate connected chips (only for new sessions or non-running edits)
    if (!editingSession || editingSession.status !== 'running') {
      const disconnectedChips = formChipIds
        .map(id => chips.find(c => c.id === id))
        .filter((c): c is Chip => !!c && c.status !== 'connected')
      if (disconnectedChips.length > 0) {
        const names = disconnectedChips.map(c => c.name).join(', ')
        toast.error(`Chips desconectados: ${names}. Conecte-os na aba Chips antes de usar.`)
        return
      }
    }

    try {
      if (editingSession) {
        // UPDATE existing session
        const payload: Record<string, any> = {
          name: formName,
          intervalMin: formIntervalMin,
          intervalMax: formIntervalMax,
          activeHoursStart: formActiveStart,
          activeHoursEnd: formActiveEnd,
        }
        // Only send these fields if session is not running
        if (editingSession.status !== 'running') {
          payload.strategy = formStrategy
          payload.chipIds = formChipIds
          payload.messagesPerChip = formMessagesPerChip
        }
        // ai_bot fields (always allowed — even on running sessions, since they don't
        // affect which chips participate, just the behavior)
        if (formStrategy === 'ai_bot') {
          payload.aiBotPhoneNumber = formAiBotPhone
          payload.aiBotReplyTimeoutSec = formAiBotReplyTimeout
          payload.aiBotMaxMissedReplies = formAiBotMaxMissed
        }
        const res = await fetch(`/api/warming/${editingSession.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          toast.success(`Sessão "${formName}" atualizada!`)
          setCreateOpen(false)
          setEditingSession(null)
          resetForm()
          fetchSessions()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Erro ao atualizar sessão')
        }
      } else {
        // CREATE new session
        const createPayload: Record<string, any> = {
          name: formName,
          strategy: formStrategy,
          chipIds: formChipIds,
          messagesPerChip: formMessagesPerChip,
          intervalMin: formIntervalMin,
          intervalMax: formIntervalMax,
          activeHoursStart: formActiveStart,
          activeHoursEnd: formActiveEnd,
        }
        if (formStrategy === 'ai_bot') {
          createPayload.aiBotPhoneNumber = formAiBotPhone
          createPayload.aiBotReplyTimeoutSec = formAiBotReplyTimeout
          createPayload.aiBotMaxMissedReplies = formAiBotMaxMissed
        }
        const res = await fetch('/api/warming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
        })
        if (res.ok) {
          toast.success(`Sessão criada! "${formName}" pronta para aquecimento`)
          setCreateOpen(false)
          resetForm()
          fetchSessions()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Erro ao criar sessão')
        }
      }
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  // Reset form
  const resetForm = () => {
    setFormName('')
    setFormStrategy('round_robin')
    setFormChipIds([])
    setFormMessagesPerChip(150)
    setFormIntervalMin(45)
    setFormIntervalMax(120)
    setFormActiveStart(480)
    setFormActiveEnd(1260)
    setFormAiBotPhone('48999670797')
    setFormAiBotReplyTimeout(300)
    setFormAiBotMaxMissed(2)
    setEditingSession(null)
  }

  // Session actions
  const handleAction = async (sessionId: string, action: string) => {
    setActionLoading(sessionId + action)
    try {
      const res = await fetch(`/api/warming/${sessionId}/${action}`, { method: 'POST' })
      if (res.ok) {
        const msgs: Record<string, string> = {
          start: 'Aquecimento iniciado!',
          pause: 'Aquecimento pausado',
          resume: 'Aquecimento retomado',
          cancel: 'Aquecimento cancelado',
        }
        toast.success(msgs[action] || 'Ação realizada')
        fetchSessions()
        if (detailOpen && selectedSession?.id === sessionId) {
          fetchStats(sessionId)
        }
      } else {
        const data = await res.json()
        toast.error(data.error)
      }
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setActionLoading(null)
    }
  }

  // View session details
  const handleViewDetails = async (sessionId: string) => {
    await fetchStats(sessionId)
    setDetailOpen(true)
  }

  // Delete session
  const handleDelete = async (sessionId: string) => {
    if (!confirm('Deletar esta sessão de aquecimento?')) return
    try {
      const res = await fetch(`/api/warming/${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Sessão deletada')
        fetchSessions()
        if (detailOpen && selectedSession?.id === sessionId) {
          setDetailOpen(false)
          setSelectedSession(null)
        }
      }
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  // Toggle chip selection
  const toggleChip = (chipId: string) => {
    const chip = chips.find(c => c.id === chipId)
    if (chip && chip.status !== 'connected') {
      toast.error(`Chip "${chip.name}" não está conectado. Conecte-o na aba Chips antes de usar no aquecimento.`)
      return
    }
    setFormChipIds(prev =>
      prev.includes(chipId)
        ? prev.filter(id => id !== chipId)
        : [...prev, chipId]
    )
  }

  // Overall progress calculation
  const getOverallProgress = (session: WarmingSession) => {
    const chipIds: string[] = JSON.parse(session.chipIds || '[]')
    const target = session.messagesPerChip * chipIds.length
    if (target === 0) return 0
    return Math.round((session.messagesSent / target) * 100)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Aquecimento de Chips</h2>
          <p className="text-muted-foreground mt-1">
            Faça chips conversarem entre si antes de irem para operação — gera histórico positivo no WhatsApp
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) { resetForm() }
        }}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700">
              + Nova Sessão
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingSession ? 'Editar Sessão de Aquecimento' : 'Criar Sessão de Aquecimento'}</DialogTitle>
            </DialogHeader>
            {editingSession?.status === 'running' && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                ⚠️ Sessão em execução — apenas nome, intervalos e janela de envio podem ser alterados.
              </div>
            )}

            <div className="space-y-6 mt-4">
              {/* Nome */}
              <div className="space-y-2">
                <Label>Nome da Sessão *</Label>
                <Input
                  placeholder="Ex: Aquecimento Lote 15/05"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                />
              </div>

              {/* Estratégia — disabled when editing running session */}
              <div className="space-y-2">
                <Label>Estratégia de Conversação</Label>
                <Select value={formStrategy} onValueChange={setFormStrategy} disabled={editingSession?.status === 'running'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round_robin">Round Robin (A→B→C→A)</SelectItem>
                    <SelectItem value="pairs">Pares (A↔B, C↔D)</SelectItem>
                    <SelectItem value="random">Aleatório</SelectItem>
                    <SelectItem value="group">Grupo (rotação livre)</SelectItem>
                    <SelectItem value="ai_bot">AI Bot (chips → Duda)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {formStrategy === 'round_robin' && 'Cada chip fala com o próximo em sequência — boa cobertura'}
                  {formStrategy === 'pairs' && 'Chips são pareados e conversam entre si — mais natural para diálogos'}
                  {formStrategy === 'random' && 'Pares aleatórios a cada mensagem — mais imprevisível'}
                  {formStrategy === 'group' && 'Rotação livre, chips com menos mensagens enviam primeiro — equilibrado'}
                  {formStrategy === 'ai_bot' && 'Chips enviam mensagens do pool global para o Duda (operador humano). Ele responde manualmente e o motor dispara a próxima.'}
                </p>
              </div>

              {/* AI Bot strategy fields — only shown when strategy === 'ai_bot' */}
              {formStrategy === 'ai_bot' && (
                <div className="space-y-4 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                  <h4 className="font-semibold text-purple-700 dark:text-purple-300">Configuração AI Bot</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="aiBotPhone">Telefone do Duda</Label>
                      <Input
                        id="aiBotPhone"
                        value={formAiBotPhone}
                        onChange={(e) => setFormAiBotPhone(e.target.value)}
                        placeholder="48999670797"
                      />
                      <p className="text-xs text-muted-foreground">Sem prefixo 55 — a Evolution adiciona</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="aiBotTimeout">Timeout de Resposta (segundos)</Label>
                      <Input
                        id="aiBotTimeout"
                        type="number"
                        min={60}
                        max={3600}
                        value={formAiBotReplyTimeout}
                        onChange={(e) => setFormAiBotReplyTimeout(parseInt(e.target.value) || 300)}
                      />
                      <p className="text-xs text-muted-foreground">Padrão: 300 (5 minutos)</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="aiBotMaxMissed">Máx. Respostas Perdidas</Label>
                      <Input
                        id="aiBotMaxMissed"
                        type="number"
                        min={1}
                        max={10}
                        value={formAiBotMaxMissed}
                        onChange={(e) => setFormAiBotMaxMissed(parseInt(e.target.value) || 2)}
                      />
                      <p className="text-xs text-muted-foreground">Após N consecutivas, encerra o dia do chip</p>
                    </div>
                  </div>
                  <div className="text-xs text-purple-700 dark:text-purple-300 bg-purple-500/10 p-3 rounded">
                    💡 <strong>Como funciona:</strong> Cada chip do warming envia uma mensagem do pool para o Duda.
                    Ele responde manualmente no WhatsApp. O webhook detecta a resposta e dispara a próxima mensagem
                    (após um delay humano de 30-120s). Se passarem {formAiBotReplyTimeout}s sem resposta, conta como
                    "missed reply". Após {formAiBotMaxMissed} consecutivos, o chip para de conversar até a meia-noite.
                  </div>
                </div>
              )}

              {/* Aplicar configurações do Anti-Ban */}
              <div className="flex items-center gap-3 mb-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={applyAntiBanSettings}
                  disabled={applyingAntiBan}
                  className="border-blue-500 text-blue-600 hover:bg-blue-500/10"
                >
                  {applyingAntiBan ? '⏳ Aplicando...' : '🛡️ Aplicar Anti-Ban'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Copia intervalo entre mensagens e janela de envio das configurações do Anti-Ban para esta sessão
                </span>
              </div>

              {/* Chips — disabled when editing running session */}
              <div className="space-y-2">
                <Label>Chips Participantes * (mín. 3)</Label>
                {editingSession?.status === 'running' ? (
                  <div className="border rounded-lg p-3 bg-muted/50">
                    <p className="text-sm text-muted-foreground">Chips não podem ser alterados com sessão em execução. Pause a sessão para alterar.</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formChipIds.map(id => {
                        const chip = chips.find(c => c.id === id)
                        return chip ? (
                          <Badge key={id} variant="outline">{chip.name}</Badge>
                        ) : null
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    {chips.some(c => c.warmingPhase === 'nursery' || !c.warmingPhase) && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                        ⚠️ Chips no <strong>Berçário</strong> têm limites diários menores (10-80 msgs/dia conforme o dia).
                        O aquecimento respeita automaticamente esses limites — a sessão pausa quando todos os chips atingem o limite do dia e retoma no dia seguinte.
                      </div>
                    )}
                    <div className="border rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
                      {chips.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum chip disponível encontrado. Conecte chips na aba Chips primeiro.</p>
                      ) : (
                        chips.map(chip => {
                          const isConnected = chip.status === 'connected'
                          return (
                            <label key={chip.id} className={`flex items-center gap-3 p-2 rounded ${isConnected ? 'hover:bg-muted cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                              <Checkbox
                                checked={formChipIds.includes(chip.id)}
                                onCheckedChange={() => toggleChip(chip.id)}
                                disabled={!isConnected}
                              />
                              <div className="flex-1">
                                <span className="text-sm font-medium">{chip.name}</span>
                                <span className="text-xs text-muted-foreground ml-2">{chip.phoneNumber}</span>
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  chip.warmingPhase === 'nursery' || !chip.warmingPhase
                                    ? 'border-amber-500 text-amber-600'
                                    : chip.warmingPhase === 'prewarm'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-green-500 text-green-600'
                                }`}
                              >
                                {WARMING_PHASE_LABELS[chip.warmingPhase] || 'Berçário'}
                              </Badge>
                              {!isConnected ? (
                                <Badge variant="outline" className="text-xs border-red-500 text-red-600">
                                  Desconectado
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">🟢</span>
                              )}
                            </label>
                          )
                        })
                      )}
                    </div>
                    {formChipIds.length > 0 && formChipIds.length < 3 && formStrategy !== 'ai_bot' && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-700 dark:text-red-400">
                        ⛔ <strong>Risco de ban!</strong> Apenas {formChipIds.length} chip(s) selecionado(s). O Meta detecta quando 2 números só conversam entre si — é um padrão de bot network. Use pelo menos 3 chips para criar um grafo social natural.
                      </div>
                    )}
                    {formStrategy === 'ai_bot' && formChipIds.length >= 1 && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        ✓ {formChipIds.length} chip(s) selecionado(s) — estratégia ai_bot (chips → Duda), 1 chip já é suficiente ✓
                      </p>
                    )}
                    {formStrategy !== 'ai_bot' && formChipIds.length >= 3 && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        ✓ {formChipIds.length} chips selecionados — grafo social natural ✓
                      </p>
                    )}
                  </>
                )}
              </div>

              <Separator />

              {/* Config */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mensagens por Chip</Label>
                  <Input
                    type="number"
                    min={10}
                    max={500}
                    value={formMessagesPerChip}
                    onChange={e => setFormMessagesPerChip(Number(e.target.value))}
                    disabled={editingSession?.status === 'running'}
                  />
                  <p className="text-xs text-muted-foreground">Meta: envio + recebimento</p>
                </div>
                <div className="space-y-2">
                  <Label>Distribuição de Tipos</Label>
                  <div className="text-sm space-y-1 bg-muted p-2 rounded">
                    <div className="flex justify-between"><span>Texto:</span><span>47% (~70)</span></div>
                    <div className="flex justify-between"><span>Imagem:</span><span>27% (~40)</span></div>
                    <div className="flex justify-between"><span>Áudio:</span><span>26% (~40)</span></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Intervalo Mínimo (seg)</Label>
                  <Input
                    type="number"
                    min={10}
                    max={300}
                    value={formIntervalMin}
                    onChange={e => setFormIntervalMin(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Intervalo Máximo (seg)</Label>
                  <Input
                    type="number"
                    min={30}
                    max={600}
                    value={formIntervalMax}
                    onChange={e => setFormIntervalMax(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Início da Janela</Label>
                  <Input
                    type="time"
                    value={minutesToTime(formActiveStart)}
                    onChange={e => {
                      const [h, m] = e.target.value.split(':').map(Number)
                      setFormActiveStart(h * 60 + m)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fim da Janela</Label>
                  <Input
                    type="time"
                    value={minutesToTime(formActiveEnd)}
                    onChange={e => {
                      const [h, m] = e.target.value.split(':').map(Number)
                      setFormActiveEnd(h * 60 + m)
                    }}
                  />
                </div>
              </div>

              {/* Info box */}
              <div className="bg-muted/50 border rounded-lg p-4 space-y-2">
                <h4 className="text-sm font-semibold">Como funciona o aquecimento?</h4>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Os chips selecionados &quot;conversam entre si&quot; via WhatsApp</li>
                  <li>Chip A manda mensagem para Chip B, que responde para Chip C</li>
                  <li>Troca de texto, imagem e áudio com delays gaussianos</li>
                  <li>Presença humanizada (digitando, online, offline com jitter)</li>
                  <li>Gera histórico de conversas bidirecionais nos servidores da Meta</li>
                  <li>Reduz drasticamente a chance de ban quando o chip for para operação</li>
                </ul>
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm() }}>
                  Cancelar
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleSave}
                  disabled={!formName.trim() || (!editingSession && formChipIds.length < (formStrategy === 'ai_bot' ? 1 : 3))}
                >
                  {editingSession ? 'Salvar Alterações' : 'Criar Sessão'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{sessions.length}</div>
            <p className="text-xs text-muted-foreground">Total de Sessões</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">
              {sessions.filter(s => s.status === 'running').length}
            </div>
            <p className="text-xs text-muted-foreground">Em Execução</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">
              {sessions.filter(s => s.status === 'completed').length}
            </div>
            <p className="text-xs text-muted-foreground">Concluídas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {sessions.reduce((sum, s) => sum + s.messagesSent, 0)}
            </div>
            <p className="text-xs text-muted-foreground">Mensagens Enviadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Sessions List */}
      {sessions.length === 0 ? (
        <Card>
          <CardContent className="pt-6 pb-8 text-center">
            <div className="text-muted-foreground mb-4">
              <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
              </svg>
              <h3 className="text-lg font-medium">Nenhuma sessão de aquecimento</h3>
              <p className="text-sm mt-1">Crie uma sessão para começar a aquecer seus chips</p>
            </div>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => setCreateOpen(true)}>
              + Nova Sessão
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sessions.map(session => {
            const statusInfo = STATUS_LABELS[session.status] || { label: session.status, color: 'bg-gray-500' }
            const progress = getOverallProgress(session)
            const chipCount = JSON.parse(session.chipIds || '[]').length

            return (
              <Card key={session.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center p-4 gap-4">
                    {/* Status indicator */}
                    <div className={`w-3 h-3 rounded-full ${statusInfo.color} shrink-0`} />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{session.name}</h3>
                        <Badge variant="outline" className="text-xs">{statusInfo.label}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {STRATEGY_LABELS[session.strategy] || session.strategy}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{chipCount} chips</span>
                        <span>{session.messagesSent} / {session.messagesPerChip * chipCount} msgs</span>
                        <span>{minutesToTime(session.activeHoursStart)} - {minutesToTime(session.activeHoursEnd)}</span>
                        {session.lastMessageAt && (
                          <span>Última: {formatDate(session.lastMessageAt)}</span>
                        )}
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2">
                        <Progress value={Math.min(progress, 100)} className="h-2" />
                        <span className="text-xs text-muted-foreground">{progress}% completo</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetails(session.id)}
                      >
                        Detalhes
                      </Button>
                      {['draft', 'paused', 'running'].includes(session.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEditing(session)}
                        >
                          ✏️ Editar
                        </Button>
                      )}
                      {session.status === 'draft' && (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => handleAction(session.id, 'start')}
                          disabled={actionLoading === session.id + 'start'}
                        >
                          Iniciar
                        </Button>
                      )}
                      {session.status === 'running' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(session.id, 'pause')}
                          disabled={actionLoading === session.id + 'pause'}
                        >
                          Pausar
                        </Button>
                      )}
                      {session.status === 'paused' && (
                        <>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleAction(session.id, 'resume')}
                            disabled={actionLoading === session.id + 'resume'}
                          >
                            Retomar
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleAction(session.id, 'cancel')}
                            disabled={actionLoading === session.id + 'cancel'}
                          >
                            Cancelar
                          </Button>
                        </>
                      )}
                      {(session.status === 'draft' || session.status === 'cancelled') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleDelete(session.id)}
                        >
                          Deletar
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Error display */}
                  {session.lastError && (
                    <div className="px-4 pb-3">
                      <div className="bg-destructive/10 text-destructive text-xs p-2 rounded">
                        {session.lastError}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Session Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSession?.name || 'Detalhes da Sessão'}
            </DialogTitle>
          </DialogHeader>

          {selectedSession && (
            <div className="space-y-6 mt-4">
              {/* Overview */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-muted p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold">{selectedSession.messagesSent}</div>
                  <div className="text-xs text-muted-foreground">Enviadas</div>
                </div>
                <div className="bg-muted p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-red-500">{selectedSession.messagesFailed}</div>
                  <div className="text-xs text-muted-foreground">Falhas</div>
                </div>
                <div className="bg-muted p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-blue-500">
                    {selectedSession.totalTarget > 0
                      ? Math.round((selectedSession.overallProgress / selectedSession.totalTarget) * 100)
                      : 0}%
                  </div>
                  <div className="text-xs text-muted-foreground">Progresso</div>
                </div>
              </div>

              {/* Meta info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Estratégia:</span> {STRATEGY_LABELS[selectedSession.strategy]}</div>
                <div><span className="text-muted-foreground">Meta/chip:</span> {selectedSession.messagesPerChip} mensagens</div>
                <div><span className="text-muted-foreground">Início:</span> {formatDate(selectedSession.startedAt)}</div>
                <div><span className="text-muted-foreground">Última msg:</span> {formatDate(selectedSession.lastMessageAt)}</div>
              </div>

              {/* Chip Progress Table */}
              <div>
                <h4 className="font-semibold mb-3">Progresso por Chip</h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Chip</th>
                        <th className="text-center p-2">Enviadas</th>
                        <th className="text-center p-2">Recebidas</th>
                        <th className="text-center p-2">Total</th>
                        <th className="text-center p-2">Meta</th>
                        <th className="text-center p-2">Progresso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSession.chipStats.map(chip => (
                        <tr key={chip.id} className="border-t">
                          <td className="p-2">
                            <div className="font-medium">{chip.name}</div>
                            <div className="text-xs text-muted-foreground">{chip.phone}</div>
                          </td>
                          <td className="text-center p-2">{chip.sent}</td>
                          <td className="text-center p-2">{chip.received}</td>
                          <td className="text-center p-2 font-medium">{chip.total}</td>
                          <td className="text-center p-2 text-muted-foreground">{chip.target}</td>
                          <td className="text-center p-2">
                            <div className="flex items-center gap-2 justify-center">
                              <Progress value={Math.min(chip.percentage, 100)} className="h-2 w-16" />
                              <span className="text-xs">{chip.percentage}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Error log */}
              {selectedSession.lastError && (
                <div>
                  <h4 className="font-semibold mb-2">Último Erro</h4>
                  <div className="bg-destructive/10 text-destructive text-sm p-3 rounded">
                    {selectedSession.lastError}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Message Pool Section — for AI Bot strategy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Pool de Mensagens (Estratégia AI Bot)</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePoolSeed(false)}
                disabled={poolSeedLoading}
              >
                {poolSeedLoading ? 'Carregando...' : 'Popular Padrão (568 msgs)'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePoolSeed(true)}
                disabled={poolSeedLoading}
              >
                Resetar Pool
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pool global de mensagens categorizadas usado pela estratégia <strong>AI Bot</strong>.
            Quando um chip está em aquecimento, ele envia mensagens deste pool para o Duda (operador humano),
            que responde manualmente. O motor evita repetir a mesma categoria seguida e respeita os delays anti-ban.
          </p>

          {/* Category badges with counts */}
          <div className="flex flex-wrap gap-2">
            {POOL_CATEGORIES.map(cat => (
              <Badge
                key={cat.value}
                variant={poolFilterCategory === cat.value ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setPoolFilterCategory(poolFilterCategory === cat.value ? 'all' : cat.value)}
              >
                {cat.label}: {poolCategoryCounts[cat.value] || 0}
              </Badge>
            ))}
            {poolFilterCategory !== 'all' && (
              <Badge
                variant="outline"
                className="cursor-pointer text-red-600"
                onClick={() => setPoolFilterCategory('all')}
              >
                ✕ Limpar filtro
              </Badge>
            )}
          </div>

          {/* Add new message */}
          <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
            <h4 className="font-semibold text-sm">Adicionar nova mensagem</h4>
            <div className="flex gap-2 flex-wrap">
              <Select value={poolNewCategory} onValueChange={setPoolNewCategory}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POOL_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={poolNewContent}
                onChange={(e) => setPoolNewContent(e.target.value)}
                placeholder="Conteúdo da mensagem..."
                className="flex-1 min-w-64"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handlePoolCreate()
                  }
                }}
              />
              <Button onClick={handlePoolCreate} disabled={!poolNewContent.trim()}>
                + Adicionar
              </Button>
            </div>
          </div>

          {/* Pool messages list */}
          <div className="border rounded-lg max-h-96 overflow-y-auto">
            {poolLoading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando mensagens...</div>
            ) : poolMessages.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>Nenhuma mensagem no pool ainda.</p>
                <p className="text-xs mt-2">Clique em "Popular Padrão (568 msgs)" para começar, ou adicione manualmente acima.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">Categoria</th>
                    <th className="text-left p-2">Conteúdo</th>
                    <th className="text-center p-2">Status</th>
                    <th className="text-center p-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {poolMessages
                    .filter(m => poolFilterCategory === 'all' || m.category === poolFilterCategory)
                    .map(msg => (
                      <tr key={msg.id} className={`border-t ${!msg.active ? 'opacity-50' : ''}`}>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs">
                            {POOL_CATEGORIES.find(c => c.value === msg.category)?.label || msg.category}
                          </Badge>
                        </td>
                        <td className="p-2">{msg.content}</td>
                        <td className="text-center p-2">
                          <Button
                            size="sm"
                            variant={msg.active ? 'default' : 'outline'}
                            onClick={() => handlePoolToggleActive(msg)}
                          >
                            {msg.active ? 'Ativa' : 'Inativa'}
                          </Button>
                        </td>
                        <td className="text-center p-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handlePoolDelete(msg.id)}
                          >
                            ✕
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Total: <strong>{poolMessages.length}</strong> mensagens no pool
            {poolFilterCategory !== 'all' && (
              <> • Filtrando por: <strong>{POOL_CATEGORIES.find(c => c.value === poolFilterCategory)?.label}</strong></>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Explanation Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Por que aquecer chips?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Um chip novo instalado direto na esteira de vendas tem <strong className="text-foreground">99% de chance de ser banido</strong> pela Meta
            se começar a enviar dezenas de mensagens de uma vez. O algoritmo detecta o comportamento humano zero.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-muted p-4 rounded-lg">
              <h5 className="font-semibold text-foreground mb-2">1. Simulação de Comportamento</h5>
              <p>Coloca-se vários chips em um &quot;robô de conversação&quot; que troca mensagens entre eles como humanos fariam.</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <h5 className="font-semibold text-foreground mb-2">2. Troca de Mensagens</h5>
              <p>O Chip A manda mensagem para o Chip B, que responde para o Chip C, que manda áudio para o Chip A.</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <h5 className="font-semibold text-foreground mb-2">3. Criação de Histórico</h5>
              <p>Gera metadados positivos nos servidores do WhatsApp: histórico de conversas bidirecionais, ligações, mídias.</p>
            </div>
          </div>
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <h5 className="font-semibold text-green-600 mb-1">150 mensagens com texto, imagem e áudio — funciona?</h5>
            <p className="text-foreground">
              <strong>Sim!</strong> A distribuição recomendada é ~47% texto (~70 msgs), ~27% imagem (~40 msgs), ~26% áudio (~40 msgs).
              Quanto às imagens: o WhatsApp <em>remove</em> metadados EXIF das imagens enviadas/recebidas, então não se preocupe com isso.
              O que importa é o <strong>padrão de conversa</strong> — bidirecional, com delays variados, presença humanizada.
              A combinação de texto + mídia é muito mais natural do que só texto, e o áudio (mensagem de voz) é o tipo mais
              &quot;humano&quot; de mensagem no WhatsApp.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
