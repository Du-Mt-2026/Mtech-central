'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Play, Pause, Trash2, Loader2, Users, MessageSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

interface Campaign {
  id: string
  name: string
  status: string
  sendIntervalMin: number
  sendIntervalMax: number
  messageVariations: string
  _count?: { messages: number; chips: number }
}

interface Chip {
  id: string
  name: string
  phoneNumber: string
  status: string
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
}

export function CampaignsSection() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [messageVariations, setMessageVariations] = useState('')
  const [intervalMin, setIntervalMin] = useState(30)
  const [intervalMax, setIntervalMax] = useState(90)
  const [selectedChips, setSelectedChips] = useState<string[]>([])
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

  useEffect(() => {
    fetchCampaigns()
    fetchChips()
  }, [fetchCampaigns, fetchChips])

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Informe o nome da campanha', variant: 'destructive' })
      return
    }
    if (!messageVariations.trim()) {
      toast({ title: 'Adicione pelo menos uma variação de mensagem', variant: 'destructive' })
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
          messageVariations: messageVariations.trim(),
          sendIntervalMin: intervalMin,
          sendIntervalMax: intervalMax,
          chipIds: selectedChips,
        }),
      })

      if (!res.ok) {
        toast({ title: 'Erro ao criar campanha', variant: 'destructive' })
        return
      }

      toast({ title: 'Campanha criada com sucesso!' })
      setName('')
      setMessageVariations('')
      setIntervalMin(30)
      setIntervalMax(90)
      setSelectedChips([])
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
      const res = await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
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
      const res = await fetch(`/api/campaigns?id=${id}`, { method: 'DELETE' })
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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nova Campanha</DialogTitle>
              <DialogDescription>
                Configure sua campanha de envio em massa
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Nome da Campanha</Label>
                <Input
                  id="campaign-name"
                  placeholder="Ex: Promoção Black Friday"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-messages">Variações de Mensagem</Label>
                <Textarea
                  id="campaign-messages"
                  placeholder="Uma variação por linha&#10;Ex: Olá {nome}, temos uma promoção especial!&#10;Ex: Hey {nome}, confira nossa oferta!"
                  value={messageVariations}
                  onChange={(e) => setMessageVariations(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Uma variação por linha. Use {'{nome}'} para personalização.
                </p>
              </div>
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
              <div className="space-y-2">
                <Label>Chips</Label>
                {chips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum chip disponível. Adicione chips primeiro.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {chips.map((chip) => (
                      <label
                        key={chip.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedChips.includes(chip.id)}
                          onCheckedChange={() => toggleChip(chip.id)}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{chip.name}</p>
                          <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>
                        </div>
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
      </div>

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
          {campaigns.map((campaign) => (
            <motion.div key={campaign.id} variants={cardVariants}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{campaign.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={statusColors[campaign.status] || statusColors.draft}
                    >
                      {statusLabels[campaign.status] || campaign.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      <span>{campaign._count?.chips || 0} chips</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{campaign._count?.messages || 0} msgs</span>
                    </div>
                    <span className="text-xs">{campaign.sendIntervalMin}-{campaign.sendIntervalMax}s</span>
                  </div>
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
          ))}
        </motion.div>
      )}
    </div>
  )
}
