'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, Send, Shield, BarChart3, Plus, Trash2,
  Copy, RefreshCw, Check, X, Clock, Zap, Users, MessageSquare,
  Activity, AlertCircle, FileText, Settings, Eye,
  Pause, Play, Upload, Search, ArrowLeft, CalendarDays,
  Phone, UserPlus, FileSpreadsheet, ChevronRight, Menu,
  TrendingUp, TrendingDown, ShieldCheck, ShieldAlert, Timer,
  MessageCircle, Type, Shuffle, Flame, Snowflake, EyeOff,
  Download, Filter, ArrowRight, QrCode, Globe, Lock,
  Sparkles, Heart, Star, AlertTriangle, Info, ChevronDown,
  Pencil, LayoutList
} from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  dailyLimit: number
  sentToday: number
  lastResetAt: string
  warmingEnabled: boolean
  warmingStage: number
  isQrPaired: boolean
  qrPairingCode: string | null
  proxyMode: string
  socks5Host: string
  socks5Port: number
  socks5User: string
  socks5Pass: string
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
  antiBanEnabled: boolean
  warmingMode: string
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

interface MessageItem {
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
  disconnectedChips: number
  errorChips: number
  totalCampaigns: number
  activeCampaigns: number
  totalMessages: number
  sentMessages: number
  deliveredMessages: number
  readMessages: number
  failedMessages: number
  pendingMessages: number
  deliveryRate: number
  totalContacts: number
  totalSent: number
  recentMessages: MessageItem[]
  runningCampaigns: Campaign[]
  chipStatuses: { id: string; name: string; phoneNumber: string; status: string; sentToday: number; dailyLimit: number }[]
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
  cooldownAfterMessages: number
  stopOnWarning: boolean
}

interface MessageTemplate {
  id: string
  name: string
  content: string
  category: string
  createdAt: string
  updatedAt: string
}

// ===== Navigation Items =====
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'chips', label: 'Chips', icon: Smartphone },
  { id: 'contatos', label: 'Contatos', icon: Users },
  { id: 'campanhas', label: 'Campanhas', icon: Send },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'antiban', label: 'Anti-Ban', icon: Shield },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquare },
  { id: 'config', label: 'Configurações', icon: Settings },
]

// ===== Status Helpers =====
function statusColor(status: string) {
  const map: Record<string, string> = {
    connected: 'bg-emerald-500', connecting: 'bg-amber-500', disconnected: 'bg-zinc-400', error: 'bg-rose-500',
    running: 'bg-emerald-500', draft: 'bg-zinc-400', scheduled: 'bg-amber-500', paused: 'bg-amber-500', completed: 'bg-sky-500',
    pending: 'bg-zinc-400', sent: 'bg-sky-500', delivered: 'bg-emerald-500', read: 'bg-teal-500', failed: 'bg-rose-500',
  }
  return map[status] || 'bg-zinc-400'
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    connected: 'Conectado', connecting: 'Conectando', disconnected: 'Desconectado', error: 'Erro',
    running: 'Executando', draft: 'Rascunho', scheduled: 'Agendada', paused: 'Pausada', completed: 'Concluída',
    pending: 'Pendente', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falhou',
  }
  return map[status] || status
}

function StatusBadge({ status }: { status: string }) {
  const isDestructive = ['error', 'failed'].includes(status)
  const isDefault = ['connected', 'running', 'delivered', 'read', 'completed'].includes(status)
  return (
    <Badge variant={isDestructive ? 'destructive' : isDefault ? 'default' : 'secondary'} className="gap-1">
      <span className={`size-1.5 rounded-full ${statusColor(status)}`} />
      {statusLabel(status)}
    </Badge>
  )
}

