'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, Radio, Send, Shield, BarChart3, Plus, Trash2,
  Copy, RefreshCw, Check, X, Clock, Zap, Users, MessageSquare,
  Activity, AlertCircle, ChevronDown, FileText, Settings, Eye,
  Pause, Play, Edit, Upload, Search, ArrowLeft, ListFilter, CalendarDays,
  Phone, UserPlus, FileSpreadsheet, ArrowRight, ChevronRight
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import QRCode from 'qrcode'

// ===== Types =====
interface Chip {
  id: string
  name: string
  phoneNumber: string
  wireguardIp: string
  wireguardPrivKey: string
  wireguardPubKey: string
  socksPort: number
  status: string
  lastSeen: string | null
  createdAt: string
  updatedAt: string
}

interface SequenceStep {
  id: string
  campaignId: string
  stepOrder: number
  content: string
  delayMinutes: number
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  status: string
  messageVariations: string
  sendIntervalMin: number
  sendIntervalMax: number
  contactListId: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  chips: { id: string; chipId: string; chip: Chip }[]
  sequenceSteps: SequenceStep[]
  contactList: { id: string; name: string } | null
  _count?: { messages: number }
}

interface ContactItem {
  id: string
  name: string
  phone: string
  contactListId: string | null
  chipId: string | null
  createdAt: string
}

interface ContactList {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  _count?: { contacts: number; campaigns: number }
}

interface Message {
  id: string
  campaignId: string | null
  chipId: string
  contactId: string
  content: string
  status: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  error: string | null
  createdAt: string
  chip: { name: string; phoneNumber: string }
  contact: { name: string; phone: string }
}

interface Stats {
  totalChips: number
  connectedChips: number
  totalCampaigns: number
  activeCampaigns: number
  totalMessages: number
  sentMessages: number
  deliveredMessages: number
  failedMessages: number
}

// ===== Status Badge Helper =====
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; label: string }> = {
    disconnected: { variant: 'outline', icon: <X className="size-3" />, label: 'Desconectado' },
    connecting: { variant: 'secondary', icon: <RefreshCw className="size-3 animate-spin" />, label: 'Conectando' },
    connected: { variant: 'default', icon: <Check className="size-3" />, label: 'Conectado' },
    error: { variant: 'destructive', icon: <AlertCircle className="size-3" />, label: 'Erro' },
    draft: { variant: 'outline', icon: <Edit className="size-3" />, label: 'Rascunho' },
    scheduled: { variant: 'secondary', icon: <Clock className="size-3" />, label: 'Agendada' },
    running: { variant: 'default', icon: <Play className="size-3" />, label: 'Executando' },
    paused: { variant: 'secondary', icon: <Pause className="size-3" />, label: 'Pausada' },
    completed: { variant: 'default', icon: <Check className="size-3" />, label: 'Concluída' },
    pending: { variant: 'outline', icon: <Clock className="size-3" />, label: 'Pendente' },
    sent: { variant: 'secondary', icon: <Send className="size-3" />, label: 'Enviada' },
    delivered: { variant: 'default', icon: <Check className="size-3" />, label: 'Entregue' },
    read: { variant: 'default', icon: <Eye className="size-3" />, label: 'Lida' },
    failed: { variant: 'destructive', icon: <X className="size-3" />, label: 'Falhou' },
  }
  const v = variants[status] || { variant: 'outline' as const, icon: null, label: status }
  return (
    <Badge variant={v.variant} className="gap-1">
      {v.icon}
      {v.label}
    </Badge>
  )
}

