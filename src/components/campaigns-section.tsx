'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, Play, Pause, Trash2, Loader2, Users, MessageSquare, UserCircle, Shield, Key, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'

interface Campaign {
  id: string
  name: string
  status: string
  sendIntervalMin: number
  sendIntervalMax: number
  antiBanEnabled: boolean
  warmingMode: string
  vendedorId: string | null
  vendedor?: { id: string; nome: string; treatAs: string | null } | null
  _count?: { messages: number; chips: number }
}

interface Chip {
  id: string
  name: string
  phoneNumber: string
  status: string
  vendedorId?: string | null
  vendedor?: { nome: string } | null
}

interface Vendedor {
  id: string
  nome: string
  empresa: string | null
  genero: string | null
  treatAs: string | null
}

interface MessageKey {
  id: string
  name: string
  label: string
  category: string
  variations: string
}

const statusColors: Record<string, string> = {
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  draft: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  completed: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  scheduled: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const statusLabels: Record<string, string> = {
  running: 'Ativa',
  paused: 'Pausada',
  draft: 'Rascunho',
  completed: 'Concluída',
  scheduled: 'Agendada',
  error: 'Erro',
}

const warmingLabels: Record<string, string> = {
  normal: 'Normal',
  agressive: 'Agressivo',
  stealth: 'Furtivo',
}

const warmingDescriptions: Record<string, string> = {
  normal: 'Aquecimento padrão — volumes normais em 7 dias',
  agressive: 'Aquecimento rápido — volumes maiores em 3 dias',
  stealth: 'Aquecimento lento — volumes mínimos em 14 dias',
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
}

export function CampaignsSection() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [chips, setChips] = useState<Chip[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [keys, setKeys] = useState<MessageKey[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [stepContent, setStepContent] = useState('')
  const [intervalMin, setIntervalMin] = useState(30)
  const [intervalMax, setIntervalMax] = useState(90)
  const [selectedChips, setSelectedChips] = useState<string[]>([])
  const [selectedVendedorId, setSelectedVendedorId] = useState<string>('none')
  const [antiBanEnabled, setAntiBanEnabled] = useState(true)
  const [warmingMode, setWarmingMode] = useState('normal')
  const [keysPopoverOpen, setKeysPopoverOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns')
      if (res.ok) {
        const data = await res.json()
        setCampaigns(data)
      }
    } catch {
      toast({ title: 'Erro ao carregar campanhas', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      if (res.ok) {
        setChips(await res.json())
      }
    } catch {
      // ignore
    }
  }, [])

  const fetchVendedores = useCallback(async () => {
    try {
      const res = await fetch('/api/vendedores')
      if (res.ok) {
        const data = await res.json()
        setVendedores(data.filter((v: Vendedor) => v.ativo !== false))
      }
    } catch {
      // ignore
    }
  }, [])

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys')
      if (res.ok) {
        setKeys(await res.json())
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchCampaigns()
    fetchChips()
    fetchVendedores()
    fetchKeys()
  }, [fetchCampaigns, fetchChips, fetchVendedores, fetchKeys])

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Informe o nome da campanha', variant: 'destructive' })
      return
    }
    if (!stepContent.trim()) {
      toast({ title: 'Adicione pelo menos uma mensagem', variant: 'destructive' })
      return
    }
    if (selectedChips.length === 0) {
      toast({ title: 'Selecione pelo menos um chip', variant: 'destructive' })
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          steps: [{ stepOrder: 1, content: stepContent.trim(), delayMinutes: 0, variations: '[]' }],
          sendIntervalMin: intervalMin,
          sendIntervalMax: intervalMax,
          chipIds: selectedChips,
          vendedorId: selectedVendedorId === 'none' ? null : selectedVendedorId,
          antiBanEnabled,
          warmingMode,
        }),
      })

      if (!res.ok) {
        toast({ title: 'Erro ao criar campanha', variant: 'destructive' })
        return
      }

      toast({ title: 'Campanha criada com sucesso!' })
      setName('')
      setStepContent('')
      setIntervalMin(30)
      setIntervalMax(90)
      setSelectedChips([])
      setSelectedVendedorId('none')
      setAntiBanEnabled(true)
      setWarmingMode('normal')
      setDialogOpen(false)
      fetchCampaigns()
    } catch {
      toast({ title: 'Erro ao criar campanha', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        toast({ title: `Campanha ${statusLabels[newStatus]?.toLowerCase() || newStatus}!` })
        fetchCampaigns()
      } else {
        toast({ title: 'Erro ao atualizar campanha', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao atualizar campanha', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Campanha removida!' })
        fetchCampaigns()
      } else {
        toast({ title: 'Erro ao remover campanha', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao remover campanha', variant: 'destructive' })
    }
  }

  const toggleChip = (chipId: string) => {
    setSelectedChips((prev) =>
      prev.includes(chipId) ? prev.filter((id) => id !== chipId) : [...prev, chipId]
    )
  }

  const insertKey = (keyName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = stepContent
    const insertion = `{{${keyName}}}`
    const newContent = text.substring(0, start) + insertion + text.substring(end)
    setStepContent(newContent)

    // Set cursor position after insertion
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + insertion.length
      textarea.focus()
    })

    setKeysPopoverOpen(false)
  }

  // Group keys by category
  const groupedKeys = keys.reduce<Record<string, MessageKey[]>>((acc, key) => {
    const cat = key.category || 'geral'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(key)
    return acc
  }, {})

  const categoryLabels: Record<string, string> = {
    saudacao: 'Saudação',
    apresentacao: 'Apresentação',
    pergunta: 'Pergunta',
    encerramento: 'Encerramento',
    emoji: 'Emoji',
    geral: 'Geral',
  }

  // Filter chips by selected vendedor
  const filteredChips = selectedVendedorId && selectedVendedorId !== 'none'
    ? chips.filter((c) => c.vendedorId === selectedVendedorId || !c.vendedorId)
    : chips

  // Count sent vs pending
  const getProgressInfo = (campaign: Campaign) => {
    const total = campaign._count?.messages || 0
    return { total }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie suas campanhas de envio
          </p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nova Campanha
        </Button>
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Campanha</DialogTitle>
            <DialogDescription>
              Configure sua campanha de envio em massa
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Nome da Campanha</Label>
              <Input
                id="campaign-name"
                placeholder="Ex: Promoção Black Friday"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Vendedor + Anti-Ban row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <UserCircle className="w-4 h-4 text-sky-500" />
                  Vendedor
                </Label>
                <Select value={selectedVendedorId} onValueChange={(v) => {
                  setSelectedVendedorId(v)
                  // Auto-select chips for this vendedor
                  if (v !== 'none') {
                    const vendedorChips = chips.filter((c) => c.vendedorId === v)
                    if (vendedorChips.length > 0) {
                      setSelectedChips(vendedorChips.map((c) => c.id))
                    }
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar vendedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (genérico)</SelectItem>
                    {vendedores.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.nome}{v.empresa ? ` — ${v.empresa}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  As mensagens serão enviadas em nome deste vendedor
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  Modo Anti-Ban
                </Label>
                <Select value={warmingMode} onValueChange={setWarmingMode} disabled={!antiBanEnabled}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(warmingLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {antiBanEnabled ? warmingDescriptions[warmingMode] : 'Anti-ban desativado'}
                </p>
              </div>
            </div>

            {/* Anti-Ban toggle */}
            <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium">Anti-Ban ativado</p>
                  <p className="text-xs text-muted-foreground">Typing realista, janela de envio, detecção de banimento</p>
                </div>
              </div>
              <Switch checked={antiBanEnabled} onCheckedChange={setAntiBanEnabled} />
            </div>

            {/* Mensagem com inserção de chaves */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="campaign-messages">Mensagem da Etapa 1</Label>
                <Popover open={keysPopoverOpen} onOpenChange={setKeysPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <Key className="w-3 h-3 mr-1" />
                      Inserir Chave
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0 max-h-64 overflow-y-auto" align="end">
                    {keys.length === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Nenhuma chave criada</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Vá em Chaves para criar
                        </p>
                      </div>
                    ) : (
                      <div className="p-2">
                        {Object.entries(groupedKeys).map(([cat, catKeys]) => (
                          <div key={cat}>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                              {categoryLabels[cat] || cat}
                            </p>
                            {catKeys.map((key) => (
                              <button
                                key={key.id}
                                onClick={() => insertKey(key.name)}
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted flex items-center justify-between group"
                              >
                                <span className="text-xs font-mono text-emerald-400">{'{{'}{key.name}{'}}'}</span>
                                <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">inserir</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <Textarea
                ref={textareaRef}
                id="campaign-messages"
                placeholder="Ex: {{SAUDACAO}} {nome}, sou {{VENDEDOR_ARTIGO}} {vendedor_nome} da {empresa}! {{PERGUNTA}}"
                value={stepContent}
                onChange={(e) => setStepContent(e.target.value)}
                rows={5}
                className="font-mono text-sm"
              />
              <div className="flex flex-wrap gap-1">
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('nome')}>
                  {'{nome}'}
                </code>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('vendedor_nome')}>
                  {'{vendedor_nome}'}
                </code>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('VENDEDOR_ARTIGO')}>
                  {'{vendedor_artigo}'}
                </code>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('empresa')}>
                  {'{empresa}'}
                </code>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('produto')}>
                  {'{produto}'}
                </code>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('cidade')}>
                  {'{cidade}'}
                </code>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors" onClick={() => insertKey('tratamento')}>
                  {'{tratamento}'}
                </code>
              </div>
              {selectedVendedorId !== 'none' && stepContent && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Pré-visualização:</p>
                  <p className="text-sm">
                    {stepContent
                      .replace(/\{vendedor_nome\}/gi, vendedores.find(v => v.id === selectedVendedorId)?.nome || 'Vendedor')
                      .replace(/\{vendedor_artigo\}/gi, vendedores.find(v => v.id === selectedVendedorId)?.treatAs || 'o(a)')
                      .replace(/\{nome\}/gi, 'João')
                      .replace(/\{empresa\}/gi, vendedores.find(v => v.id === selectedVendedorId)?.empresa || 'Empresa')
                      .replace(/\{produto\}/gi, 'Notebook')
                      .replace(/\{cidade\}/gi, 'São Paulo')
                      .replace(/\{tratamento\}/gi, 'Sr.')
                      .replace(/\{\{[^}]+\}\}/g, (match) => {
                        const key = keys.find(k => k.name === match.replace(/[{}]/g, ''))
                        if (key) {
                          try {
                            const vars = JSON.parse(key.variations)
                            return vars[0] || match
                          } catch { return match }
                        }
                        return match
                      })
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Interval */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="interval-min">Intervalo Mín (seg)</Label>
                <Input
                  id="interval-min"
                  type="number"
                  min={5}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(parseInt(e.target.value) || 30)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interval-max">Intervalo Máx (seg)</Label>
                <Input
                  id="interval-max"
                  type="number"
                  min={10}
                  value={intervalMax}
                  onChange={(e) => setIntervalMax(parseInt(e.target.value) || 90)}
                />
              </div>
            </div>

            {/* Chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Chips ({selectedChips.length} selecionado{selectedChips.length !== 1 ? 's' : ''})</Label>
                {selectedVendedorId !== 'none' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-sky-500"
                    onClick={() => {
                      const vChips = chips.filter((c) => c.vendedorId === selectedVendedorId)
                      setSelectedChips(vChips.map((c) => c.id))
                    }}
                  >
                    Selecionar chips do vendedor
                  </Button>
                )}
              </div>
              {chips.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum chip disponível. Adicione chips primeiro.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {filteredChips.map((chip) => (
                    <label
                      key={chip.id}
                      className={`flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer ${
                        chip.vendedorId ? '' : ''
                      }`}
                    >
                      <Checkbox
                        checked={selectedChips.includes(chip.id)}
                        onCheckedChange={() => toggleChip(chip.id)}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{chip.name}</p>
                        <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>
                      </div>
                      {chip.vendedor?.nome && (
                        <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
                          {chip.vendedor.nome}
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          chip.status === 'connected'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                        }`}
                      >
                        {chip.status === 'connected' ? 'Online' : 'Offline'}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                'Criar Campanha'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaigns grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-5 w-40 bg-muted rounded mb-3" />
                <div className="h-4 w-24 bg-muted rounded mb-4" />
                <div className="h-8 w-full bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-emerald-500/10 mb-4">
              <Plus className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Nenhuma campanha</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Crie sua primeira campanha para começar a enviar mensagens.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Campanha
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {campaigns.map((campaign) => {
            const { total } = getProgressInfo(campaign)
            return (
              <motion.div key={campaign.id} variants={cardVariants}>
                <Card className="relative group">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base truncate pr-2">{campaign.name}</CardTitle>
                      <Badge
                        variant="outline"
                        className={statusColors[campaign.status] || statusColors.draft}
                      >
                        {statusLabels[campaign.status] || campaign.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Vendedor */}
                    {campaign.vendedor && (
                      <div className="flex items-center gap-2 text-sm">
                        <UserCircle className="w-3.5 h-3.5 text-sky-500" />
                        <span className="text-sky-400">{campaign.vendedor.nome}</span>
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        <span>{campaign._count?.chips || 0} chips</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{total} msgs</span>
                      </div>
                      <span className="text-xs">{campaign.sendIntervalMin}-{campaign.sendIntervalMax}s</span>
                    </div>

                    {/* Anti-ban badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {campaign.statusReason && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                          <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                          {campaign.statusReason}
                        </Badge>
                      )}
                      {campaign.antiBanEnabled && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                          <Shield className="w-2.5 h-2.5 mr-1" />
                          {warmingLabels[campaign.warmingMode] || 'Anti-Ban'}
                        </Badge>
                      )}
                      {!campaign.antiBanEnabled && (
                        <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/30">
                          Sem Anti-Ban
                        </Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      {campaign.status === 'draft' || campaign.status === 'paused' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStatusChange(campaign.id, 'running')}
                          className="flex-1 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30"
                        >
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                          Iniciar
                        </Button>
                      ) : campaign.status === 'running' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStatusChange(campaign.id, 'paused')}
                          className="flex-1 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 border-amber-500/30"
                        >
                          <Pause className="w-3.5 h-3.5 mr-1.5" />
                          Pausar
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(campaign.id)}
                        className="text-red-500 hover:text-red-400 hover:bg-red-500/10 border-red-500/30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}