// ===== Confirm Dialog =====
function ConfirmDialog({
  open, onOpenChange, title, description, onConfirm, confirmLabel = 'Confirmar', variant = 'destructive',
}: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string
  onConfirm: () => void; confirmLabel?: string; variant?: 'destructive' | 'default'
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
          <AlertDialogAction onClick={() => { onConfirm(); onOpenChange(false) }}
            className={variant === 'destructive' ? 'bg-rose-600 hover:bg-rose-700' : ''}>
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
    totalChips: stats.totalChips ?? 0, connectedChips: stats.connectedChips ?? 0,
    totalCampaigns: stats.totalCampaigns ?? 0, activeCampaigns: stats.activeCampaigns ?? 0,
    totalMessages: stats.totalMessages ?? 0, sentMessages: stats.sentMessages ?? 0,
    deliveredMessages: stats.deliveredMessages ?? 0, failedMessages: stats.failedMessages ?? 0,
    deliveryRate: stats.deliveryRate ?? 0, totalContacts: stats.totalContacts ?? 0,
    pendingMessages: stats.pendingMessages ?? 0, readMessages: stats.readMessages ?? 0,
  }

  const statCards = [
    { title: 'Chips', value: s.totalChips, sub: `${s.connectedChips} conectados`, icon: Smartphone, gradient: 'from-violet-500 to-purple-600', trend: '+2', trendUp: true },
    { title: 'Campanhas', value: s.totalCampaigns, sub: `${s.activeCampaigns} ativas`, icon: Send, gradient: 'from-emerald-500 to-teal-600', trend: '+5', trendUp: true },
    { title: 'Mensagens', value: s.totalMessages, sub: `${s.sentMessages} enviadas`, icon: MessageSquare, gradient: 'from-amber-500 to-orange-600', trend: '+12%', trendUp: true },
    { title: 'Taxa de Entrega', value: `${s.deliveryRate}%`, sub: `${s.failedMessages} falharam`, icon: Activity, gradient: 'from-rose-500 to-pink-600', trend: s.deliveryRate > 80 ? '+3%' : '-2%', trendUp: s.deliveryRate > 80 },
  ]

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="relative overflow-hidden border-0 shadow-lg">
              <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-10`} />
              <CardHeader className="relative pb-2">
                <CardDescription className="text-sm font-medium">{card.title}</CardDescription>
                <CardTitle className="text-3xl font-bold">{card.value}</CardTitle>
                <CardAction>
                  <div className={`flex size-10 items-center justify-center rounded-xl bg-gradient-to-br ${card.gradient} shadow-lg`}>
                    <card.icon className="size-5 text-white" />
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="relative">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{card.sub}</p>
                  <div className={`flex items-center gap-1 text-xs font-semibold ${card.trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {card.trendUp ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {card.trend}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Clock className="size-4 text-amber-600" />
              </div>
              <CardTitle className="text-lg">Atividade Recente</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {stats.recentMessages && stats.recentMessages.length > 0 ? (
              <ScrollArea className="h-72">
                <div className="space-y-3">
                  {stats.recentMessages.map((msg) => (
                    <div key={msg.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className={`size-2 rounded-full ${statusColor(msg.status)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{msg.contact?.name || msg.contactId}</p>
                        <p className="text-xs text-muted-foreground truncate">{msg.content.substring(0, 50)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">{msg.chip?.name || '—'}</p>
                        <p className="text-xs text-muted-foreground">{msg.createdAt ? new Date(msg.createdAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Activity className="size-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma atividade recente</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chip Statuses */}
        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Smartphone className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-lg">Status dos Chips</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {stats.chipStatuses && stats.chipStatuses.length > 0 ? (
              <div className="space-y-3">
                {stats.chipStatuses.map((chip) => (
                  <div key={chip.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className={`size-3 rounded-full ${statusColor(chip.status)} ring-2 ring-offset-2 ring-offset-background ${chip.status === 'connected' ? 'ring-emerald-500/30' : chip.status === 'error' ? 'ring-rose-500/30' : 'ring-zinc-500/30'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{chip.name}</p>
                      <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{chip.sentToday}/{chip.dailyLimit}</p>
                      <p className="text-xs text-muted-foreground">hoje</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Smartphone className="size-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhum chip cadastrado</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Campaigns */}
      {stats.runningCampaigns && stats.runningCampaigns.length > 0 && (
        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <Send className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">Campanhas Ativas</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.runningCampaigns.map((c) => (
                <div key={c.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.chips?.length || 0} chips • {c.sequenceSteps?.length || 0} etapas</p>
                  </div>
                  <Progress value={65} className="w-32 h-2" />
                  <Badge variant="default" className="bg-emerald-600">Executando</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ===== Chips Tab =====
function ChipsTab() {
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false)
  const [selectedChip, setSelectedChip] = useState<Chip | null>(null)
  const [selectedChipConfig, setSelectedChipConfig] = useState<{ config: string; chip: Partial<Chip> } | null>(null)
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [newChip, setNewChip] = useState({ name: '', phoneNumber: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [proxyForm, setProxyForm] = useState({ socks5Host: '', socks5Port: 1080, socks5User: '', socks5Pass: '' })

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setChips(data)
    } catch { toast.error('Erro ao carregar chips') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchChips() }, [fetchChips])

  useEffect(() => {
    if (selectedChipConfig?.config) {
      QRCode.toDataURL(selectedChipConfig.config, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        .then(url => setQrCodeUrl(url)).catch(() => setQrCodeUrl(''))
    } else { setQrCodeUrl('') }
  }, [selectedChipConfig?.config])

  const createChip = async () => {
    try {
      const res = await fetch('/api/chips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newChip) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
      toast.success('Chip criado com sucesso!')
      setAddDialogOpen(false)
      setNewChip({ name: '', phoneNumber: '' })
      fetchChips()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao criar chip') }
  }

  const deleteChip = async (id: string) => {
    try { await fetch(`/api/chips/${id}`, { method: 'DELETE' }); toast.success('Chip removido!'); fetchChips() }
    catch { toast.error('Erro ao remover chip') }
  }

  const updateChip = async (id: string, data: Record<string, unknown>) => {
    try { await fetch(`/api/chips/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); toast.success('Chip atualizado!'); fetchChips() }
    catch { toast.error('Erro ao atualizar chip') }
  }

  const fetchConfig = async (chipId: string) => {
    try {
      const res = await fetch(`/api/wireguard/${chipId}`)
      const data = await res.json()
      setSelectedChipConfig(data)
      setConfigDialogOpen(true)
    } catch { toast.error('Erro ao buscar configuração') }
  }

  const openQrDialog = (chip: Chip) => {
    setSelectedChip(chip)
    setQrDialogOpen(true)
  }

  const openProxyDialog = (chip: Chip) => {
    setSelectedChip(chip)
    setProxyForm({ socks5Host: chip.socks5Host, socks5Port: chip.socks5Port, socks5User: chip.socks5User, socks5Pass: chip.socks5Pass })
    setProxyDialogOpen(true)
  }

  const saveProxy = async () => {
    if (!selectedChip) return
    await updateChip(selectedChip.id, { ...proxyForm, proxyMode: 'socks5' })
    setProxyDialogOpen(false)
  }

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); toast.success('Copiado!'); setTimeout(() => setCopied(false), 2000) }
    catch { toast.error('Erro ao copiar') }
  }

  const connected = chips.filter(c => c.status === 'connected').length
  const disconnected = chips.filter(c => c.status === 'disconnected').length
  const errorCount = chips.filter(c => c.status === 'error').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Chips</h2>
          <p className="text-sm text-muted-foreground">Gerencie os números WhatsApp conectados</p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
              <Plus className="size-4" /> Novo Chip
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Chip</DialogTitle>
              <DialogDescription>Cadastre um novo número WhatsApp para envio</DialogDescription>
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

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: chips.length, icon: Smartphone, color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30' },
          { label: 'Conectados', value: connected, icon: Check, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Desconectados', value: disconnected, icon: X, color: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-900/30' },
          { label: 'Erro', value: errorCount, icon: AlertCircle, color: 'text-rose-600 bg-rose-100 dark:bg-rose-900/30' },
        ].map(s => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${s.color}`}>
                <s.icon className="size-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chip Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : chips.length === 0 ? (
        <Card className="shadow-md border-0">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30 mb-4">
              <Smartphone className="size-8 text-violet-500" />
            </div>
            <p className="text-lg font-semibold">Nenhum chip cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1">Adicione um chip para começar a enviar mensagens</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {chips.map((chip, i) => (
              <motion.div key={chip.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="shadow-md hover:shadow-lg transition-all border-0 relative overflow-hidden">
                  <div className={`absolute top-0 left-0 right-0 h-1 ${chip.status === 'connected' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : chip.status === 'error' ? 'bg-gradient-to-r from-rose-400 to-pink-500' : chip.status === 'connecting' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-zinc-300'}`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
                        <Smartphone className="size-5 text-violet-600 dark:text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate text-base">{chip.name}</CardTitle>
                        <CardDescription className="truncate">{chip.phoneNumber}</CardDescription>
                      </div>
                      <StatusBadge status={chip.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Modo de Conexão</span>
                        <Badge variant="outline" className="gap-1 text-xs">
                          {chip.proxyMode === 'socks5' ? <><Globe className="size-3" /> SOCKS5</> :
                           chip.proxyMode === 'wireguard' ? <><Lock className="size-3" /> WireGuard</> :
                           <><QrCode className="size-3" /> QR Code</>}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Envio hoje</span>
                        <span className="font-semibold">{chip.sentToday}/{chip.dailyLimit}</span>
                      </div>
                      <Progress value={(chip.sentToday / chip.dailyLimit) * 100} className="h-2" />
                      {chip.warmingEnabled && (
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Aquecimento</span>
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Flame className="size-3" /> Estágio {chip.warmingStage}/4
                          </Badge>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Último visto</span>
                        <span className="text-xs">{chip.lastSeen ? new Date(chip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</span>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openQrDialog(chip)}>
                        <QrCode className="size-3.5" /> QR Code
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openProxyDialog(chip)}>
                        <Globe className="size-3.5" /> Proxy
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => fetchConfig(chip.id)}>
                        <Lock className="size-3.5" /> WireGuard
                      </Button>
                      <Button variant="outline" size="sm" className="text-rose-500 hover:text-rose-600 gap-1.5 text-xs" onClick={() => setDeleteConfirm(chip.id)}>
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

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Chip" description="Tem certeza que deseja remover este chip? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) deleteChip(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-5 text-emerald-500" /> Conexão QR Code — {selectedChip?.name}
            </DialogTitle>
            <DialogDescription>Escaneie o QR Code para conectar o WhatsApp Web</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-2xl shadow-xl">
              <div className="w-56 h-56 bg-gradient-to-br from-zinc-100 to-zinc-200 rounded-xl flex items-center justify-center">
                <QrCode className="size-24 text-zinc-400" />
              </div>
            </div>
            <Badge variant="outline" className="gap-1.5 py-1.5">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              Aguardando scan...
            </Badge>
            <div className="w-full p-4 bg-muted/50 rounded-xl space-y-2 text-sm">
              <p className="font-semibold">Como conectar:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                <li>Abra o WhatsApp no celular</li>
                <li>Toque em Menu → Aparelhos conectados</li>
                <li>Escaneie o QR Code acima</li>
              </ol>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => toast.info('QR Code atualizado!')}>
              <RefreshCw className="size-4" /> Atualizar QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Proxy Config Dialog */}
      <Dialog open={proxyDialogOpen} onOpenChange={setProxyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="size-5 text-emerald-500" /> Configurar Proxy SOCKS5
            </DialogTitle>
            <DialogDescription>Configure o proxy SOCKS5 para rotacionar IPs</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Host</Label>
              <Input placeholder="Ex: 192.168.1.100" value={proxyForm.socks5Host} onChange={e => setProxyForm(p => ({ ...p, socks5Host: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Porta</Label>
              <Input type="number" placeholder="1080" value={proxyForm.socks5Port} onChange={e => setProxyForm(p => ({ ...p, socks5Port: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Usuário</Label>
                <Input placeholder="Opcional" value={proxyForm.socks5User} onChange={e => setProxyForm(p => ({ ...p, socks5User: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" placeholder="Opcional" value={proxyForm.socks5Pass} onChange={e => setProxyForm(p => ({ ...p, socks5Pass: e.target.value }))} />
              </div>
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <Info className="size-4 shrink-0 mt-0.5" />
                Modo Avançado: Use proxy SOCKS5 para rotacionar IPs com múltiplos chips e evitar bloqueios.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveProxy} className="bg-emerald-600 hover:bg-emerald-700">Salvar Proxy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WireGuard Config Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={(open) => {
        setConfigDialogOpen(open)
        if (!open) { setSelectedChipConfig(null); setQrCodeUrl(''); setCopied(false) }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="size-5 text-emerald-500" /> Configuração WireGuard — {selectedChipConfig?.chip.name}
            </DialogTitle>
            <DialogDescription>Use as abas para visualizar o QR Code, copiar a config ou seguir o tutorial.</DialogDescription>
          </DialogHeader>
          {selectedChipConfig && (
            <Tabs defaultValue="qrcode" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="qrcode" className="flex-1 gap-1.5"><QrCode className="size-3.5" /> QR Code</TabsTrigger>
                <TabsTrigger value="config" className="flex-1 gap-1.5"><FileText className="size-3.5" /> Configuração</TabsTrigger>
                <TabsTrigger value="tutorial" className="flex-1 gap-1.5"><Info className="size-3.5" /> Passo a Passo</TabsTrigger>
              </TabsList>
              <TabsContent value="qrcode" className="mt-4">
                <div className="flex flex-col items-center gap-4">
                  {qrCodeUrl ? (
                    <div className="bg-white p-4 rounded-xl shadow-lg"><img src={qrCodeUrl} alt="QR Code WireGuard" className="w-64 h-64" /></div>
                  ) : (
                    <div className="w-64 h-64 bg-muted rounded-xl flex items-center justify-center"><RefreshCw className="size-8 animate-spin text-muted-foreground" /></div>
                  )}
                  <p className="text-sm text-muted-foreground">Escaneie com o app WireGuard no celular</p>
                </div>
              </TabsContent>
              <TabsContent value="config" className="mt-4">
                <div className="space-y-4">
                  <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700">
                    {selectedChipConfig.config}
                  </pre>
                  <Button onClick={() => copyToClipboard(selectedChipConfig.config)} variant="outline" className="w-full">
                    {copied ? <><Check className="size-4 mr-2 text-emerald-500" /> Copiado!</> : <><Copy className="size-4 mr-2" /> Copiar Config</>}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="tutorial" className="mt-4">
                <div className="space-y-4 text-sm">
                  {[
                    { step: 1, title: 'No Servidor (VPS)', items: ['Instale o WireGuard: apt install wireguard', 'Copie a config do servidor', 'Ative: wg-quick up wg0'] },
                    { step: 2, title: 'No Celular — WireGuard', items: ['Instale o app WireGuard', 'Toque em "+" → Escanear QR Code', 'Ative o túnel'] },
                    { step: 3, title: 'No Celular — Every Proxy', items: ['Instale o app Every Proxy', 'Vá na aba SOCKS5', 'Ligue o switch — pronto!'] },
                  ].map(s => (
                    <div key={s.step} className="space-y-2">
                      <h4 className="font-semibold flex items-center gap-2">
                        <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold">{s.step}</span>
                        {s.title}
                      </h4>
                      <div className="ml-8 space-y-1 text-muted-foreground text-xs">
                        {s.items.map((item, idx) => <p key={idx}>• {item}</p>)}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Contatos Tab =====
function ContatosTab() {
  const [contactLists, setContactLists] = useState<ContactList[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedList, setSelectedList] = useState<ContactList | null>(null)
  const [addListDialog, setAddListDialog] = useState(false)
  const [addContactDialog, setAddContactDialog] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newContact, setNewContact] = useState({ name: '', phone: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/contact-lists')
      const data = await res.json()
      setContactLists(data)
    } catch { toast.error('Erro ao carregar listas') }
    finally { setLoading(false) }
  }, [])

  const fetchContacts = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/contact-lists/${listId}/contacts${searchQuery ? `?search=${searchQuery}` : ''}`)
      const data = await res.json()
      setContacts(data)
    } catch { toast.error('Erro ao carregar contatos') }
  }, [searchQuery])

  useEffect(() => { fetchLists() }, [fetchLists])
  useEffect(() => { if (selectedList) fetchContacts(selectedList.id) }, [selectedList, fetchContacts])

  const createList = async () => {
    try {
      const res = await fetch('/api/contact-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newListName }) })
      if (!res.ok) throw new Error()
      toast.success('Lista criada!')
      setAddListDialog(false)
      setNewListName('')
      fetchLists()
    } catch { toast.error('Erro ao criar lista') }
  }

  const deleteList = async (id: string) => {
    try { await fetch(`/api/contact-lists/${id}`, { method: 'DELETE' }); toast.success('Lista removida!'); setSelectedList(null); fetchLists() }
    catch { toast.error('Erro ao remover lista') }
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
      setAddContactDialog(false)
      setNewContact({ name: '', phone: '' })
      fetchContacts(selectedList.id)
    } catch { toast.error('Erro ao adicionar contato') }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedList || !e.target.files?.[0]) return
    const formData = new FormData()
    formData.append('file', e.target.files[0])
    try {
      const res = await fetch(`/api/contact-lists/${selectedList.id}/import`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error()
      toast.success('Contatos importados!')
      setImportDialogOpen(false)
      fetchContacts(selectedList.id)
      fetchLists()
    } catch { toast.error('Erro ao importar contatos') }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Contatos</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas listas e contatos</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={addListDialog} onOpenChange={setAddListDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
                <Plus className="size-4" /> Nova Lista
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Criar Lista de Contatos</DialogTitle><DialogDescription>Dê um nome para sua nova lista</DialogDescription></DialogHeader>
              <div className="py-4">
                <Label>Nome da Lista</Label>
                <Input placeholder="Ex: Leads Black Friday" value={newListName} onChange={e => setNewListName(e.target.value)} className="mt-2" />
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={createList} disabled={!newListName} className="bg-emerald-600 hover:bg-emerald-700">Criar Lista</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : selectedList ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedList(null)} className="gap-1.5">
              <ArrowLeft className="size-4" /> Voltar
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <h3 className="text-lg font-semibold">{selectedList.name}</h3>
            <Badge variant="secondary">{contacts.length} contatos</Badge>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar contatos..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <Button variant="outline" className="gap-1.5" onClick={() => setAddContactDialog(true)}>
              <UserPlus className="size-4" /> Adicionar
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setImportDialogOpen(true)}>
              <Upload className="size-4" /> Importar CSV
            </Button>
          </div>

          {contacts.length === 0 ? (
            <Card className="shadow-md border-0">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="size-10 text-muted-foreground mb-3" />
                <p className="font-semibold">Nenhum contato nesta lista</p>
                <p className="text-sm text-muted-foreground">Importe um CSV ou adicione manualmente</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-md border-0">
              <CardContent className="p-0">
                <ScrollArea className="max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-3 font-medium">Nome</th>
                        <th className="text-left p-3 font-medium">Telefone</th>
                        <th className="text-left p-3 font-medium">Criado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map(c => (
                        <tr key={c.id} className="border-t hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium">{c.name}</td>
                          <td className="p-3 text-muted-foreground">{c.phone}</td>
                          <td className="p-3 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contactLists.map((list, i) => (
            <motion.div key={list.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="shadow-md hover:shadow-lg transition-all cursor-pointer border-0" onClick={() => { setSelectedList(list); fetchContacts(list.id) }}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
                      <LayoutList className="size-5 text-sky-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate text-base">{list.name}</CardTitle>
                      <CardDescription>{list._count?.contacts || 0} contatos</CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(list.id) }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
          {contactLists.length === 0 && (
            <Card className="shadow-md border-0 col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Users className="size-10 text-muted-foreground mb-3" />
                <p className="font-semibold">Nenhuma lista criada</p>
                <p className="text-sm text-muted-foreground">Crie uma lista para organizar seus contatos</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Lista" description="Tem certeza? Todos os contatos serão removidos."
        onConfirm={() => { if (deleteConfirm) deleteList(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      {/* Add Contact Dialog */}
      <Dialog open={addContactDialog} onOpenChange={setAddContactDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar Contato</DialogTitle><DialogDescription>Adicione um contato manualmente</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Nome</Label><Input placeholder="Ex: João Silva" value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input placeholder="Ex: 11999990001" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={addContact} disabled={!newContact.name || !newContact.phone} className="bg-emerald-600 hover:bg-emerald-700">Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importar CSV</DialogTitle><DialogDescription>Importe contatos de um arquivo CSV</DialogDescription></DialogHeader>
          <div className="py-4 space-y-4">
            <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-emerald-400 transition-colors">
              <Upload className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">Arraste o arquivo CSV aqui</p>
              <p className="text-sm text-muted-foreground mb-3">ou clique para selecionar</p>
              <Input type="file" accept=".csv" onChange={handleImport} className="max-w-xs mx-auto" />
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
              <p className="font-medium mb-1">Formato esperado:</p>
              <code className="block bg-muted p-2 rounded">nome,telefone{'\n'}João,11999990001{'\n'}Maria,21988880002</code>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Campanhas Tab =====
function CampanhasTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([])
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [availableLists, setAvailableLists] = useState<ContactList[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const [newCampaign, setNewCampaign] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    useSequence: false, sequenceSteps: [{ content: '', delayMinutes: 0 }],
    messageVariations: [''], antiBanEnabled: true, warmingMode: 'normal',
  })

  const resetNewCampaign = () => setNewCampaign({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [], contactListId: '', scheduledAt: '',
    useSequence: false, sequenceSteps: [{ content: '', delayMinutes: 0 }],
    messageVariations: [''], antiBanEnabled: true, warmingMode: 'normal',
  })

  const fetchCampaigns = useCallback(async () => {
    try { const res = await fetch('/api/campaigns'); setCampaigns(await res.json()) }
    catch { toast.error('Erro ao carregar campanhas') } finally { setLoading(false) }
  }, [])
  const fetchChips = useCallback(async () => {
    try { const res = await fetch('/api/chips'); setAvailableChips(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchLists = useCallback(async () => {
    try { const res = await fetch('/api/contact-lists'); setAvailableLists(await res.json()) } catch { /* empty */ }
  }, [])

  useEffect(() => { fetchCampaigns(); fetchChips(); fetchLists() }, [fetchCampaigns, fetchChips, fetchLists])

  const createCampaign = async () => {
    const steps = newCampaign.useSequence
      ? newCampaign.sequenceSteps.map((s, i) => ({ stepOrder: i + 1, content: s.content, delayMinutes: s.delayMinutes }))
      : []
    const payload = {
      name: newCampaign.name, sendIntervalMin: newCampaign.sendIntervalMin, sendIntervalMax: newCampaign.sendIntervalMax,
      chipIds: newCampaign.chipIds, contactListId: newCampaign.contactListId || null,
      scheduledAt: newCampaign.scheduledAt ? new Date(newCampaign.scheduledAt).toISOString() : null,
      steps, antiBanEnabled: newCampaign.antiBanEnabled, warmingMode: newCampaign.warmingMode,
    }
    try {
      const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
      toast.success('Campanha criada com sucesso!')
      setCreateDialogOpen(false); resetNewCampaign(); fetchCampaigns()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao criar campanha') }
  }

  const updateCampaignStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      toast.success('Status atualizado!'); fetchCampaigns()
    } catch { toast.error('Erro ao atualizar status') }
  }

  const deleteCampaign = async (id: string) => {
    try { await fetch(`/api/campaigns/${id}`, { method: 'DELETE' }); toast.success('Campanha removida!'); fetchCampaigns() }
    catch { toast.error('Erro ao remover campanha') }
  }

  const openDetail = async (campaign: Campaign) => {
    setSelectedCampaign(campaign); setDetailDialogOpen(true)
    try { const res = await fetch(`/api/messages?campaignId=${campaign.id}`); setDetailMessages(await res.json()) }
    catch { setDetailMessages([]) }
  }

  const toggleChip = (chipId: string) => {
    setNewCampaign(prev => ({
      ...prev,
      chipIds: prev.chipIds.includes(chipId) ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId],
    }))
  }

  const addSequenceStep = () => setNewCampaign(prev => ({ ...prev, sequenceSteps: [...prev.sequenceSteps, { content: '', delayMinutes: 60 }] }))
  const removeSequenceStep = (idx: number) => setNewCampaign(prev => ({ ...prev, sequenceSteps: prev.sequenceSteps.filter((_, i) => i !== idx) }))
  const updateSequenceStep = (idx: number, field: 'content' | 'delayMinutes', value: string | number) => {
    setNewCampaign(prev => { const steps = [...prev.sequenceSteps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, sequenceSteps: steps } })
  }

  const canCreate = newCampaign.name.trim() && newCampaign.chipIds.length > 0 && (
    newCampaign.useSequence ? newCampaign.sequenceSteps.some(s => s.content.trim()) : newCampaign.messageVariations.some(v => v.trim())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas campanhas de envio em massa</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) resetNewCampaign() }}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
              <Plus className="size-4" /> Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Criar Campanha</DialogTitle>
              <DialogDescription>Configure uma nova campanha de envio</DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label>Nome da Campanha</Label>
                <Input placeholder="Ex: Campanha Black Friday" value={newCampaign.name} onChange={e => setNewCampaign(prev => ({ ...prev, name: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <Label>Lista de Contatos</Label>
                <Select value={newCampaign.contactListId} onValueChange={v => setNewCampaign(prev => ({ ...prev, contactListId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione uma lista de contatos" /></SelectTrigger>
                  <SelectContent>
                    {availableLists.map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        <div className="flex items-center gap-2"><Users className="size-3.5" />{l.name}<span className="text-xs text-muted-foreground">({l._count?.contacts || 0})</span></div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /> Agendamento (opcional)</Label>
                <Input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(prev => ({ ...prev, scheduledAt: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Deixe vazio para executar imediatamente</p>
              </div>

              <div className="space-y-2">
                <Label>Chips para envio</Label>
                <div className="grid grid-cols-2 gap-2">
                  {availableChips.map(chip => (
                    <label key={chip.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${newCampaign.chipIds.includes(chip.id) ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                      <input type="checkbox" checked={newCampaign.chipIds.includes(chip.id)} onChange={() => toggleChip(chip.id)} className="sr-only" />
                      <div className={`size-4 rounded border-2 flex items-center justify-center ${newCampaign.chipIds.includes(chip.id) ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground'}`}>
                        {newCampaign.chipIds.includes(chip.id) && <Check className="size-3 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{chip.name}</p>
                        <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label>Tipo de Mensagem</Label>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${!newCampaign.useSequence ? 'font-semibold' : 'text-muted-foreground'}`}>Variações</span>
                  <Switch checked={newCampaign.useSequence} onCheckedChange={v => setNewCampaign(prev => ({ ...prev, useSequence: v }))} />
                  <span className={`text-sm ${newCampaign.useSequence ? 'font-semibold' : 'text-muted-foreground'}`}>Sequência</span>
                </div>
              </div>

              {newCampaign.useSequence ? (
                <div className="space-y-3">
                  {newCampaign.sequenceSteps.map((step, idx) => (
                    <div key={idx} className="relative">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="flex items-center justify-center size-7 rounded-full bg-emerald-600 text-white text-xs font-bold">{idx + 1}</span>
                        <span className="text-sm font-medium">Etapa {idx + 1}</span>
                        {idx > 0 && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
                            <Clock className="size-3" /> {step.delayMinutes}min após etapa anterior
                          </div>
                        )}
                        {newCampaign.sequenceSteps.length > 1 && (
                          <Button variant="ghost" size="sm" className="ml-auto text-rose-500 h-6 w-6 p-0" onClick={() => removeSequenceStep(idx)}>
                            <X className="size-3" />
                          </Button>
                        )}
                      </div>
                      <Textarea placeholder="Mensagem da etapa..." value={step.content} onChange={e => updateSequenceStep(idx, 'content', e.target.value)} rows={2} />
                      {idx > 0 && (
                        <div className="mt-2">
                          <Label className="text-xs">Atraso antes desta etapa (minutos)</Label>
                          <Input type="number" min={0} value={step.delayMinutes} onChange={e => updateSequenceStep(idx, 'delayMinutes', parseInt(e.target.value) || 0)} className="mt-1 w-40" />
                        </div>
                      )}
                      {idx < newCampaign.sequenceSteps.length - 1 && (
                        <div className="flex items-center justify-center py-2"><ArrowRight className="size-4 text-muted-foreground" /></div>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addSequenceStep} className="gap-1.5 w-full">
                    <Plus className="size-3.5" /> Adicionar Etapa
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {newCampaign.messageVariations.map((v, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Textarea placeholder={`Variação ${idx + 1}...`} value={v} onChange={e => {
                        const vars = [...newCampaign.messageVariations]; vars[idx] = e.target.value
                        setNewCampaign(prev => ({ ...prev, messageVariations: vars }))
                      }} rows={2} className="flex-1" />
                      {newCampaign.messageVariations.length > 1 && (
                        <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => setNewCampaign(prev => ({ ...prev, messageVariations: prev.messageVariations.filter((_, i) => i !== idx) }))}>
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setNewCampaign(prev => ({ ...prev, messageVariations: [...prev.messageVariations, ''] }))} className="gap-1.5 w-full">
                    <Plus className="size-3.5" /> Adicionar Variação
                  </Button>
                </div>
              )}

              {/* Anti-Ban Section in Campaign */}
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="size-5 text-emerald-500" />
                    <Label className="text-base font-semibold">Proteção Anti-Ban</Label>
                  </div>
                  <Switch checked={newCampaign.antiBanEnabled} onCheckedChange={v => setNewCampaign(prev => ({ ...prev, antiBanEnabled: v }))} />
                </div>
                {newCampaign.antiBanEnabled && (
                  <div className="space-y-3 p-4 bg-muted/50 rounded-xl">
                    <Label className="text-sm">Modo de Aquecimento</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: 'normal', label: 'Normal', icon: Shield, desc: 'Equilibrado' },
                        { value: 'agressive', label: 'Agressivo', icon: Flame, desc: 'Mais rápido' },
                        { value: 'stealth', label: 'Furtivo', icon: Snowflake, desc: 'Máx. segurança' },
                      ].map(m => (
                        <button key={m.value} type="button" onClick={() => setNewCampaign(prev => ({ ...prev, warmingMode: m.value }))}
                          className={`p-3 rounded-lg border text-center transition-all ${newCampaign.warmingMode === m.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                          <m.icon className={`size-5 mx-auto mb-1 ${newCampaign.warmingMode === m.value ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                          <p className="text-sm font-medium">{m.label}</p>
                          <p className="text-xs text-muted-foreground">{m.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
        <Card className="shadow-md border-0">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Send className="size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">Nenhuma campanha criada</p>
            <p className="text-sm text-muted-foreground">Crie sua primeira campanha para começar</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="shadow-md hover:shadow-lg transition-all border-0">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
                      <Send className="size-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{c.name}</h3>
                        <StatusBadge status={c.status} />
                        {c.antiBanEnabled && (
                          <Badge variant="outline" className="gap-1 text-xs text-emerald-600 border-emerald-300">
                            <Shield className="size-3" /> Anti-Ban
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Smartphone className="size-3" /> {c.chips?.length || 0} chips</span>
                        {c.contactList && <span className="flex items-center gap-1"><Users className="size-3" /> {c.contactList.name}</span>}
                        {c.scheduledAt && <span className="flex items-center gap-1"><CalendarDays className="size-3" /> {new Date(c.scheduledAt).toLocaleDateString('pt-BR')}</span>}
                        {c.sequenceSteps?.length > 0 && <span className="flex items-center gap-1"><ArrowRight className="size-3" /> {c.sequenceSteps.length} etapas</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => openDetail(c)}><Eye className="size-4" /></Button>
                      </TooltipTrigger><TooltipContent>Detalhes</TooltipContent></Tooltip></TooltipProvider>
                      {c.status === 'draft' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateCampaignStatus(c.id, 'running')}><Play className="size-3.5" /> Iniciar</Button>}
                      {c.status === 'running' && <Button variant="outline" size="sm" className="gap-1" onClick={() => updateCampaignStatus(c.id, 'paused')}><Pause className="size-3.5" /> Pausar</Button>}
                      {c.status === 'paused' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateCampaignStatus(c.id, 'running')}><Play className="size-3.5" /> Retomar</Button>}
                      <Button variant="outline" size="sm" className="text-rose-500 hover:text-rose-600" onClick={() => setDeleteConfirm(c.id)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Campanha" description="Tem certeza? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) deleteCampaign(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{selectedCampaign?.name}</DialogTitle>
            <DialogDescription>Detalhes da campanha</DialogDescription>
          </DialogHeader>
          {selectedCampaign && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={selectedCampaign.status} />
                {selectedCampaign.antiBanEnabled && <Badge variant="outline" className="gap-1 text-emerald-600"><Shield className="size-3" /> Anti-Ban</Badge>}
                <Badge variant="outline" className="gap-1">{selectedCampaign.warmingMode === 'stealth' ? <><Snowflake className="size-3" /> Furtivo</> : selectedCampaign.warmingMode === 'agressive' ? <><Flame className="size-3" /> Agressivo</> : <><Shield className="size-3" /> Normal</>}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="shadow-sm"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Pendentes</p><p className="text-xl font-bold">{detailMessages.filter(m => m.status === 'pending').length}</p></CardContent></Card>
                <Card className="shadow-sm"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Enviadas</p><p className="text-xl font-bold text-sky-600">{detailMessages.filter(m => m.status === 'sent').length}</p></CardContent></Card>
                <Card className="shadow-sm"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Entregues</p><p className="text-xl font-bold text-emerald-600">{detailMessages.filter(m => m.status === 'delivered' || m.status === 'read').length}</p></CardContent></Card>
                <Card className="shadow-sm"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Falharam</p><p className="text-xl font-bold text-rose-600">{detailMessages.filter(m => m.status === 'failed').length}</p></CardContent></Card>
              </div>
              {selectedCampaign.sequenceSteps?.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Sequência de Mensagens</Label>
                  {selectedCampaign.sequenceSteps.sort((a, b) => a.stepOrder - b.stepOrder).map((step, idx) => (
                    <div key={step.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <span className="flex items-center justify-center size-7 rounded-full bg-emerald-600 text-white text-xs font-bold">{step.stepOrder}</span>
                      <p className="flex-1 text-sm truncate">{step.content}</p>
                      {step.delayMinutes > 0 && <Badge variant="secondary" className="text-xs gap-1"><Clock className="size-3" />{step.delayMinutes}min</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Templates Tab =====
function TemplatesTab() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [newTemplate, setNewTemplate] = useState({ name: '', content: '', category: 'geral' })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('todas')

  const fetchTemplates = useCallback(async () => {
    try { const res = await fetch('/api/templates'); setTemplates(await res.json()) }
    catch { toast.error('Erro ao carregar templates') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const createTemplate = async () => {
    try {
      const res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTemplate) })
      if (!res.ok) throw new Error()
      toast.success('Template criado!')
      setCreateDialogOpen(false)
      setNewTemplate({ name: '', content: '', category: 'geral' })
      fetchTemplates()
    } catch { toast.error('Erro ao criar template') }
  }

  const deleteTemplate = async (id: string) => {
    try { await fetch(`/api/templates?id=${id}`, { method: 'DELETE' }); toast.success('Template removido!'); fetchTemplates() }
    catch { toast.error('Erro ao remover template') }
  }

  const categories = ['todas', ...new Set(templates.map(t => t.category))]
  const filtered = templates.filter(t => {
    const matchSearch = !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.content.toLowerCase().includes(searchQuery.toLowerCase())
    const matchCategory = filterCategory === 'todas' || t.category === filterCategory
    return matchSearch && matchCategory
  })

  const insertVariable = (v: string) => {
    setNewTemplate(prev => ({ ...prev, content: prev.content + v }))
  }

  const categoryColors: Record<string, string> = {
    'saudação': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    'vendas': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    'follow-up': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    'pós-venda': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    'geral': 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Templates</h2>
          <p className="text-sm text-muted-foreground">Biblioteca de mensagens prontas</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
              <Plus className="size-4" /> Novo Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Criar Template</DialogTitle>
              <DialogDescription>Crie um template de mensagem reutilizável</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input placeholder="Ex: Boas-vindas" value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={newTemplate.category} onValueChange={v => setNewTemplate(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['geral', 'saudação', 'vendas', 'follow-up', 'pós-venda'].map(c => (
                      <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Conteúdo</Label>
                <Textarea placeholder="Ex: Olá {nome}! Tudo bem?" value={newTemplate.content} onChange={e => setNewTemplate(p => ({ ...p, content: e.target.value }))} rows={4} />
                <div className="flex flex-wrap gap-1.5">
                  {['{nome}', '{empresa}', '{telefone}', '{cidade}'].map(v => (
                    <Button key={v} variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => insertVariable(v)}>
                      <Sparkles className="size-3" />{v}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createTemplate} disabled={!newTemplate.name || !newTemplate.content} className="bg-emerald-600 hover:bg-emerald-700">Criar Template</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar templates..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-44"><Filter className="size-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card className="shadow-md border-0">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">Nenhum template encontrado</p>
            <p className="text-sm text-muted-foreground">Crie seu primeiro template de mensagem</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t, i) => {
            const vars = t.content.match(/\{[^}]+\}/g) || []
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="shadow-md hover:shadow-lg transition-all border-0 group">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
                        <MessageCircle className="size-5 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate text-base">{t.name}</CardTitle>
                        <Badge className={`mt-1 text-xs ${categoryColors[t.category] || categoryColors['geral']}`}>
                          {t.category}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground line-clamp-3">{t.content}</p>
                    {vars.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {vars.map((v, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs gap-1">
                            <Sparkles className="size-2.5" />{v}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                      <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setDeleteConfirm(t.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Template" description="Tem certeza que deseja remover este template?"
        onConfirm={() => { if (deleteConfirm) deleteTemplate(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />
    </div>
  )
}

// ===== Anti-Ban Tab =====
function AntiBanTab() {
  const [settings, setSettings] = useState<AntiBanSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/antiban')
      setSettings(await res.json())
    } catch { toast.error('Erro ao carregar configurações') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const updateSetting = async (key: string, value: unknown) => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) })
      setSettings(await res.json())
      toast.success('Configuração atualizada!')
    } catch { toast.error('Erro ao atualizar') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  if (!settings) return null

  const protectionItems = [
    { key: 'randomLineBreaks', label: 'Quebra de Linha Aleatória', desc: 'Insere quebras de linha aleatórias nas mensagens', icon: Shuffle, enabled: settings.randomLineBreaks },
    { key: 'emojiVariation', label: 'Variação de Emoji', desc: 'Varia emojis para evitar detecção de padrão', icon: Sparkles, enabled: settings.emojiVariation },
    { key: 'warmingEnabled', label: 'Aquecimento Progressivo', desc: 'Aumenta o volume gradualmente', icon: Flame, enabled: settings.warmingEnabled },
    { key: 'stopOnWarning', label: 'Parada em Aviso', desc: 'Para automaticamente se detectar aviso do WhatsApp', icon: AlertTriangle, enabled: settings.stopOnWarning },
  ]

  const warmingStages = [
    { day: '1-2', msgs: 20, pct: 10 },
    { day: '3-4', msgs: 50, pct: 25 },
    { day: '5-7', msgs: 100, pct: 50 },
    { day: '8+', msgs: settings.dailyLimitPerChip, pct: 100 },
  ]

  const tips = [
    { icon: Clock, title: 'Varie os horários de envio', desc: 'Não envie sempre no mesmo horário' },
    { icon: AlertCircle, title: 'Não envie links no primeiro dia', desc: 'Espere o chip aquecer antes' },
    { icon: UserPlus, title: 'Use mensagens personalizadas com {nome}', desc: 'Mensagens genéricas são mais detectáveis' },
    { icon: Flame, title: 'Aqueça chips novos gradualmente', desc: 'Comece com poucas mensagens' },
    { icon: RefreshCw, title: 'Alterne entre chips a cada 50 mensagens', desc: 'Distribua o envio entre múltiplos chips' },
    { icon: EyeOff, title: 'Evite mensagens idênticas para muitos contatos', desc: 'Use variações de texto' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Anti-Ban</h2>
        <p className="text-sm text-muted-foreground">Proteja seus chips contra bloqueios do WhatsApp</p>
      </div>

      {/* Active Protection Banner */}
      <Card className="shadow-lg border-0 overflow-hidden">
        <div className={`p-6 ${settings.warmingEnabled ? 'bg-gradient-to-r from-emerald-500 to-teal-600' : 'bg-gradient-to-r from-zinc-500 to-zinc-600'}`}>
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                {settings.warmingEnabled ? <ShieldCheck className="size-7" /> : <ShieldAlert className="size-7" />}
              </div>
              <div>
                <h3 className="text-xl font-bold">{settings.warmingEnabled ? 'Proteção Ativada' : 'Proteção Desativada'}</h3>
                <p className="text-sm opacity-90">{settings.warmingEnabled ? 'Seus chips estão protegidos contra bloqueios' : 'Ative a proteção para evitar bloqueios'}</p>
              </div>
            </div>
            <Switch checked={settings.warmingEnabled} onCheckedChange={v => updateSetting('warmingEnabled', v)} />
          </div>
        </div>
      </Card>

      {/* Protection Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {protectionItems.map((item, i) => (
          <motion.div key={item.key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="shadow-md hover:shadow-lg transition-all border-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`flex size-10 items-center justify-center rounded-xl ${item.enabled ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-zinc-100 dark:bg-zinc-900/30'}`}>
                    <item.icon className={`size-5 ${item.enabled ? 'text-emerald-600' : 'text-zinc-400'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch checked={item.enabled} onCheckedChange={v => updateSetting(item.key, v)} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Typing Simulation */}
      <Card className="shadow-md border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Type className="size-4 text-amber-600" />
            </div>
            <CardTitle className="text-lg">Simulação de Digitação</CardTitle>
          </div>
          <CardDescription>Simule o comportamento humano de digitação</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Atraso mínimo (ms)</Label>
                <span className="text-sm font-semibold">{settings.typingMinDelay}ms</span>
              </div>
              <Slider value={[settings.typingMinDelay]} onValueChange={([v]) => updateSetting('typingMinDelay', v)} min={200} max={3000} step={100} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Atraso máximo (ms)</Label>
                <span className="text-sm font-semibold">{settings.typingMaxDelay}ms</span>
              </div>
              <Slider value={[settings.typingMaxDelay]} onValueChange={([v]) => updateSetting('typingMaxDelay', v)} min={500} max={5000} step={100} />
            </div>
          </div>
          <div className="p-4 bg-muted/50 rounded-xl">
            <p className="text-sm text-muted-foreground mb-2">Visualização:</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-emerald-600">
                <MessageCircle className="size-4" />
                <span className="text-sm">Digitando</span>
                <span className="animate-pulse">...</span>
              </div>
              <span className="text-xs text-muted-foreground">({settings.typingMinDelay}–{settings.typingMaxDelay}ms)</span>
              <span className="text-sm">→ Olá, tudo bem? 😊</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message Interval */}
      <Card className="shadow-md border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
              <Timer className="size-4 text-sky-600" />
            </div>
            <CardTitle className="text-lg">Intervalo entre Mensagens</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Intervalo mínimo (segundos)</Label>
                <span className="text-sm font-semibold">{settings.messageIntervalMin}s</span>
              </div>
              <Slider value={[settings.messageIntervalMin]} onValueChange={([v]) => updateSetting('messageIntervalMin', v)} min={5} max={120} step={5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Intervalo máximo (segundos)</Label>
                <span className="text-sm font-semibold">{settings.messageIntervalMax}s</span>
              </div>
              <Slider value={[settings.messageIntervalMax]} onValueChange={([v]) => updateSetting('messageIntervalMax', v)} min={10} max={300} step={5} />
            </div>
          </div>
          <div className="p-4 bg-muted/50 rounded-xl">
            <p className="text-sm text-muted-foreground mb-3">Distribuição de envio:</p>
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <React.Fragment key={i}>
                  <div className="size-3 rounded-full bg-emerald-500" />
                  {i < 5 && <div className="flex-1 h-0.5 bg-gradient-to-r from-emerald-300 to-teal-300" style={{ width: `${20 + Math.random() * 30}px` }} />}
                </React.Fragment>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Cada ponto = 1 mensagem. Espaçamento aleatório entre {settings.messageIntervalMin}–{settings.messageIntervalMax}s</p>
          </div>
        </CardContent>
      </Card>

      {/* Progressive Warming */}
      <Card className="shadow-md border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Flame className="size-4 text-orange-600" />
            </div>
            <CardTitle className="text-lg">Aquecimento Progressivo</CardTitle>
          </div>
          <CardDescription>Aumente o volume gradualmente para evitar detecção</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="text-sm">Período de aquecimento</Label>
            <div className="flex gap-2">
              {[3, 5, 7, 14, 30].map(d => (
                <Button key={d} variant={settings.warmingDays === d ? 'default' : 'outline'} size="sm"
                  className={settings.warmingDays === d ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={() => updateSetting('warmingDays', d)}>
                  {d} dias
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {warmingStages.map((stage, i) => (
              <div key={i} className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-12">Dia {stage.day}</span>
                <div className="flex-1">
                  <div className="h-6 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full flex items-center justify-end pr-2"
                      initial={{ width: 0 }}
                      animate={{ width: `${stage.pct}%` }}
                      transition={{ duration: 0.8, delay: i * 0.2 }}
                    >
                      <span className="text-xs font-semibold text-white">{stage.msgs} msgs/dia</span>
                    </motion.div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cooldown & Limits */}
      <Card className="shadow-md border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
              <ShieldAlert className="size-4 text-rose-600" />
            </div>
            <CardTitle className="text-lg">Cooldown & Limites</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Limite diário por chip</Label>
                <span className="text-sm font-semibold">{settings.dailyLimitPerChip} mensagens</span>
              </div>
              <Slider value={[settings.dailyLimitPerChip]} onValueChange={([v]) => updateSetting('dailyLimitPerChip', v)} min={50} max={500} step={10} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Cooldown após</Label>
                <span className="text-sm font-semibold">{settings.cooldownAfterMessages} mensagens</span>
              </div>
              <Slider value={[settings.cooldownAfterMessages]} onValueChange={([v]) => updateSetting('cooldownAfterMessages', v)} min={10} max={100} step={5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">Duração do cooldown</Label>
                <span className="text-sm font-semibold">{settings.cooldownMinutes} minutos</span>
              </div>
              <Slider value={[settings.cooldownMinutes]} onValueChange={([v]) => updateSetting('cooldownMinutes', v)} min={5} max={120} step={5} />
            </div>
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
              <div>
                <p className="font-medium text-sm">Parada em Aviso</p>
                <p className="text-xs text-muted-foreground">Para se detectar aviso do WhatsApp</p>
              </div>
              <Switch checked={settings.stopOnWarning} onCheckedChange={v => updateSetting('stopOnWarning', v)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card className="shadow-md border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Star className="size-4 text-amber-600" />
            </div>
            <CardTitle className="text-lg">Dicas Anti-Ban</CardTitle>
          </div>
          <CardDescription>Boas práticas para evitar bloqueios</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tips.map((tip, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/20 shrink-0">
                  <tip.icon className="size-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">{tip.title}</p>
                  <p className="text-xs text-muted-foreground">{tip.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ===== Mensagens Tab =====
function MensagensTab() {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/messages')
      setMessages(await res.json())
    } catch { toast.error('Erro ao carregar mensagens') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const filtered = messages.filter(m => {
    const matchStatus = statusFilter === 'all' || m.status === statusFilter
    const matchSearch = !searchQuery ||
      m.contact?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.contact?.phone?.includes(searchQuery)
    return matchStatus && matchSearch
  })

  const statusTabs = [
    { value: 'all', label: 'Todas', count: messages.length },
    { value: 'pending', label: 'Pendentes', count: messages.filter(m => m.status === 'pending').length },
    { value: 'sent', label: 'Enviadas', count: messages.filter(m => m.status === 'sent').length },
    { value: 'delivered', label: 'Entregues', count: messages.filter(m => m.status === 'delivered').length },
    { value: 'read', label: 'Lidas', count: messages.filter(m => m.status === 'read').length },
    { value: 'failed', label: 'Falharam', count: messages.filter(m => m.status === 'failed').length },
  ]

  const exportCSV = () => {
    const headers = 'Contato,Telefone,Chip,Mensagem,Status,Data'
    const rows = filtered.map(m => `"${m.contact?.name || ''}","${m.contact?.phone || ''}","${m.chip?.name || ''}","${m.content.substring(0, 50)}","${statusLabel(m.status)}","${m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : ''}"`)
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'mensagens.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exportado!')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Mensagens</h2>
          <p className="text-sm text-muted-foreground">Histórico completo de mensagens enviadas</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportCSV}>
          <Download className="size-4" /> Exportar CSV
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar por contato ou telefone..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {statusTabs.map(tab => (
          <Button key={tab.value} variant={statusFilter === tab.value ? 'default' : 'outline'} size="sm"
            className={statusFilter === tab.value ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            onClick={() => setStatusFilter(tab.value)}>
            {tab.label} <Badge variant="secondary" className="ml-1.5 h-5 min-w-[20px]">{tab.count}</Badge>
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card className="shadow-md border-0">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageSquare className="size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">Nenhuma mensagem encontrada</p>
            <p className="text-sm text-muted-foreground">As mensagens aparecerão aqui após o envio</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-md border-0">
          <CardContent className="p-0">
            <ScrollArea className="max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-3 font-medium">Contato</th>
                    <th className="text-left p-3 font-medium">Telefone</th>
                    <th className="text-left p-3 font-medium">Chip</th>
                    <th className="text-left p-3 font-medium">Mensagem</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Data/Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium">{m.contact?.name || '—'}</td>
                      <td className="p-3 text-muted-foreground">{m.contact?.phone || '—'}</td>
                      <td className="p-3 text-muted-foreground">{m.chip?.name || '—'}</td>
                      <td className="p-3 max-w-[200px] truncate text-muted-foreground">{m.content}</td>
                      <td className="p-3"><StatusBadge status={m.status} /></td>
                      <td className="p-3 text-xs text-muted-foreground">{m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ===== Configurações Tab =====
function ConfiguracoesTab() {
  const [config, setConfig] = useState({
    resetHour: 0, defaultProxyMode: 'none', globalDailyLimit: 1000,
    emailNotifications: true, timezone: 'America/Sao_Paulo',
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configurações</h2>
        <p className="text-sm text-muted-foreground">Configurações gerais do sistema</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                <Clock className="size-4 text-sky-600" />
              </div>
              <CardTitle className="text-lg">Reset Diário</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Hora do reset diário</Label>
              <Input type="number" min={0} max={23} value={config.resetHour}
                onChange={e => setConfig(p => ({ ...p, resetHour: parseInt(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground">Os contadores de mensagem serão zerados neste horário</p>
            </div>
            <div className="space-y-2">
              <Label>Zona horária</Label>
              <Select value={config.timezone} onValueChange={v => setConfig(p => ({ ...p, timezone: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">Brasília (GMT-3)</SelectItem>
                  <SelectItem value="America/Manaus">Manaus (GMT-4)</SelectItem>
                  <SelectItem value="America/Belem">Belém (GMT-3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Smartphone className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-lg">Conexão Padrão</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Modo de conexão padrão</Label>
              <Select value={config.defaultProxyMode} onValueChange={v => setConfig(p => ({ ...p, defaultProxyMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">QR Code (WhatsApp Web)</SelectItem>
                  <SelectItem value="socks5">Proxy SOCKS5</SelectItem>
                  <SelectItem value="wireguard">WireGuard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Zap className="size-4 text-amber-600" />
              </div>
              <CardTitle className="text-lg">Limites</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Limite global de mensagens por dia</Label>
                <span className="text-sm font-semibold">{config.globalDailyLimit}</span>
              </div>
              <Slider value={[config.globalDailyLimit]} onValueChange={([v]) => setConfig(p => ({ ...p, globalDailyLimit: v }))} min={100} max={5000} step={100} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-md border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <MessageSquare className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">Notificações</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
              <div>
                <p className="font-medium text-sm">Notificações por email</p>
                <p className="text-xs text-muted-foreground">Receba alertas sobre campanhas e chips</p>
              </div>
              <Switch checked={config.emailNotifications} onCheckedChange={v => setConfig(p => ({ ...p, emailNotifications: v }))} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
          onClick={() => toast.success('Configurações salvas!')}>
          <Check className="size-4" /> Salvar Configurações
        </Button>
      </div>
    </div>
  )
}

// ===== Main App =====
export default function OctupusZapApp() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardTab stats={stats} />
      case 'chips': return <ChipsTab />
      case 'contatos': return <ContatosTab />
      case 'campanhas': return <CampanhasTab />
      case 'templates': return <TemplatesTab />
      case 'antiban': return <AntiBanTab />
      case 'mensagens': return <MensagensTab />
      case 'config': return <ConfiguracoesTab />
      default: return <DashboardTab stats={stats} />
    }
  }

  return (
    <div className="min-h-screen flex bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-zinc-900 dark:bg-zinc-950 border-r border-zinc-800">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">OctupusZap</h1>
              <p className="text-xs text-zinc-400">Mass Messaging SaaS</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map(item => (
            <button key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === item.id
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}>
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 m-3 rounded-xl bg-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-emerald-600">
              <span className="text-sm font-bold text-white">OZ</span>
            </div>
            <div>
              <p className="text-sm font-medium text-white">OctupusZap</p>
              <p className="text-xs text-zinc-400">Plano Pro</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              className="fixed left-0 top-0 bottom-0 w-64 bg-zinc-900 z-50 lg:hidden flex flex-col">
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
                      <Zap className="size-5 text-white" />
                    </div>
                    <h1 className="text-lg font-bold text-white">OctupusZap</h1>
                  </div>
                  <Button variant="ghost" size="sm" className="text-white" onClick={() => setSidebarOpen(false)}>
                    <X className="size-5" />
                  </Button>
                </div>
              </div>
              <nav className="flex-1 px-3 space-y-1">
                {NAV_ITEMS.map(item => (
                  <button key={item.id}
                    onClick={() => { setActiveTab(item.id); setSidebarOpen(false) }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      activeTab === item.id
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}>
                    <item.icon className="size-4" />
                    {item.label}
                  </button>
                ))}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex items-center gap-4 px-4 lg:px-6 h-14 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="size-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="size-4 text-emerald-500 lg:hidden" />
            <span className="font-medium text-foreground">{NAV_ITEMS.find(n => n.id === activeTab)?.label || 'Dashboard'}</span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                    <Shield className="size-3.5 text-emerald-600" />
                    <span className="text-xs font-semibold text-emerald-600">Anti-Ban Ativo</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Proteção anti-ban está ativada</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Footer */}
        <footer className="px-4 lg:px-6 py-4 border-t bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>OctupusZap © {new Date().getFullYear()} — Todos os direitos reservados</p>
            <p className="flex items-center gap-1">
              <Zap className="size-3 text-emerald-500" /> Powered by OctupusZap
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