// ===== Confirm Dialog (replaces window.confirm) =====
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = 'Confirmar',
  variant = 'destructive',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
  confirmLabel?: string
  variant?: 'destructive' | 'default'
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { onConfirm(); onOpenChange(false) }}
            className={variant === 'destructive' ? 'bg-rose-600 hover:bg-rose-700' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ===== Dashboard Tab =====
function DashboardTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>

  const s = {
    totalChips: stats.totalChips ?? 0,
    connectedChips: stats.connectedChips ?? 0,
    totalCampaigns: stats.totalCampaigns ?? 0,
    activeCampaigns: stats.activeCampaigns ?? 0,
    totalMessages: stats.totalMessages ?? 0,
    sentMessages: stats.sentMessages ?? 0,
    deliveredMessages: stats.deliveredMessages ?? 0,
    failedMessages: stats.failedMessages ?? 0,
  }
  const deliveryRate = s.totalMessages > 0 ? Math.round((s.deliveredMessages / s.totalMessages) * 100) : 0
  const connectionRate = s.totalChips > 0 ? Math.round((s.connectedChips / s.totalChips) * 100) : 0
  const pendingMessages = Math.max(0, s.totalMessages - s.sentMessages - s.failedMessages)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className="border-l-4 border-l-purple-500">
            <CardHeader>
              <CardDescription>Chips</CardDescription>
              <CardTitle className="text-3xl">{s.totalChips}</CardTitle>
              <CardAction><Smartphone className="size-5 text-purple-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{s.connectedChips} conectados</p>
              <Progress value={connectionRate} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="border-l-4 border-l-emerald-500">
            <CardHeader>
              <CardDescription>Campanhas</CardDescription>
              <CardTitle className="text-3xl">{s.totalCampaigns}</CardTitle>
              <CardAction><Radio className="size-5 text-emerald-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{s.activeCampaigns} ativas</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader>
              <CardDescription>Mensagens</CardDescription>
              <CardTitle className="text-3xl">{s.totalMessages}</CardTitle>
              <CardAction><MessageSquare className="size-5 text-orange-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{s.sentMessages} enviadas</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="border-l-4 border-l-rose-500">
            <CardHeader>
              <CardDescription>Taxa de Entrega</CardDescription>
              <CardTitle className="text-3xl">{deliveryRate}%</CardTitle>
              <CardAction><Activity className="size-5 text-rose-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{s.failedMessages} falharam</p>
              <Progress value={deliveryRate} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Resumo de Mensagens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /> Pendentes</div>
                <span className="font-semibold">{pendingMessages}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Send className="size-4 text-sky-500" /> Enviadas</div>
                <span className="font-semibold">{s.sentMessages}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Entregues</div>
                <span className="font-semibold">{s.deliveredMessages}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><X className="size-4 text-rose-500" /> Falharam</div>
                <span className="font-semibold text-rose-600">{s.failedMessages}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status dos Chips</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Conectados</div>
                <span className="font-semibold">{s.connectedChips}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><X className="size-4 text-muted-foreground" /> Desconectados</div>
                <span className="font-semibold">{s.totalChips - s.connectedChips}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Activity className="size-4 text-purple-500" /> Taxa de Conexão</div>
                <span className="font-semibold">{connectionRate}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ===== Chips Tab =====
function ChipsTab() {
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [selectedChipConfig, setSelectedChipConfig] = useState<{ config: string; chip: Partial<Chip> } | null>(null)
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [newChip, setNewChip] = useState({ name: '', phoneNumber: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setChips(data)
    } catch {
      toast.error('Erro ao carregar chips')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchChips() }, [fetchChips])

  useEffect(() => {
    if (selectedChipConfig?.config) {
      QRCode.toDataURL(selectedChipConfig.config, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        .then(url => setQrCodeUrl(url)).catch(() => setQrCodeUrl(''))
    } else {
      setQrCodeUrl('')
    }
  }, [selectedChipConfig?.config])

  const createChip = async () => {
    try {
      const res = await fetch('/api/chips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newChip) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
      toast.success('Chip criado com sucesso!')
      setAddDialogOpen(false)
      setNewChip({ name: '', phoneNumber: '' })
      fetchChips()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao criar chip')
    }
  }

  const deleteChip = async (id: string) => {
    try {
      await fetch(`/api/chips/${id}`, { method: 'DELETE' })
      toast.success('Chip removido!')
      fetchChips()
    } catch {
      toast.error('Erro ao remover chip')
    }
  }

  const updateChipStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/chips/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      toast.success('Status atualizado!')
      fetchChips()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  const fetchConfig = async (chipId: string) => {
    try {
      const res = await fetch(`/api/wireguard/${chipId}`)
      const data = await res.json()
      setSelectedChipConfig(data)
      setConfigDialogOpen(true)
    } catch {
      toast.error('Erro ao buscar configuração')
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copiado!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Chips</h2>
          <p className="text-sm text-muted-foreground">Gerencie os chips conectados via WireGuard</p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700"><Plus className="size-4" /> Novo Chip</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Chip</DialogTitle>
              <DialogDescription>Cadastre um novo chip para envio de mensagens</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome do Chip</Label>
                <Input placeholder="Ex: Chip Claro 01" value={newChip.name} onChange={e => setNewChip(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Número do Telefone</Label>
                <Input placeholder="Ex: 11999990001" value={newChip.phoneNumber} onChange={e => setNewChip(prev => ({ ...prev, phoneNumber: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createChip} disabled={!newChip.name || !newChip.phoneNumber} className="bg-emerald-600 hover:bg-emerald-700">Criar Chip</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : chips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <Smartphone className="size-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold">Nenhum chip cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1">Adicione um chip para começar a enviar mensagens</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {chips.map((chip, i) => (
              <motion.div key={chip.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <Smartphone className="size-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate">{chip.name}</CardTitle>
                        <CardDescription className="truncate">{chip.phoneNumber}</CardDescription>
                      </div>
                      <CardAction><StatusBadge status={chip.status} /></CardAction>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IP WireGuard</span>
                        <span className="font-mono text-xs">{chip.wireguardIp}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Porta SOCKS</span>
                        <span className="font-mono">{chip.socksPort}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Último visto</span>
                        <span>{chip.lastSeen ? new Date(chip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</span>
                      </div>
                    </div>
                    <Separator className="my-4" />
                    <div className="flex gap-2">
                      <Select onValueChange={(v) => updateChipStatus(chip.id, v)}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="disconnected">Desconectado</SelectItem>
                          <SelectItem value="connecting">Conectando</SelectItem>
                          <SelectItem value="connected">Conectado</SelectItem>
                          <SelectItem value="error">Erro</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => fetchConfig(chip.id)}>
                        <Shield className="size-3.5" /> Config
                      </Button>
                      <Button variant="outline" size="sm" className="text-rose-500 hover:text-rose-600" onClick={() => setDeleteConfirm(chip.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Chip"
        description="Tem certeza que deseja remover este chip? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) deleteChip(deleteConfirm) }}
        confirmLabel="Remover"
        variant="destructive"
      />

      {/* WireGuard Config Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={(open) => {
        setConfigDialogOpen(open)
        if (!open) { setSelectedChipConfig(null); setQrCodeUrl(''); setCopied(false) }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-emerald-500" />
              Configuração WireGuard — {selectedChipConfig?.chip.name}
            </DialogTitle>
            <DialogDescription>Use as abas abaixo para visualizar o QR Code, copiar a configuração ou seguir o tutorial.</DialogDescription>
          </DialogHeader>
          {selectedChipConfig && (
            <Tabs defaultValue="qrcode" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="qrcode" className="flex-1 gap-1.5">📱 QR Code</TabsTrigger>
                <TabsTrigger value="config" className="flex-1 gap-1.5">📄 Configuração</TabsTrigger>
                <TabsTrigger value="tutorial" className="flex-1 gap-1.5">📋 Passo a Passo</TabsTrigger>
              </TabsList>

              <TabsContent value="qrcode" className="mt-4">
                <div className="flex flex-col items-center gap-4">
                  {qrCodeUrl ? (
                    <div className="bg-white p-4 rounded-xl shadow-lg">
                      <img src={qrCodeUrl} alt="QR Code WireGuard" className="w-64 h-64" />
                    </div>
                  ) : (
                    <div className="w-64 h-64 bg-muted rounded-xl flex items-center justify-center">
                      <RefreshCw className="size-8 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <div className="text-center space-y-2">
                    <p className="text-sm font-medium">Escaneie com o app WireGuard no celular</p>
                    <p className="text-xs text-muted-foreground">
                      Abra o app WireGuard → Toque em <strong>+</strong> → <strong>Escanear QR Code</strong>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm w-full max-w-xs">
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <span className="text-muted-foreground text-xs block">IP WireGuard</span>
                      <span className="font-mono font-semibold">{selectedChipConfig.chip.wireguardIp}</span>
                    </div>
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <span className="text-muted-foreground text-xs block">Porta SOCKS</span>
                      <span className="font-mono font-semibold">{selectedChipConfig.chip.socksPort}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="config" className="mt-4">
                <div className="space-y-4">
                  <div className="relative">
                    <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700">
                      {selectedChipConfig.config}
                    </pre>
                  </div>
                  <Button onClick={() => copyToClipboard(selectedChipConfig.config)} variant="outline" className="w-full">
                    {copied ? (<><Check className="size-4 mr-2 text-emerald-500" /> Copiado!</>) : (<><Copy className="size-4 mr-2" /> Copiar Config</>)}
                  </Button>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Chave Pública do Chip</Label>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => copyToClipboard(selectedChipConfig.chip.wireguardPubKey || '')}>
                        <Copy className="size-3 mr-1" /> Copiar
                      </Button>
                    </div>
                    <code className="block rounded-lg bg-muted p-2 text-xs font-mono break-all">
                      {selectedChipConfig.chip.wireguardPubKey}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Cole esta config em <code className="bg-muted px-1 py-0.5 rounded">/etc/wireguard/wg0.conf</code> ou salve como arquivo <code className="bg-muted px-1 py-0.5 rounded">.conf</code> e importe no app
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="tutorial" className="mt-4">
                <div className="space-y-5 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">1</span>
                      No Servidor (VPS)
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>• Instale o WireGuard: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">apt install wireguard</code></p>
                      <p>• Vá na aba <strong>WireGuard</strong> e copie a config do servidor</p>
                      <p>• Cole em <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/etc/wireguard/wg0.conf</code></p>
                      <p>• Ative: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">wg-quick up wg0</code></p>
                      <p>• Habilite IP forwarding: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">sysctl -w net.ipv4.ip_forward=1</code></p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">2</span>
                      No Celular — WireGuard
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>• Instale o app <strong>WireGuard</strong> (Play Store / App Store)</p>
                      <p>• Abra o app e toque no botão <strong>&quot;+&quot;</strong></p>
                      <p>• Escolha <strong>&quot;Escanear QR Code&quot;</strong></p>
                      <p>• Aponte a câmera para o QR Code da aba anterior</p>
                      <p>• Ative o túnel WireGuard</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">3</span>
                      No Celular — Every Proxy
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>• Instale o app <strong>Every Proxy</strong> (Play Store)</p>
                      <p>• Vá na aba <strong>&quot;SOCKS5&quot;</strong></p>
                      <p>• Ligue o switch — <strong>é só ligar, não tem configuração!</strong></p>
                      <p>• Pronto! O proxy SOCKS5 está rodando no chip</p>
                    </div>
                  </div>
                  <div className="mt-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <h4 className="font-semibold text-amber-400 mb-2">Problemas Comuns:</h4>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>• <strong>WireGuard não conecta:</strong> Verifique se a porta 51820/UDP está aberta no firewall</p>
                      <p>• <strong>Proxy não funciona:</strong> Confirme que o WireGuard está conectado ANTES de ligar o Every Proxy</p>
                      <p>• <strong>IP errado no curl:</strong> Reinicie o Every Proxy após conectar o WireGuard</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Campaigns Tab (Enhanced) =====
function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [detailMessages, setDetailMessages] = useState<Message[]>([])
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [availableLists, setAvailableLists] = useState<ContactList[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const [newCampaign, setNewCampaign] = useState({
    name: '',
    sendIntervalMin: 30,
    sendIntervalMax: 90,
    chipIds: [] as string[],
    contactListId: '',
    scheduledAt: '',
    useSequence: false,
    sequenceSteps: [{ content: '', delayMinutes: 0 }],
    messageVariations: [''],
  })

  const resetNewCampaign = () => setNewCampaign({
    name: '',
    sendIntervalMin: 30,
    sendIntervalMax: 90,
    chipIds: [],
    contactListId: '',
    scheduledAt: '',
    useSequence: false,
    sequenceSteps: [{ content: '', delayMinutes: 0 }],
    messageVariations: [''],
  })

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns')
      const data = await res.json()
      setCampaigns(data)
    } catch {
      toast.error('Erro ao carregar campanhas')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setAvailableChips(data)
    } catch { /* empty */ }
  }, [])

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/contact-lists')
      const data = await res.json()
      setAvailableLists(data)
    } catch { /* empty */ }
  }, [])

  useEffect(() => { fetchCampaigns(); fetchChips(); fetchLists() }, [fetchCampaigns, fetchChips, fetchLists])

  const createCampaign = async () => {
    const steps = newCampaign.useSequence
      ? newCampaign.sequenceSteps.map((s, i) => ({ stepOrder: i + 1, content: s.content, delayMinutes: s.delayMinutes }))
      : []
    const payload = {
      name: newCampaign.name,
      sendIntervalMin: newCampaign.sendIntervalMin,
      sendIntervalMax: newCampaign.sendIntervalMax,
      chipIds: newCampaign.chipIds,
      contactListId: newCampaign.contactListId || null,
      scheduledAt: newCampaign.scheduledAt ? new Date(newCampaign.scheduledAt).toISOString() : null,
      steps,
    }
    try {
      const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
      toast.success('Campanha criada com sucesso!')
      setCreateDialogOpen(false)
      resetNewCampaign()
      fetchCampaigns()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao criar campanha')
    }
  }

  const updateCampaignStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      toast.success('Status atualizado!')
      fetchCampaigns()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  const deleteCampaign = async (id: string) => {
    try {
      await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      toast.success('Campanha removida!')
      fetchCampaigns()
    } catch {
      toast.error('Erro ao remover campanha')
    }
  }

  const openDetail = async (campaign: Campaign) => {
    setSelectedCampaign(campaign)
    setDetailDialogOpen(true)
    try {
      const res = await fetch(`/api/messages?campaignId=${campaign.id}`)
      const data = await res.json()
      setDetailMessages(data)
    } catch {
      setDetailMessages([])
    }
  }

  const toggleChip = (chipId: string) => {
    setNewCampaign(prev => ({
      ...prev,
      chipIds: prev.chipIds.includes(chipId) ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId],
    }))
  }

  const addSequenceStep = () => {
    setNewCampaign(prev => ({ ...prev, sequenceSteps: [...prev.sequenceSteps, { content: '', delayMinutes: 60 }] }))
  }
  const removeSequenceStep = (idx: number) => {
    setNewCampaign(prev => ({ ...prev, sequenceSteps: prev.sequenceSteps.filter((_, i) => i !== idx) }))
  }
  const updateSequenceStep = (idx: number, field: 'content' | 'delayMinutes', value: string | number) => {
    setNewCampaign(prev => {
      const steps = [...prev.sequenceSteps]
      steps[idx] = { ...steps[idx], [field]: value }
      return { ...prev, sequenceSteps: steps }
    })
  }

  const addVariation = () => {
    setNewCampaign(prev => ({ ...prev, messageVariations: [...prev.messageVariations, ''] }))
  }
  const removeVariation = (index: number) => {
    setNewCampaign(prev => ({ ...prev, messageVariations: prev.messageVariations.filter((_, i) => i !== index) }))
  }

  const canCreate = newCampaign.name.trim() && newCampaign.chipIds.length > 0 && (
    newCampaign.useSequence ? newCampaign.sequenceSteps.some(s => s.content.trim()) : newCampaign.messageVariations.some(v => v.trim())
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas campanhas de envio em massa</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) resetNewCampaign() }}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700"><Plus className="size-4" /> Nova Campanha</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Criar Campanha</DialogTitle>
              <DialogDescription>Configure uma nova campanha de envio em massa</DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-4">
              {/* Name */}
              <div className="space-y-2">
                <Label>Nome da Campanha</Label>
                <Input placeholder="Ex: Campanha Black Friday" value={newCampaign.name} onChange={e => setNewCampaign(prev => ({ ...prev, name: e.target.value }))} />
              </div>

              {/* Contact List */}
              <div className="space-y-2">
                <Label>Lista de Contatos</Label>
                <Select value={newCampaign.contactListId} onValueChange={v => setNewCampaign(prev => ({ ...prev, contactListId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma lista de contatos" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLists.map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        <div className="flex items-center gap-2">
                          <Users className="size-3.5" />
                          {l.name}
                          <span className="text-xs text-muted-foreground">({l._count?.contacts || 0})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableLists.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma lista criada. Vá para a aba &quot;Contatos&quot; para criar uma.</p>
                )}
              </div>

              {/* Schedule */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /> Agendamento (opcional)</Label>
                <Input
                  type="datetime-local"
                  value={newCampaign.scheduledAt}
                  onChange={e => setNewCampaign(prev => ({ ...prev, scheduledAt: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Deixe vazio para executar imediatamente ao iniciar</p>
              </div>

              {/* Message mode toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Tipo de Mensagem</Label>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${!newCampaign.useSequence ? 'font-semibold' : 'text-muted-foreground'}`}>Variações</span>
                    <button
                      type="button"
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${newCampaign.useSequence ? 'bg-emerald-600' : 'bg-muted'}`}
                      onClick={() => setNewCampaign(prev => ({ ...prev, useSequence: !prev.useSequence }))}
                    >
                      <span className={`inline-block size-4 rounded-full bg-white transition-transform ${newCampaign.useSequence ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className={`text-sm ${newCampaign.useSequence ? 'font-semibold' : 'text-muted-foreground'}`}>Sequência</span>
                  </div>
                </div>
              </div>

              {/* Sequence Steps */}
              {newCampaign.useSequence ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5"><ListFilter className="size-4" /> Sequência de Mensagens</Label>
                    <Button variant="ghost" size="sm" onClick={addSequenceStep}><Plus className="size-3.5" /> Adicionar Passo</Button>
                  </div>
                  {newCampaign.sequenceSteps.map((step, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-xs font-bold text-emerald-600">{i + 1}</span>
                          <span className="text-sm font-medium">Passo {i + 1}</span>
                        </div>
                        {newCampaign.sequenceSteps.length > 1 && (
                          <Button variant="ghost" size="sm" className="text-rose-500 h-6 w-6 p-0" onClick={() => removeSequenceStep(i)}>
                            <X className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      <Textarea
                        placeholder={`Conteúdo da mensagem do passo ${i + 1}...`}
                        value={step.content}
                        onChange={e => updateSequenceStep(i, 'content', e.target.value)}
                        className="min-h-[60px]"
                      />
                      <div className="flex items-center gap-2">
                        <Clock className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Enviar próximo passo após</span>
                        <Input
                          type="number"
                          min={0}
                          value={step.delayMinutes}
                          onChange={e => updateSequenceStep(i, 'delayMinutes', parseInt(e.target.value) || 0)}
                          className="h-8 w-20 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">minutos</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                /* Message Variations */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Variações de Mensagem</Label>
                    <Button variant="ghost" size="sm" onClick={addVariation}><Plus className="size-3.5" /> Adicionar</Button>
                  </div>
                  {newCampaign.messageVariations.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <Textarea
                        placeholder="Use {nome} para personalização..."
                        value={v}
                        onChange={e => {
                          const updated = [...newCampaign.messageVariations]
                          updated[i] = e.target.value
                          setNewCampaign(prev => ({ ...prev, messageVariations: updated }))
                        }}
                        className="min-h-[60px]"
                      />
                      {newCampaign.messageVariations.length > 1 && (
                        <Button variant="ghost" size="sm" className="text-rose-500 shrink-0" onClick={() => removeVariation(i)}>
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Intervals */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Intervalo Mín (seg)</Label>
                  <Input type="number" value={newCampaign.sendIntervalMin} onChange={e => setNewCampaign(prev => ({ ...prev, sendIntervalMin: parseInt(e.target.value) || 30 }))} />
                </div>
                <div className="space-y-2">
                  <Label>Intervalo Máx (seg)</Label>
                  <Input type="number" value={newCampaign.sendIntervalMax} onChange={e => setNewCampaign(prev => ({ ...prev, sendIntervalMax: parseInt(e.target.value) || 90 }))} />
                </div>
              </div>

              {/* Chips */}
              <div className="space-y-2">
                <Label>Chips <span className="text-muted-foreground font-normal">(selecione pelo menos 1)</span></Label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {availableChips.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-2">Nenhum chip disponível. Adicione chips na aba &quot;Chips&quot;.</p>
                  ) : availableChips.map(chip => (
                    <label key={chip.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                      <input type="checkbox" checked={newCampaign.chipIds.includes(chip.id)} onChange={() => toggleChip(chip.id)} className="rounded" />
                      <Smartphone className="size-4 text-purple-500" />
                      <span className="text-sm">{chip.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{chip.phoneNumber}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createCampaign} disabled={!canCreate} className="bg-emerald-600 hover:bg-emerald-700">Criar Campanha</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <Radio className="size-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold">Nenhuma campanha cadastrada</p>
            <p className="text-sm text-muted-foreground mt-1">Crie sua primeira campanha para começar a enviar mensagens</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {campaigns.map((campaign, i) => {
              const variations = JSON.parse(campaign.messageVariations || '[]')
              const hasSequence = campaign.sequenceSteps && campaign.sequenceSteps.length > 0
              return (
                <motion.div key={campaign.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                          <Radio className="size-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="truncate">{campaign.name}</CardTitle>
                          <CardDescription>
                            {campaign.chips.length} chip(s) &bull; {campaign._count?.messages || 0} msgs &bull; {campaign.sendIntervalMin}-{campaign.sendIntervalMax}s
                            {hasSequence && <span className="ml-1">&bull; <span className="text-emerald-500 font-medium">Sequência ({campaign.sequenceSteps.length} passos)</span></span>}
                          </CardDescription>
                        </div>
                        <CardAction><StatusBadge status={campaign.status} /></CardAction>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {/* Contact list & schedule */}
                        <div className="flex flex-wrap gap-2 text-xs">
                          {campaign.contactList && (
                            <Badge variant="outline" className="gap-1">
                              <Users className="size-3" /> {campaign.contactList.name}
                            </Badge>
                          )}
                          {campaign.scheduledAt && (
                            <Badge variant="outline" className="gap-1">
                              <CalendarDays className="size-3" /> {new Date(campaign.scheduledAt).toLocaleString('pt-BR')}
                            </Badge>
                          )}
                        </div>

                        {/* Sequence preview or variations */}
                        {hasSequence ? (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Passos da sequência:</p>
                            <div className="flex flex-wrap gap-1">
                              {campaign.sequenceSteps.map((step) => (
                                <Badge key={step.id} variant="secondary" className="gap-1 text-xs">
                                  <span className="flex size-4 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] font-bold">{step.stepOrder}</span>
                                  {step.content.slice(0, 30)}{step.content.length > 30 ? '...' : ''}
                                  {step.delayMinutes > 0 && <span className="text-muted-foreground">+{step.delayMinutes}min</span>}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : variations.length > 0 ? (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Variações de mensagem:</p>
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                              {variations.slice(0, 2).map((v: string, j: number) => (
                                <p key={j} className="text-sm bg-muted rounded px-2 py-1 truncate">&quot;{v}&quot;</p>
                              ))}
                              {variations.length > 2 && <p className="text-xs text-muted-foreground">+{variations.length - 2} mais variações</p>}
                            </div>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-1">
                          {campaign.chips.map(cc => (
                            <Badge key={cc.id} variant="outline" className="gap-1 text-xs">
                              <Smartphone className="size-3" /> {cc.chip?.name}
                            </Badge>
                          ))}
                        </div>

                        <Separator />
                        <div className="flex gap-2 flex-wrap">
                          <Button variant="outline" size="sm" className="gap-1" onClick={() => openDetail(campaign)}>
                            <Eye className="size-3.5" /> Detalhes
                          </Button>
                          {campaign.status === 'draft' && (
                            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateCampaignStatus(campaign.id, 'running')}>
                              <Play className="size-3.5" /> Iniciar
                            </Button>
                          )}
                          {campaign.status === 'running' && (
                            <Button size="sm" variant="secondary" className="gap-1" onClick={() => updateCampaignStatus(campaign.id, 'paused')}>
                              <Pause className="size-3.5" /> Pausar
                            </Button>
                          )}
                          {campaign.status === 'paused' && (
                            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateCampaignStatus(campaign.id, 'running')}>
                              <Play className="size-3.5" /> Retomar
                            </Button>
                          )}
                          {(campaign.status === 'running' || campaign.status === 'paused') && (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => updateCampaignStatus(campaign.id, 'completed')}>
                              <Check className="size-3.5" /> Concluir
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="text-rose-500 hover:text-rose-600 gap-1" onClick={() => setDeleteConfirm(campaign.id)}>
                            <Trash2 className="size-3.5" /> Remover
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Campanha"
        description="Tem certeza que deseja remover esta campanha? Todas as mensagens associadas serão perdidas."
        onConfirm={() => { if (deleteConfirm) deleteCampaign(deleteConfirm) }}
        confirmLabel="Remover"
        variant="destructive"
      />

      {/* Campaign Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCampaign?.contactList && <Users className="size-5 text-purple-500" />}
              {selectedCampaign?.name}
            </DialogTitle>
            <DialogDescription>Detalhes completos da campanha</DialogDescription>
          </DialogHeader>
          {selectedCampaign && (
            <div className="space-y-5">
              {/* Status & dates */}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selectedCampaign.status} />
                {selectedCampaign.contactList && (
                  <Badge variant="outline" className="gap-1"><Users className="size-3" /> {selectedCampaign.contactList.name}</Badge>
                )}
                {selectedCampaign.scheduledAt && (
                  <Badge variant="outline" className="gap-1"><CalendarDays className="size-3" /> {new Date(selectedCampaign.scheduledAt).toLocaleString('pt-BR')}</Badge>
                )}
              </div>

              {/* Sequence Steps */}
              {selectedCampaign.sequenceSteps && selectedCampaign.sequenceSteps.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm flex items-center gap-2"><ListFilter className="size-4" /> Sequência de Mensagens</h4>
                  <div className="space-y-2">
                    {selectedCampaign.sequenceSteps.map((step) => (
                      <div key={step.id} className="flex gap-3 p-3 rounded-lg border bg-muted/20">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">{step.stepOrder}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm whitespace-pre-wrap">{step.content}</p>
                          {step.delayMinutes > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Clock className="size-3" /> Próximo passo após {step.delayMinutes} min
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Variations fallback */}
              {(!selectedCampaign.sequenceSteps || selectedCampaign.sequenceSteps.length === 0) && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Variações de Mensagem</h4>
                  <div className="space-y-1">
                    {JSON.parse(selectedCampaign.messageVariations || '[]').map((v: string, j: number) => (
                      <p key={j} className="text-sm bg-muted rounded px-3 py-2">&quot;{v}&quot;</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Chips */}
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Chips Atribuídos</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedCampaign.chips.map(cc => (
                    <Badge key={cc.id} variant="outline" className="gap-1">
                      <Smartphone className="size-3" /> {cc.chip?.name} <span className="text-muted-foreground">({cc.chip?.phoneNumber})</span>
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Progresso</h4>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <p className="text-xl font-bold">{detailMessages.filter(m => m.status === 'pending').length}</p>
                    <p className="text-xs text-muted-foreground">Pendentes</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-sky-50 dark:bg-sky-900/20">
                    <p className="text-xl font-bold text-sky-600">{detailMessages.filter(m => m.status === 'sent' || m.status === 'delivered' || m.status === 'read').length}</p>
                    <p className="text-xs text-muted-foreground">Entregues</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                    <p className="text-xl font-bold text-emerald-600">{detailMessages.filter(m => m.status === 'delivered' || m.status === 'read').length}</p>
                    <p className="text-xs text-muted-foreground">Confirmadas</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20">
                    <p className="text-xl font-bold text-rose-600">{detailMessages.filter(m => m.status === 'failed').length}</p>
                    <p className="text-xs text-muted-foreground">Falharam</p>
                  </div>
                </div>
              </div>

              {/* Recent Messages */}
              {detailMessages.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Mensagens Recentes ({detailMessages.length})</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {detailMessages.slice(0, 20).map((msg) => (
                      <div key={msg.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{msg.contact.name}</span>
                            <span className="text-xs text-muted-foreground">{msg.contact.phone}</span>
                          </div>
                          <p className="text-xs mt-0.5 truncate">{msg.content}</p>
                        </div>
                        <StatusBadge status={msg.status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailMessages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma mensagem enviada nesta campanha ainda.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Contacts Tab (NEW) =====
function ContactsTab() {
  const [lists, setLists] = useState<ContactList[]>([])
  const [loading, setLoading] = useState(true)
  const [createListOpen, setCreateListOpen] = useState(false)
  const [selectedList, setSelectedList] = useState<(ContactList & { contacts: ContactItem[] }) | null>(null)
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newContact, setNewContact] = useState({ name: '', phone: '' })
  const [importDragOver, setImportDragOver] = useState(false)
  const [deleteListConfirm, setDeleteListConfirm] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/contact-lists')
      const data = await res.json()
      setLists(data)
    } catch {
      toast.error('Erro ao carregar listas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLists() }, [fetchLists])

  const fetchContacts = useCallback(async (listId: string, search = '') => {
    setContactsLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/contact-lists/${listId}/contacts?${params.toString()}`)
      const data = await res.json()
      setContacts(data.contacts || [])
    } catch {
      toast.error('Erro ao carregar contatos')
    } finally {
      setContactsLoading(false)
    }
  }, [])

  const createList = async () => {
    try {
      const res = await fetch('/api/contact-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newListName }) })
      if (!res.ok) throw new Error()
      toast.success('Lista criada!')
      setCreateListOpen(false)
      setNewListName('')
      fetchLists()
    } catch {
      toast.error('Erro ao criar lista')
    }
  }

  const deleteList = async (id: string) => {
    try {
      await fetch(`/api/contact-lists/${id}`, { method: 'DELETE' })
      toast.success('Lista removida!')
      if (selectedList?.id === id) { setSelectedList(null); setContacts([]) }
      fetchLists()
    } catch {
      toast.error('Erro ao remover lista')
    }
  }

  const openList = async (list: ContactList) => {
    try {
      const res = await fetch(`/api/contact-lists/${list.id}`)
      const data = await res.json()
      setSelectedList(data)
      setContacts(data.contacts || [])
      setSearchQuery('')
    } catch {
      toast.error('Erro ao carregar lista')
    }
  }

  const goBack = () => {
    setSelectedList(null)
    setContacts([])
    setSearchQuery('')
  }

  const addContact = async () => {
    if (!selectedList) return
    try {
      const res = await fetch(`/api/contact-lists/${selectedList.id}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newContact),
      })
      if (!res.ok) throw new Error()
      toast.success('Contato adicionado!')
      setNewContact({ name: '', phone: '' })
      setAddContactOpen(false)
      fetchContacts(selectedList.id, searchQuery)
      fetchLists()
    } catch {
      toast.error('Erro ao adicionar contato')
    }
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    if (selectedList) {
      fetchContacts(selectedList.id, query)
    }
  }

  const handleCSVImport = async () => {
    if (!selectedList || !importFile) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      const res = await fetch(`/api/contact-lists/${selectedList.id}/import`, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${data.imported} contatos importados de ${data.total} encontrados!`)
      setImportOpen(false)
      setImportFile(null)
      fetchContacts(selectedList.id, searchQuery)
      fetchLists()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao importar CSV')
    } finally {
      setImporting(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setImportDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      setImportFile(file)
    } else {
      toast.error('Apenas arquivos CSV são aceitos')
    }
  }

  // Detail view for a specific contact list
  if (selectedList) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={goBack}>
            <ArrowLeft className="size-4" /> Voltar
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{selectedList.name}</h2>
            <p className="text-sm text-muted-foreground">{selectedList.contacts.length} contatos</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={addContactOpen} onOpenChange={setAddContactOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"><UserPlus className="size-3.5" /> Adicionar</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar Contato</DialogTitle>
                  <DialogDescription>Adicione um contato manualmente a esta lista</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input placeholder="Nome do contato" value={newContact.name} onChange={e => setNewContact(prev => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefone</Label>
                    <Input placeholder="Ex: 11999990001" value={newContact.phone} onChange={e => setNewContact(prev => ({ ...prev, phone: e.target.value }))} />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                  <Button onClick={addContact} disabled={!newContact.name || !newContact.phone} className="bg-emerald-600 hover:bg-emerald-700">Adicionar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) setImportFile(null) }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5"><FileSpreadsheet className="size-3.5" /> Importar CSV</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Importar Contatos via CSV</DialogTitle>
                  <DialogDescription>Envie um arquivo CSV com colunas &quot;nome&quot; e &quot;telefone&quot;</DialogDescription>
                </DialogHeader>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${importDragOver ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10' : 'border-muted hover:border-muted-foreground/50'}`}
                  onDragOver={(e) => { e.preventDefault(); setImportDragOver(true) }}
                  onDragLeave={() => setImportDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setImportFile(f) }} />
                  {importFile ? (
                    <div className="space-y-2">
                      <FileText className="size-8 text-emerald-500 mx-auto" />
                      <p className="text-sm font-medium">{importFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="size-8 text-muted-foreground mx-auto" />
                      <p className="text-sm font-medium">Arraste o arquivo CSV aqui</p>
                      <p className="text-xs text-muted-foreground">ou clique para selecionar</p>
                    </div>
                  )}
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium">Formato esperado do CSV:</p>
                  <code className="block">nome,telefone</code>
                  <code className="block">João Silva,11999990001</code>
                  <code className="block">Maria Santos,11999990002</code>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                  <Button onClick={handleCSVImport} disabled={!importFile || importing} className="bg-emerald-600 hover:bg-emerald-700">
                    {importing ? <><RefreshCw className="size-4 animate-spin mr-2" /> Importando...</> : <><Upload className="size-4 mr-2" /> Importar</>}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar contatos..."
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {contactsLoading ? (
          <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
        ) : contacts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="size-10 text-muted-foreground mb-3" />
              <p className="font-medium">Nenhum contato encontrado</p>
              <p className="text-sm text-muted-foreground">{searchQuery ? 'Tente outro termo de busca' : 'Adicione contatos manualmente ou importe um CSV'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            <AnimatePresence>
              {contacts.map((contact, i) => (
                <motion.div key={contact.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                  <Card className="py-2.5">
                    <CardContent className="py-0">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30 shrink-0">
                          <UserPlus className="size-3.5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{contact.name}</p>
                          <p className="text-xs text-muted-foreground">{contact.phone}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          <Phone className="size-2.5 mr-1" /> {contact.phone}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    )
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Contatos</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas listas de contatos para campanhas</p>
        </div>
        <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700"><Plus className="size-4" /> Nova Lista</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Lista de Contatos</DialogTitle>
              <DialogDescription>As listas organizam contatos para uso nas campanhas</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome da Lista</Label>
                <Input placeholder="Ex: Clientes VIP, Leads Janeiro..." value={newListName} onChange={e => setNewListName(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createList} disabled={!newListName.trim()} className="bg-emerald-600 hover:bg-emerald-700">Criar Lista</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : lists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <Users className="size-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold">Nenhuma lista de contatos</p>
            <p className="text-sm text-muted-foreground mt-1">Crie uma lista para organizar seus contatos</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {lists.map((list, i) => (
              <motion.div key={list.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer group" onClick={() => openList(list)}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <Users className="size-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate">{list.name}</CardTitle>
                        <CardDescription>
                          {list._count?.contacts || 0} contatos &bull; {new Date(list.createdAt).toLocaleDateString('pt-BR')}
                        </CardDescription>
                      </div>
                      <CardAction className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <ChevronRight className="size-5 text-muted-foreground" />
                      </CardAction>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1">
                        {list._count?.campaigns ? (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Radio className="size-3" /> {list._count.campaigns} campanha(s)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Sem campanhas</Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-500 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); setDeleteListConfirm(list.id) }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteListConfirm}
        onOpenChange={() => setDeleteListConfirm(null)}
        title="Remover Lista de Contatos"
        description="Tem certeza que deseja remover esta lista? Os contatos não vinculados a chips serão excluídos."
        onConfirm={() => { if (deleteListConfirm) deleteList(deleteListConfirm) }}
        confirmLabel="Remover"
        variant="destructive"
      />
    </div>
  )
}

// ===== WireGuard Tab =====
function WireGuardTab() {
  const [serverConfig, setServerConfig] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const fetchServerConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/wireguard/server-config')
      const data = await res.json()
      setServerConfig(data.config)
    } catch {
      toast.error('Erro ao carregar configuração do servidor')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchServerConfig() }, [fetchServerConfig])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiado para a área de transferência!')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">WireGuard</h2>
          <p className="text-sm text-muted-foreground">Configuração do servidor VPN</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => { setLoading(true); fetchServerConfig() }}>
          <RefreshCw className="size-4" /> Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Shield className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <CardTitle>Configuração do Servidor</CardTitle>
              <CardDescription>Cole este conteúdo em /etc/wireguard/wg0.conf no seu VPS</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => copyToClipboard(serverConfig)}>
                <Copy className="size-3.5" /> Copiar
              </Button>
            </CardAction>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8"><RefreshCw className="size-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <pre className="rounded-lg bg-muted p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
              {serverConfig}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instruções de Configuração</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <h4 className="font-semibold">1. No VPS (Servidor)</h4>
              <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
{`apt install wireguard
nano /etc/wireguard/wg0.conf
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p
wg-quick up wg0
systemctl enable wg-quick@wg0`}
              </pre>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">2. No Celular (Cliente)</h4>
              <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
{`# Instale o app WireGuard (Play Store / App Store)
# Para cada chip, use a config gerada na aba Chips
# Ative o túnel`}
              </pre>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">3. Configure o Proxy SOCKS5</h4>
              <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
{`# No celular, instale o Every Proxy (Play Store)
# Vá na aba SOCKS5 e ligue o switch
# O tráfego será roteado via WireGuard`}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ===== Messages Tab =====
function MessagesTab() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const fetchMessages = useCallback(async (status?: string) => {
    try {
      const params = new URLSearchParams()
      if (status && status !== 'all') params.set('status', status)
      const res = await fetch(`/api/messages?${params.toString()}`)
      const data = await res.json()
      setMessages(data)
    } catch {
      toast.error('Erro ao carregar mensagens')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const handleFilterChange = (status: string) => {
    setFilterStatus(status)
    setLoading(true)
    fetchMessages(status === 'all' ? undefined : status)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Mensagens</h2>
          <p className="text-sm text-muted-foreground">Histórico de mensagens enviadas</p>
        </div>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="sent">Enviada</SelectItem>
              <SelectItem value="delivered">Entregue</SelectItem>
              <SelectItem value="read">Lida</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => { setLoading(true); fetchMessages(filterStatus === 'all' ? undefined : filterStatus) }}>
            <RefreshCw className="size-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <MessageSquare className="size-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold">Nenhuma mensagem encontrada</p>
            <p className="text-sm text-muted-foreground mt-1">As mensagens aparecerão aqui quando as campanhas forem executadas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div key={msg.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                <Card className="py-3">
                  <CardContent className="py-0">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30 shrink-0 mt-0.5">
                        <MessageSquare className="size-4 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{msg.contact.name}</span>
                          <span className="text-xs text-muted-foreground">{msg.contact.phone}</span>
                          <Badge variant="outline" className="text-xs gap-1">
                            <Smartphone className="size-2.5" /> {msg.chip.name}
                          </Badge>
                          <div className="ml-auto"><StatusBadge status={msg.status} /></div>
                        </div>
                        <p className="text-sm mt-1 truncate">{msg.content}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{new Date(msg.createdAt).toLocaleString('pt-BR')}</span>
                          {msg.sentAt && <span>Enviada: {new Date(msg.sentAt).toLocaleString('pt-BR')}</span>}
                          {msg.error && <span className="text-rose-500">{msg.error}</span>}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ===== Main Page =====
export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activeTab, setActiveTab] = useState('dashboard')

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await fetch('/api/stats')
        const data = await res.json()
        setStats(data)
      } catch { /* empty */ }
    }
    loadStats()
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-purple-50/30 dark:from-slate-950 dark:to-purple-950/20">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative size-8">
              <img src="/logo.png" alt="OctupusZap Logo" className="size-8 rounded-lg object-cover" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none">OctupusZap</h1>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">WhatsApp Mass Messaging</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 hidden sm:flex text-xs">
              <Zap className="size-3" /> v1.0
            </Badge>
            <Button variant="ghost" size="icon" className="size-8" onClick={async () => {
              try {
                const res = await fetch('/api/stats')
                const data = await res.json()
                setStats(data)
                toast.success('Dados atualizados!')
              } catch { /* empty */ }
            }}>
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 w-full sm:w-auto flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="dashboard" className="gap-1.5">
              <BarChart3 className="size-4" /> <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="chips" className="gap-1.5">
              <Smartphone className="size-4" /> <span className="hidden sm:inline">Chips</span>
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5">
              <Radio className="size-4" /> <span className="hidden sm:inline">Campanhas</span>
            </TabsTrigger>
            <TabsTrigger value="contacts" className="gap-1.5">
              <Users className="size-4" /> <span className="hidden sm:inline">Contatos</span>
            </TabsTrigger>
            <TabsTrigger value="wireguard" className="gap-1.5">
              <Shield className="size-4" /> <span className="hidden sm:inline">WireGuard</span>
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5">
              <MessageSquare className="size-4" /> <span className="hidden sm:inline">Mensagens</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardTab stats={stats} />
          </TabsContent>
          <TabsContent value="chips">
            <ChipsTab />
          </TabsContent>
          <TabsContent value="campaigns">
            <CampaignsTab />
          </TabsContent>
          <TabsContent value="contacts">
            <ContactsTab />
          </TabsContent>
          <TabsContent value="wireguard">
            <WireGuardTab />
          </TabsContent>
          <TabsContent value="messages">
            <MessagesTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white/50 dark:bg-slate-950/50 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>OctupusZap &copy; {new Date().getFullYear()}</span>
          <span>Powered by WireGuard VPN</span>
        </div>
      </footer>
    </div>
  )
}
