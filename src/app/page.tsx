'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, Send, Shield, BarChart3, Plus, Trash2,
  Copy, RefreshCw, Check, X, Clock, Zap, Users, MessageSquare,
  Activity, AlertCircle, FileText, Settings, Eye,
  Pause, Play, Upload, Search, ArrowLeft, CalendarDays,
  Phone, UserPlus, FileSpreadsheet, ChevronRight, Menu,
  TrendingUp, TrendingDown, ShieldCheck, ShieldAlert, Timer,
  MessageCircle, Type, Shuffle, Flame, Snowflake, EyeOff,
  Download, Filter, ArrowRight, QrCode, Globe, Lock, Server,
  Sparkles, Heart, Star, AlertTriangle, Info, ChevronDown,
  Pencil, LayoutList, Database, WifiOff, ArrowDownToLine, Save, XCircle,
  Inbox, LogOut, RotateCcw, Film, Music, File, Webhook, ImageIcon, Key, Paperclip, MapPin, Link2,
  Baby, CheckCircle2
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
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { VerificarSection } from '@/components/verificar-section'
import { KeysSection } from '@/components/keys-section'
import { VendedoresSection } from '@/components/vendedores-section'

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
  warmingPhase?: string
  prewarmStartedAt?: string | null
  isQrPaired: boolean
  qrPairingCode: string | null
  proxyMode: string
  socks5Host: string
  socks5Port: number
  socks5User: string
  socks5Pass: string
  evolutionInstance?: string | null
  profileName?: string | null
  profilePicUrl?: string | null
  disconnectionReasonCode?: number | null
}

interface SequenceStep {
  id: string
  campaignId: string
  stepOrder: number
  content: string
  delayMinutes: number
  mediaUrl?: string | null
  mediatype?: string | null
  variations?: string  // JSON: [{content, mediaUrl?, mediatype?}]
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  status: string
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
  customFields: string | null
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
  evolutionMessageId: string | null
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
  dailyLimitPerChip: number
  warmingEnabled: boolean
  warmingDays: number
  cooldownMinutes: number
  cooldownAfterMessages: number
  stopOnWarning: boolean
  sendingWindowStart: number
  sendingWindowEnd: number
  timezone: string
}

interface MessageTemplate {
  id: string
  name: string
  content: string
  category: string
  mediatype: string
  mediaDescription: string
  linkUrl: string
  linkPreview: boolean
  createdAt: string
  updatedAt: string
}

interface InboxMessage {
  id: string
  instanceName: string
  remoteJid: string
  fromMe: boolean
  messageContent: string
  messageType: string
  pushName: string | null
  evolutionMsgId: string | null
  createdAt: string
}

// ===== Navigation Items =====
// Role hierarchy: master > admin > operador
const ROLE_LEVELS: Record<string, number> = { master: 3, admin: 2, operador: 1 }

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3, minRole: 'operador' },
  { id: 'chips', label: 'Chips', icon: Smartphone, minRole: 'operador' },
  { id: 'inbox', label: 'Caixa de Entrada', icon: Inbox, minRole: 'operador' },
  { id: 'contatos', label: 'Lista de Contatos', icon: Users, minRole: 'operador' },
  { id: 'verificar', label: 'Verificar Números', icon: ShieldCheck, minRole: 'operador' },
  { id: 'campanhas', label: 'Campanhas', icon: Send, minRole: 'operador' },
  { id: 'templates', label: 'Templates', icon: FileText, minRole: 'operador' },
  { id: 'chaves', label: 'Chaves', icon: Key, minRole: 'admin' },
  { id: 'vendedores', label: 'Vendedores', icon: Users, minRole: 'admin' },
  { id: 'antiban', label: 'Anti-Ban', icon: Shield, minRole: 'admin' },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquare, minRole: 'operador' },
  { id: 'usuarios', label: 'Usuários', icon: UserPlus, minRole: 'master' },
  { id: 'vps', label: 'VPS / Proxy', icon: Server, minRole: 'master' },
  { id: 'config', label: 'Configurações', icon: Settings, minRole: 'master' },
]

// ===== Variáveis de Mensagem =====
// Variables from contact spreadsheet (planilha)
const CONTACT_VARIABLES = [
  { tag: '{{nome}}', label: 'Nome', icon: '👤' },
  { tag: '{{telefone}}', label: 'Telefone', icon: '📱' },
  { tag: '{{empresa}}', label: 'Empresa', icon: '🏢' },
  { tag: '{{vendedor}}', label: 'Vendedor', icon: '🧑‍💼' },
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
function DashboardTab({ stats, onRefresh, setActiveTab }: { stats: Stats | null; onRefresh: () => void; setActiveTab: (tab: string) => void }) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    onRefresh()
    setTimeout(() => setRefreshing(false), 1000)
  }

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
    { title: 'Chips', value: s.totalChips, sub: `${s.connectedChips} conectados`, icon: Smartphone, gradient: 'from-emerald-500 to-teal-600', trend: s.connectedChips > 0 ? `${s.connectedChips} online` : 'nenhum online', trendUp: s.connectedChips > 0 },
    { title: 'Campanhas', value: s.totalCampaigns, sub: `${s.activeCampaigns} ativas`, icon: Send, gradient: 'from-amber-500 to-orange-600', trend: s.activeCampaigns > 0 ? `${s.activeCampaigns} rodando` : 'nenhuma ativa', trendUp: s.activeCampaigns > 0 },
    { title: 'Mensagens', value: s.totalMessages, sub: `${s.sentMessages} enviadas`, icon: MessageSquare, gradient: 'from-cyan-500 to-sky-600', trend: s.pendingMessages > 0 ? `${s.pendingMessages} pendentes` : 'todas processadas', trendUp: s.totalMessages > 0 },
    { title: 'Taxa de Entrega', value: s.deliveryRate > 0 ? `${s.deliveryRate}%` : '—', sub: `${s.failedMessages} falharam`, icon: Activity, gradient: 'from-rose-500 to-pink-600', trend: s.deliveryRate > 80 ? 'boa' : s.deliveryRate > 0 ? 'atenção' : 'sem dados', trendUp: s.deliveryRate > 80 },
  ]

  const quickActions = [
    { label: 'Novo Chip', icon: Smartphone, tab: 'chips', color: 'from-violet-500 to-purple-600' },
    { label: 'Nova Campanha', icon: Send, tab: 'campanhas', color: 'from-emerald-500 to-teal-600' },
    { label: 'Importar Contatos', icon: Users, tab: 'contatos', color: 'from-amber-500 to-orange-600' },
  ]

  return (
    <div className="space-y-6">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Visão geral do sistema</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.01]">
              <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-[0.08]`} />
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${card.gradient}`} />
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

      {/* Quick Actions */}
      <Card className="shadow-lg border-0">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Zap className="size-4 text-zinc-600 dark:text-zinc-400" />
            </div>
            <CardTitle className="text-lg">Ações Rápidas</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {quickActions.map((action) => (
              <button key={action.tab} onClick={() => setActiveTab(action.tab)}
                className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/60 hover:shadow-md transition-all duration-200 hover:scale-[1.01] text-left">
                <div className={`flex size-10 items-center justify-center rounded-xl bg-gradient-to-br ${action.color} shadow-md`}>
                  <action.icon className="size-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{action.label}</p>
                  <p className="text-xs text-muted-foreground">Ir para {action.label.toLowerCase()}</p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground ml-auto" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
              {stats.runningCampaigns.map((c: any) => (
                <div key={c.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.chips?.length || 0} chips • {c._completedMessages || 0}/{c._totalMessages || 0} mensagens</p>
                  </div>
                  <Progress value={c._progress || 0} className="w-32 h-2" />
                  <Badge variant="default" className="bg-emerald-600">{c._progress || 0}%</Badge>
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

  // Proxy test state
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<{ reachable: boolean; socks5Valid: boolean; message: string } | null>(null)

  // WhatsApp QR Code integration state
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrConnected, setQrConnected] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Anti-ban: cooldown between connection attempts
  const COOLDOWN_SECONDS = 60
  const MAX_ATTEMPTS = 3
  const [lastConnectAttempt, setLastConnectAttempt] = useState<number>(0)
  const [connectAttempts, setConnectAttempts] = useState<number>(0)
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Evolution API sync/import state
  const [syncing, setSyncing] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [instancesLoading, setInstancesLoading] = useState(false)
  const [unlinkedInstances, setUnlinkedInstances] = useState<Array<{ name: string; connectionStatus: string; profileName: string | null; profilePicUrl: string | null; number: string | null; disconnectionReasonCode: number | null }>>([])
  const [selectedInstances, setSelectedInstances] = useState<Set<string>>(new Set())
  const [webhookConfiguring, setWebhookConfiguring] = useState(false)

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setChips(data)
    } catch { toast.error('Erro ao carregar chips') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchChips() }, [fetchChips])

  // Sync WhatsApp status on load
  useEffect(() => {
    const syncStatuses = async () => {
      try {
        const res = await fetch('/api/whatsapp/status')
        if (res.ok) {
          const data = await res.json()
          if (data.chips) {
            // Re-fetch chips to get updated statuses from DB
            fetchChips()
          }
        }
      } catch {
        // Silently fail — status sync is best-effort
      }
    }
    syncStatuses()
  }, [fetchChips])

  useEffect(() => {
    if (selectedChipConfig?.config) {
      QRCode.toDataURL(selectedChipConfig.config, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        .then(url => setQrCodeUrl(url)).catch(() => setQrCodeUrl(''))
    } else { setQrCodeUrl('') }
  }, [selectedChipConfig?.config])

  // Cleanup polling and cooldown on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  const startCooldown = () => {
    setLastConnectAttempt(Date.now())
    setCooldownRemaining(COOLDOWN_SECONDS)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const connectWhatsApp = async (chip: Chip) => {
    // Check cooldown
    const elapsed = (Date.now() - lastConnectAttempt) / 1000
    if (elapsed < COOLDOWN_SECONDS && connectAttempts > 0) {
      const remaining = Math.ceil(COOLDOWN_SECONDS - elapsed)
      toast.error(`Aguarde ${remaining}s antes de tentar novamente. Reconexões rápidas podem causar banimento!`)
      return
    }

    // Check max attempts
    if (connectAttempts >= MAX_ATTEMPTS) {
      toast.error(`Limite de ${MAX_ATTEMPTS} tentativas atingido. Feche o diálogo e aguarde alguns minutos antes de tentar novamente para evitar banimento.`)
      return
    }

    setQrLoading(true)
    setQrError(null)
    setWhatsappQr(null)
    setQrConnected(false)
    setSelectedChip(chip)
    setQrDialogOpen(true)
    setConnectAttempts(prev => prev + 1)
    startCooldown()

    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: chip.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao conectar WhatsApp')
      }

      // Handle QR code base64 — might come with or without data URI prefix
      if (data.qrcode) {
        const qrSrc = data.qrcode.startsWith('data:') ? data.qrcode : `data:image/png;base64,${data.qrcode}`
        setWhatsappQr(qrSrc)
      }

      // If already connected
      if (data.status === 'open' || data.state === 'open') {
        setQrConnected(true)
        setConnectAttempts(0)
        fetchChips()
        return
      }

      // Start polling for connection status
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/whatsapp/status?chipId=${chip.id}`)
          const statusData = await statusRes.json()

          if (statusData.state === 'open' || statusData.chipStatus === 'connected') {
            setQrConnected(true)
            setConnectAttempts(0)
            if (pollingRef.current) clearInterval(pollingRef.current)
            fetchChips()
            toast.success(`WhatsApp conectado: ${chip.name}`)
          }
        } catch {
          // Silently continue polling
        }
      }, 3000)
    } catch (err: unknown) {
      const rawMessage = (err as Error).message || 'Erro ao gerar QR Code'
      // Show a user-friendly message instead of raw Evolution API error
      let friendlyMessage = 'Não foi possível conectar o dispositivo. Tente novamente mais tarde.'
      if (rawMessage.includes('URL ou API Key')) {
        friendlyMessage = 'Evolution API não configurada. Vá em Configurações e defina a URL e API Key.'
      } else if (rawMessage.includes('Chip não encontrado')) {
        friendlyMessage = 'Chip não encontrado. Atualize a página e tente novamente.'
      } else if (rawMessage.includes('404')) {
        friendlyMessage = 'Instância não encontrada na Evolution API. Tente sincronizar primeiro.'
      } else {
        // Include original error for debugging but in a cleaner format
        console.error('QR Code error:', rawMessage)
      }
      setQrError(friendlyMessage)
      toast.error(friendlyMessage)
    } finally {
      setQrLoading(false)
    }
  }

  const refreshQrCode = async () => {
    if (!selectedChip) return

    // Check cooldown — refresh also creates a new session, so enforce cooldown
    const elapsed = (Date.now() - lastConnectAttempt) / 1000
    if (elapsed < COOLDOWN_SECONDS && connectAttempts > 0) {
      const remaining = Math.ceil(COOLDOWN_SECONDS - elapsed)
      toast.error(`Aguarde ${remaining}s antes de atualizar. Reconexões rápidas causam banimento!`)
      return
    }

    // Check max attempts
    if (connectAttempts >= MAX_ATTEMPTS) {
      toast.error(`Limite de ${MAX_ATTEMPTS} tentativas atingido. Feche o diálogo e aguarde alguns minutos.`)
      return
    }

    setQrLoading(true)
    setQrError(null)
    setWhatsappQr(null)
    setQrConnected(false)
    setConnectAttempts(prev => prev + 1)
    startCooldown()

    if (pollingRef.current) clearInterval(pollingRef.current)

    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: selectedChip.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao atualizar QR Code')
      }

      if (data.qrcode) {
        const qrSrc = data.qrcode.startsWith('data:') ? data.qrcode : `data:image/png;base64,${data.qrcode}`
        setWhatsappQr(qrSrc)
      }

      if (data.status === 'open' || data.state === 'open') {
        setQrConnected(true)
        setConnectAttempts(0)
        fetchChips()
        return
      }

      // Restart polling
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/whatsapp/status?chipId=${selectedChip.id}`)
          const statusData = await statusRes.json()

          if (statusData.state === 'open' || statusData.chipStatus === 'connected') {
            setQrConnected(true)
            setConnectAttempts(0)
            if (pollingRef.current) clearInterval(pollingRef.current)
            fetchChips()
            toast.success(`WhatsApp conectado: ${selectedChip.name}`)
          }
        } catch {
          // Silently continue polling
        }
      }, 3000)
    } catch (err: unknown) {
      const rawMessage = (err as Error).message || 'Erro ao atualizar QR Code'
      let friendlyMessage = 'Não foi possível gerar o QR Code. Tente novamente.'
      if (rawMessage.includes('URL ou API Key')) {
        friendlyMessage = 'Evolution API não configurada. Vá em Configurações e defina a URL e API Key.'
      } else if (rawMessage.includes('404')) {
        friendlyMessage = 'Instância não encontrada na Evolution API. Tente sincronizar primeiro.'
      } else {
        console.error('QR refresh error:', rawMessage)
      }
      setQrError(friendlyMessage)
    } finally {
      setQrLoading(false)
    }
  }

  const disconnectWhatsApp = async (chip: Chip) => {
    try {
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: chip.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao desconectar')
      }
      toast.success(`WhatsApp desconectado: ${chip.name}`)
      fetchChips()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao desconectar WhatsApp')
    }
  }

  const closeQrDialog = (open: boolean) => {
    setQrDialogOpen(open)
    if (!open) {
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (cooldownRef.current) clearInterval(cooldownRef.current)
      setWhatsappQr(null)
      setQrLoading(false)
      setQrConnected(false)
      setQrError(null)
      setConnectAttempts(0)
      setCooldownRemaining(0)
    }
  }

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

  const openProxyDialog = async (chip: Chip) => {
    setSelectedChip(chip)
    setProxyTestResult(null)
    setProxyForm({ socks5Host: chip.socks5Host, socks5Port: chip.socks5Port || chip.socksPort || 8080, socks5User: chip.socks5User, socks5Pass: chip.socks5Pass })
    // Try to load WireGuard config too
    try {
      const res = await fetch(`/api/wireguard/${chip.id}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedChipConfig(data)
        // Generate QR code
        try {
          const url = await QRCode.toDataURL(data.config, { width: 256, margin: 2 })
          setQrCodeUrl(url)
        } catch { setQrCodeUrl('') }
      } else {
        setSelectedChipConfig(null)
        setQrCodeUrl('')
      }
    } catch {
      setSelectedChipConfig(null)
      setQrCodeUrl('')
    }
    setProxyDialogOpen(true)
  }

  const testProxyConnection = async () => {
    if (!selectedChip) return
    setProxyTesting(true)
    setProxyTestResult(null)
    try {
      const res = await fetch('/api/proxy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: selectedChip.id }),
      })
      const data = await res.json()
      setProxyTestResult({
        reachable: data.reachable || false,
        socks5Valid: data.socks5Valid || false,
        message: data.message || data.error || 'Resultado desconhecido',
      })
    } catch (err: unknown) {
      setProxyTestResult({ reachable: false, socks5Valid: false, message: (err as Error).message || 'Erro ao testar proxy' })
    } finally {
      setProxyTesting(false)
    }
  }

  const saveProxy = async () => {
    if (!selectedChip) return
    await updateChip(selectedChip.id, { ...proxyForm, proxyMode: 'socks5' })
    setProxyDialogOpen(false)
  }

  const syncEvolutionApi = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/whatsapp/sync-instances', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao sincronizar')
      toast.success(`Sincronização concluída: ${data.synced} chips atualizados${data.unlinked?.length ? ` — ${data.unlinked.length} instâncias não vinculadas` : ''}`)
      fetchChips()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao sincronizar Evolution API')
    } finally {
      setSyncing(false)
    }
  }

  const configureWebhooks = async () => {
    const chipsWithInstance = chips.filter(c => c.evolutionInstance)
    if (chipsWithInstance.length === 0) {
      toast.error('Nenhum chip com instância Evolution API encontrada')
      return
    }
    setWebhookConfiguring(true)
    let configured = 0
    let failed = 0
    for (let i = 0; i < chipsWithInstance.length; i++) {
      try {
        const res = await fetch('/api/whatsapp/setup-webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chipId: chipsWithInstance[i].id }),
        })
        if (res.ok) configured++
        else failed++
      } catch {
        failed++
      }
      // Update progress toast
      if (i < chipsWithInstance.length - 1) {
        toast.loading(`Configurando webhooks ${i + 1}/${chipsWithInstance.length}...`, { id: 'webhook-progress' })
      }
    }
    toast.dismiss('webhook-progress')
    if (configured > 0) {
      toast.success(`${configured} webhook(s) configurado(s) com sucesso!${failed > 0 ? ` — ${failed} falha(s)` : ''}`)
    } else {
      toast.error('Falha ao configurar webhooks')
    }
    setWebhookConfiguring(false)
  }

  const openImportDialog = async () => {
    setImportDialogOpen(true)
    setInstancesLoading(true)
    setSelectedInstances(new Set())
    try {
      // Fetch all instances from Evolution API
      const instancesRes = await fetch('/api/whatsapp/instances')
      const instancesData = await instancesRes.json()
      if (!instancesRes.ok) throw new Error(instancesData.error || 'Erro ao buscar instâncias')

      // Find unlinked instances (not linked to any chip)
      const linkedInstanceNames = new Set(
        chips.filter(c => c.evolutionInstance).map(c => c.evolutionInstance!)
      )
      const unlinked = (instancesData.instances || []).filter(
        (inst: { name: string }) => !linkedInstanceNames.has(inst.name)
      )
      setUnlinkedInstances(unlinked)
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao buscar instâncias')
      setUnlinkedInstances([])
    } finally {
      setInstancesLoading(false)
    }
  }

  const importSelectedInstances = async () => {
    if (selectedInstances.size === 0) return
    setImportLoading(true)
    try {
      const res = await fetch('/api/whatsapp/import-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceNames: Array.from(selectedInstances) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao importar instâncias')
      toast.success(`${data.newImports} instância(s) importada(s) com sucesso!${data.skipped?.length ? ` — ${data.skipped.length} ignorada(s)` : ''}`)
      setImportDialogOpen(false)
      fetchChips()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao importar instâncias')
    } finally {
      setImportLoading(false)
    }
  }

  const toggleInstanceSelection = (name: string) => {
    setSelectedInstances(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Chips</h2>
          <p className="text-sm text-muted-foreground">Gerencie os números WhatsApp conectados</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={syncEvolutionApi} disabled={syncing}>
            {syncing ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {syncing ? 'Sincronizando...' : 'Sincronizar Evolution API'}
          </Button>
          <Button variant="outline" className="gap-2" onClick={configureWebhooks} disabled={webhookConfiguring}>
            {webhookConfiguring ? <RefreshCw className="size-4 animate-spin" /> : <Webhook className="size-4" />}
            {webhookConfiguring ? 'Configurando...' : 'Configurar Webhooks'}
          </Button>
          <Button variant="outline" className="gap-2" onClick={openImportDialog} disabled={importLoading}>
            <ArrowDownToLine className="size-4" /> Importar Instâncias
          </Button>
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
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: chips.length, icon: Smartphone, color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30' },
          { label: 'Conectados', value: connected, icon: Check, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Desconectados', value: disconnected, icon: X, color: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-900/30' },
          { label: 'Erro', value: errorCount, icon: AlertCircle, color: 'text-rose-600 bg-rose-100 dark:bg-rose-900/30' },
        ].map(s => (
          <Card key={s.label} className="shadow-lg">
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
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
                <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0 relative overflow-hidden">
                  <div className={`absolute top-0 left-0 right-0 h-1 ${chip.status === 'connected' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : chip.status === 'error' ? 'bg-gradient-to-r from-rose-400 to-pink-500' : chip.status === 'connecting' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-zinc-300'}`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      {chip.profilePicUrl ? (
                        <img src={chip.profilePicUrl} alt={chip.profileName || chip.name} className={`size-12 rounded-xl object-cover ring-2 ${chip.status === 'connected' ? 'ring-emerald-500/30' : 'ring-zinc-300'}`} />
                      ) : (
                        <div className="flex size-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
                          <Smartphone className="size-6 text-violet-600 dark:text-violet-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CardTitle className="truncate text-base">{chip.profileName || chip.name}</CardTitle>
                          {chip.disconnectionReasonCode === 401 && (
                            <Badge variant="destructive" className="gap-1 text-[10px] px-1.5 py-0 shrink-0">
                              <WifiOff className="size-3" /> Dispositivo removido
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <CardDescription className="truncate">{chip.phoneNumber}</CardDescription>
                          {chip.evolutionInstance && (
                            <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-28" title={chip.evolutionInstance}>{chip.evolutionInstance}</span>
                          )}
                        </div>
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
                            {(chip as any).warmingPhase === 'ready' ? (
                              <><CheckCircle2 className="size-3" /> Pronto</>
                            ) : (chip as any).warmingPhase === 'prewarm' ? (
                              <><Flame className="size-3" /> Pré-aquecido</>
                            ) : (
                              <><Baby className="size-3" /> Berçário</>
                            )}
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
                      {chip.status === 'connected' ? (
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs text-rose-500 hover:text-rose-600 border-rose-200 hover:border-rose-300" onClick={() => disconnectWhatsApp(chip)}>
                          <X className="size-3.5" /> Desconectar
                        </Button>
                      ) : (
                        <Button size="sm" className="gap-1.5 text-xs bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-md" onClick={() => connectWhatsApp(chip)}>
                          <QrCode className="size-3.5" /> Conectar WhatsApp
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => openProxyDialog(chip)}>
                        <Globe className="size-3.5" /> Conectar Proxy
                      </Button>
                      {chip.evolutionInstance && (
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={async () => {
                          try {
                            const res = await fetch('/api/whatsapp/setup-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chipId: chip.id }) })
                            const data = await res.json()
                            if (!res.ok) throw new Error(data.error || 'Erro ao configurar webhook')
                            toast.success('Webhook configurado!')
                          } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao configurar webhook') }
                        }}>
                          <Webhook className="size-3.5" /> Webhook
                        </Button>
                      )}
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

      {/* Import Instances Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="size-5 text-emerald-500" /> Importar Instâncias do Evolution API
            </DialogTitle>
            <DialogDescription>Selecione instâncias OctupusZap (prefixo &quot;OctupusZap_&quot;) para importar como chips. Instâncias externas não aparecem.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {instancesLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="size-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Buscando instâncias...</span>
              </div>
            ) : unlinkedInstances.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30 mb-3">
                  <Check className="size-6 text-emerald-500" />
                </div>
                <p className="text-sm font-medium">Todas as instâncias já estão vinculadas</p>
                <p className="text-xs text-muted-foreground mt-1">Não há instâncias não vinculadas para importar</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{unlinkedInstances.length} instância(s) disponível(is)</span>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
                    if (selectedInstances.size === unlinkedInstances.length) {
                      setSelectedInstances(new Set())
                    } else {
                      setSelectedInstances(new Set(unlinkedInstances.map(i => i.name)))
                    }
                  }}>
                    {selectedInstances.size === unlinkedInstances.length ? 'Desmarcar todas' : 'Selecionar todas'}
                  </Button>
                </div>
                <ScrollArea className="max-h-72">
                  <div className="space-y-2 pr-3">
                    {unlinkedInstances.map(inst => (
                      <label key={inst.name} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedInstances.has(inst.name) ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20' : 'border-border hover:bg-muted/50'}`}>
                        <Checkbox
                          checked={selectedInstances.has(inst.name)}
                          onCheckedChange={() => toggleInstanceSelection(inst.name)}
                        />
                        {inst.profilePicUrl ? (
                          <img src={inst.profilePicUrl} alt={inst.profileName || inst.name} className="size-9 rounded-lg object-cover" />
                        ) : (
                          <div className="flex size-9 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                            <Smartphone className="size-4 text-zinc-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{inst.profileName || inst.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground/70 truncate">{inst.name}</span>
                            <Badge variant={inst.connectionStatus === 'open' ? 'default' : 'secondary'} className={`text-[10px] px-1.5 py-0 ${inst.connectionStatus === 'open' ? 'bg-emerald-600' : ''}`}>
                              {inst.connectionStatus === 'open' ? 'Conectada' : inst.connectionStatus === 'connecting' ? 'Conectando' : 'Desconectada'}
                            </Badge>
                            {inst.disconnectionReasonCode === 401 && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <WifiOff className="size-2.5" /> Removido
                              </Badge>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={importSelectedInstances} disabled={selectedInstances.size === 0 || importLoading} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
              {importLoading ? <><RefreshCw className="size-4 animate-spin" /> Importando...</> : <><ArrowDownToLine className="size-4" /> Importar {selectedInstances.size > 0 ? `(${selectedInstances.size})` : ''}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Chip" description="Tem certeza que deseja remover este chip? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) deleteChip(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      {/* WhatsApp QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={closeQrDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-5 text-emerald-500" /> Conectar WhatsApp — {selectedChip?.name}
            </DialogTitle>
            <DialogDescription>Escaneie o QR Code para conectar o WhatsApp Web</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrLoading ? (
              <div className="w-56 h-56 bg-muted rounded-xl flex items-center justify-center">
                <RefreshCw className="size-10 animate-spin text-muted-foreground" />
              </div>
            ) : qrConnected ? (
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-4">
                <div className="w-56 h-56 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center border-2 border-emerald-200 dark:border-emerald-800">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg">
                      <Check className="size-8 text-white" />
                    </div>
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">Conectado!</p>
                  </div>
                </div>
                <Badge variant="default" className="gap-1.5 py-1.5 bg-emerald-600">
                  <Check className="size-3" /> WhatsApp conectado com sucesso
                </Badge>
              </motion.div>
            ) : qrError ? (
              <div className="flex flex-col items-center gap-4">
                <div className="w-56 h-56 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center border-2 border-rose-200 dark:border-rose-800">
                  <div className="flex flex-col items-center gap-3 p-4 text-center">
                    <AlertCircle className="size-10 text-rose-500" />
                    <p className="text-sm text-rose-600 dark:text-rose-400">{qrError}</p>
                  </div>
                </div>
                <Button variant="outline" className="gap-2" onClick={refreshQrCode} disabled={cooldownRemaining > 0 || connectAttempts >= MAX_ATTEMPTS}>
                  <RefreshCw className="size-4" />
                  {cooldownRemaining > 0 ? `Aguarde ${cooldownRemaining}s` : connectAttempts >= MAX_ATTEMPTS ? 'Limite atingido' : 'Tentar Novamente'}
                </Button>
              </div>
            ) : whatsappQr ? (
              <div className="flex flex-col items-center gap-4">
                <div className="bg-white p-4 rounded-2xl shadow-xl">
                  <img src={whatsappQr} alt="QR Code WhatsApp" className="w-56 h-56 rounded-xl" />
                </div>
                <Badge variant="outline" className="gap-1.5 py-1.5">
                  <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                  Aguardando scan...
                </Badge>
              </div>
            ) : (
              <div className="w-56 h-56 bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 rounded-xl flex items-center justify-center">
                <QrCode className="size-24 text-zinc-400" />
              </div>
            )}

            {/* Anti-ban warning banner */}
            {!qrConnected && (
              <div className="w-full p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">⚠️ Risco de Banimento</p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Reconexões rápidas podem fazer o WhatsApp banir seu número. 
                      Limite: {MAX_ATTEMPTS} tentativas por sessão com intervalo de {COOLDOWN_SECONDS}s.
                      {connectAttempts > 0 && <span className="font-bold"> Tentativa {connectAttempts}/{MAX_ATTEMPTS}.</span>}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="w-full p-4 bg-muted/50 rounded-xl space-y-2 text-sm">
              <p className="font-semibold">Como conectar:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                <li>Abra o WhatsApp no celular</li>
                <li>Toque em Menu → Aparelhos conectados</li>
                <li>Escaneie o QR Code acima</li>
              </ol>
            </div>
            {!qrConnected && !qrError && (
              <Button variant="outline" className="gap-2" onClick={refreshQrCode} disabled={qrLoading || cooldownRemaining > 0 || connectAttempts >= MAX_ATTEMPTS}>
                <RefreshCw className={`size-4 ${qrLoading ? 'animate-spin' : ''}`} />
                {cooldownRemaining > 0 ? `Aguarde ${cooldownRemaining}s` : connectAttempts >= MAX_ATTEMPTS ? 'Limite atingido' : 'Atualizar QR Code'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Unified Proxy Connection Dialog */}
      <Dialog open={proxyDialogOpen} onOpenChange={(open) => {
        setProxyDialogOpen(open)
        if (!open) { setProxyTestResult(null); setQrCodeUrl(''); setCopied(false) }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="size-5 text-emerald-500" /> Conectar Proxy — {selectedChip?.name}
            </DialogTitle>
            <DialogDescription>Configure o WireGuard e o Every Proxy para que as campanhas saiam pelo IP do celular.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="setup" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="setup" className="flex-1 gap-1.5"><Smartphone className="size-3.5" /> Configurar</TabsTrigger>
              <TabsTrigger value="test" className="flex-1 gap-1.5"><Activity className="size-3.5" /> Testar</TabsTrigger>
              <TabsTrigger value="manual" className="flex-1 gap-1.5"><Settings className="size-3.5" /> Manual</TabsTrigger>
            </TabsList>

            {/* === SETUP TAB — Step-by-step instructions === */}
            <TabsContent value="setup" className="mt-4">
              <div className="space-y-5">
                {/* Step 1: WireGuard */}
                <div className="space-y-3">
                  <h4 className="font-semibold flex items-center gap-2 text-sm">
                    <span className="flex items-center justify-center size-7 rounded-full bg-blue-600 text-white text-xs font-bold">1</span>
                    WireGuard no Celular
                  </h4>
                  <div className="ml-9 space-y-3">
                    {selectedChipConfig ? (
                      <>
                        {/* QR Code */}
                        <div className="flex flex-col items-center gap-2">
                          {qrCodeUrl ? (
                            <div className="bg-white p-3 rounded-xl shadow-md"><img src={qrCodeUrl} alt="QR Code WireGuard" className="w-48 h-48" /></div>
                          ) : (
                            <div className="w-48 h-48 bg-muted rounded-xl flex items-center justify-center"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
                          )}
                          <p className="text-xs text-muted-foreground">Abra o app WireGuard → + → Escanear QR Code</p>
                        </div>
                        {/* Config text */}
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Ou copie a configuração e cole manualmente:</p>
                          <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-[10px] overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700 max-h-40 overflow-y-auto">
                            {selectedChipConfig.config}
                          </pre>
                          <Button onClick={() => copyToClipboard(selectedChipConfig.config)} variant="outline" size="sm" className="w-full gap-1.5">
                            {copied ? <><Check className="size-3.5 text-emerald-500" /> Copiado!</> : <><Copy className="size-3.5" /> Copiar Config WireGuard</>}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                          WireGuard nao configurado para este chip. Gere as chaves na aba VPS Setup primeiro.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 2: Every Proxy */}
                <div className="space-y-3">
                  <h4 className="font-semibold flex items-center gap-2 text-sm">
                    <span className="flex items-center justify-center size-7 rounded-full bg-purple-600 text-white text-xs font-bold">2</span>
                    Every Proxy no Celular
                  </h4>
                  <div className="ml-9 space-y-2">
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 space-y-2">
                      <p className="text-xs text-purple-700 dark:text-purple-300">
                        Depois de ativar o WireGuard, abra o app <strong>Every Proxy</strong> no celular:
                      </p>
                      <ol className="text-xs text-purple-700 dark:text-purple-300 space-y-1 list-decimal ml-4">
                        <li>Vá na aba <strong>SOCKS5</strong></li>
                        <li>Confira a <strong>porta</strong> (padrão: 8080)</li>
                        <li>Ative o <strong>switch</strong> para ligar o proxy</li>
                      </ol>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 space-y-1">
                      <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold">Dados do proxy para este chip:</p>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-600 dark:text-blue-400">IP WireGuard:</span>
                        <code className="bg-white dark:bg-zinc-800 px-2 py-0.5 rounded font-mono text-blue-800 dark:text-blue-200 border">
                          {selectedChip?.wireguardIp || selectedChipConfig?.chip.wireguardIp || 'Não configurado'}
                        </code>
                        {selectedChip?.wireguardIp && (
                          <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => copyToClipboard(selectedChip.wireguardIp)}>
                            <Copy className="size-3" />
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-600 dark:text-blue-400">Porta SOCKS5:</span>
                        <code className="bg-white dark:bg-zinc-800 px-2 py-0.5 rounded font-mono text-blue-800 dark:text-blue-200 border">
                          {selectedChip?.socksPort || 8080}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-600 dark:text-blue-400">Proxy completo:</span>
                        <code className="bg-white dark:bg-zinc-800 px-2 py-0.5 rounded font-mono text-blue-800 dark:text-blue-200 border">
                          {selectedChip?.wireguardIp || selectedChipConfig?.chip.wireguardIp || '0.0.0.0'}:{selectedChip?.socksPort || 8080}
                        </code>
                        {selectedChip?.wireguardIp && (
                          <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => copyToClipboard(`${selectedChip.wireguardIp}:${selectedChip.socksPort || 8080}`)}>
                            <Copy className="size-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 3: Confirm */}
                <div className="space-y-3">
                  <h4 className="font-semibold flex items-center gap-2 text-sm">
                    <span className="flex items-center justify-center size-7 rounded-full bg-emerald-600 text-white text-xs font-bold">3</span>
                    Confirmar Conexão
                  </h4>
                  <div className="ml-9 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Depois de configurar o WireGuard e o Every Proxy no celular, clique em <strong>"Testar Proxy"</strong> na aba Testar para verificar se o proxy está funcionando.
                    </p>
                    <Button onClick={testProxyConnection} disabled={proxyTesting} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" size="sm">
                      {proxyTesting ? <><RefreshCw className="size-3.5 animate-spin" /> Testando...</> : <><Activity className="size-3.5" /> Testar Proxy Agora</>}
                    </Button>
                    {proxyTestResult && (
                      <div className={`p-3 rounded-lg border ${proxyTestResult.reachable && proxyTestResult.socks5Valid ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : proxyTestResult.reachable ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'}`}>
                        <div className="flex items-center gap-2">
                          {proxyTestResult.reachable && proxyTestResult.socks5Valid ? (
                            <><Check className="size-4 text-emerald-600" /><span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Proxy SOCKS5 Online!</span></>
                          ) : proxyTestResult.reachable ? (
                            <><AlertTriangle className="size-4 text-amber-600" /><span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Acessível mas não é SOCKS5</span></>
                          ) : (
                            <><X className="size-4 text-rose-600" /><span className="text-xs font-semibold text-rose-700 dark:text-rose-300">Proxy Offline</span></>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{proxyTestResult.message}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* === TEST TAB — Proxy testing === */}
            <TabsContent value="test" className="mt-4">
              <div className="space-y-4">
                <div className="text-center space-y-3 py-4">
                  <div className={`inline-flex items-center justify-center size-20 rounded-full border-4 ${proxyTestResult ? (proxyTestResult.reachable && proxyTestResult.socks5Valid ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : proxyTestResult.reachable ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-rose-500 bg-rose-50 dark:bg-rose-900/20') : 'border-muted bg-muted/50'}`}>
                    {proxyTesting ? (
                      <RefreshCw className="size-8 animate-spin text-muted-foreground" />
                    ) : proxyTestResult ? (
                      proxyTestResult.reachable && proxyTestResult.socks5Valid ? (
                        <Check className="size-8 text-emerald-600" />
                      ) : proxyTestResult.reachable ? (
                        <AlertTriangle className="size-8 text-amber-600" />
                      ) : (
                        <X className="size-8 text-rose-600" />
                      )
                    ) : (
                      <Activity className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      {proxyTestResult ? (proxyTestResult.reachable && proxyTestResult.socks5Valid ? 'Proxy Online' : proxyTestResult.reachable ? 'Parcialmente Acessível' : 'Proxy Offline') : 'Aguardando Teste'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedChip?.wireguardIp ? `${selectedChip.wireguardIp}:${selectedChip.socksPort || 8080}` : 'Nenhum proxy configurado'}
                    </p>
                  </div>
                </div>

                <Button onClick={testProxyConnection} disabled={proxyTesting} className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  {proxyTesting ? <><RefreshCw className="size-4 animate-spin" /> Testando Conexão...</> : <><Activity className="size-4" /> Testar Proxy</>}
                </Button>

                {proxyTestResult && (
                  <div className={`p-4 rounded-lg border ${proxyTestResult.reachable && proxyTestResult.socks5Valid ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : proxyTestResult.reachable ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'}`}>
                    <p className="text-sm font-medium">{proxyTestResult.message}</p>
                    {!proxyTestResult.reachable && (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>Verifique:</p>
                        <ul className="list-disc ml-4 space-y-0.5">
                          <li>O WireGuard está conectado no celular?</li>
                          <li>O Every Proxy está com SOCKS5 ativado?</li>
                          <li>O IP e porta estão corretos?</li>
                        </ul>
                      </div>
                    )}
                    {proxyTestResult.reachable && !proxyTestResult.socks5Valid && (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>O endereço responde, mas não como SOCKS5. Possíveis causas:</p>
                        <ul className="list-disc ml-4 space-y-0.5">
                          <li>O Every Proxy está na aba SOCKS5 (não HTTP)?</li>
                          <li>A porta do Every Proxy confere com a configurada?</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* === MANUAL TAB — Advanced SOCKS5 config === */}
            <TabsContent value="manual" className="mt-4">
              <div className="space-y-4">
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                    <Info className="size-4 shrink-0 mt-0.5" />
                    Configuração manual: use apenas se não estiver usando o WireGuard + Every Proxy. Preencha o host e porta do seu proxy SOCKS5 externo.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Host</Label>
                  <Input placeholder="Ex: 192.168.1.100 ou IP do WireGuard" value={proxyForm.socks5Host} onChange={e => setProxyForm(p => ({ ...p, socks5Host: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Porta</Label>
                  <Input type="number" placeholder="8080" value={proxyForm.socks5Port} onChange={e => setProxyForm(p => ({ ...p, socks5Port: parseInt(e.target.value) || 0 }))} />
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
                <div className="flex gap-2">
                  <Button onClick={() => fetch('/api/proxy/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: proxyForm.socks5Host, port: proxyForm.socks5Port }) }).then(r => r.json()).then(data => setProxyTestResult({ reachable: data.reachable || false, socks5Valid: data.socks5Valid || false, message: data.message || data.error || 'Resultado desconhecido' })).catch(() => setProxyTestResult({ reachable: false, socks5Valid: false, message: 'Erro ao testar' }))} disabled={!proxyForm.socks5Host || !proxyForm.socks5Port} variant="outline" className="gap-1.5">
                    <Activity className="size-3.5" /> Testar
                  </Button>
                  <Button onClick={saveProxy} className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                    <Check className="size-3.5" /> Salvar Proxy
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
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
  const [editContactDialog, setEditContactDialog] = useState(false)
  const [editContact, setEditContact] = useState<ContactItem | null>(null)
  const [editContactForm, setEditContactForm] = useState({ name: '', phone: '' })
  const [deleteContactConfirm, setDeleteContactConfirm] = useState<string | null>(null)
  const [quickImportOpen, setQuickImportOpen] = useState(false)
  const [quickImportName, setQuickImportName] = useState('')
  const [quickImportFile, setQuickImportFile] = useState<File | null>(null)
  const [quickImporting, setQuickImporting] = useState(false)

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
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar contatos')
      setContacts(Array.isArray(data) ? data : data.contacts || [])
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao importar')
      const colInfo = data.detectedColumns ? ` | Colunas: ${data.detectedColumns.map((c: any) => c.name).join(', ')}` : ''
      toast.success(`${data.imported} contatos importados!${colInfo}`)
      setImportDialogOpen(false)
      fetchContacts(selectedList.id)
      fetchLists()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar contatos')
    }
  }

  const openEditContact = (contact: ContactItem) => {
    setEditContact(contact)
    setEditContactForm({ name: contact.name, phone: contact.phone })
    setEditContactDialog(true)
  }

  const saveEditContact = async () => {
    if (!editContact) return
    try {
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editContactForm),
      })
      if (!res.ok) throw new Error()
      toast.success('Contato atualizado!')
      setEditContactDialog(false)
      if (selectedList) fetchContacts(selectedList.id)
    } catch { toast.error('Erro ao atualizar contato') }
  }

  const deleteContact = async (id: string) => {
    try {
      await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
      toast.success('Contato removido!')
      if (selectedList) fetchContacts(selectedList.id)
    } catch { toast.error('Erro ao remover contato') }
  }

  // Quick import: create list + import file in one step
  const handleQuickImport = async () => {
    if (!quickImportName.trim() || !quickImportFile) return
    setQuickImporting(true)
    try {
      // 1. Create list
      toast.loading('Criando lista...', { id: 'quick-import' })
      const listRes = await fetch('/api/contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quickImportName.trim() }),
      })
      const listData = await listRes.json()
      if (!listRes.ok) {
        toast.dismiss('quick-import')
        throw new Error(listData.error || 'Erro ao criar lista')
      }

      // 2. Import file into the new list
      toast.loading('Importando contatos...', { id: 'quick-import' })
      const formData = new FormData()
      formData.append('file', quickImportFile)
      const importRes = await fetch(`/api/contact-lists/${listData.id}/import`, {
        method: 'POST',
        body: formData,
      })
      const importData = await importRes.json()
      if (!importRes.ok) {
        toast.dismiss('quick-import')
        throw new Error(importData.error || 'Erro ao importar')
      }

      const colInfo = importData.detectedColumns ? ` | Colunas: ${importData.detectedColumns.map((c: any) => c.name).join(', ')}` : ''
      toast.success(`Lista "${quickImportName}" criada com ${importData.imported} contatos!${colInfo}`, { id: 'quick-import', duration: 5000 })
      setQuickImportOpen(false)
      setQuickImportName('')
      setQuickImportFile(null)
      await fetchLists()
      setSelectedList(listData)
      // Small delay to ensure DB is synced before fetching contacts
      setTimeout(() => fetchContacts(listData.id), 500)
    } catch (err: any) {
      console.error('Quick import error:', err)
      toast.error(err.message || 'Erro na importação', { duration: 8000 })
    } finally {
      setQuickImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Contatos</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas listas e contatos</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={() => {
            const a = document.createElement('a')
            a.href = '/templates/modelo_contatos.xlsx'
            a.download = 'modelo_contatos_octupuszap.xlsx'
            a.click()
            toast.success('Planilha XLSX baixada!')
          }}>
            <Download className="size-4" /> Baixar Modelo
          </Button>
          <Button variant="outline" className="gap-2" onClick={async () => {
            try {
              const res = await fetch('/api/templates/download?format=csv')
              const csv = await res.text()
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              window.open('https://docs.google.com/spreadsheets/create', '_blank')
              const a = document.createElement('a')
              a.href = url
              a.download = 'modelo_contatos_octupuszap.csv'
              a.click()
              URL.revokeObjectURL(url)
              toast.success('CSV baixado! No Google Sheets: Arquivo → Importar → Enviar', { duration: 8000 })
            } catch { toast.error('Erro ao gerar CSV') }
          }}>
            <FileSpreadsheet className="size-4" /> Google Sheets
          </Button>
          <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg" onClick={() => setQuickImportOpen(true)}>
            <Upload className="size-4" /> Importar Planilha
          </Button>
          <Dialog open={addListDialog} onOpenChange={setAddListDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
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
              <Upload className="size-4" /> Importar Planilha
            </Button>
          </div>

          {contacts.length === 0 ? (
            <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="size-10 text-muted-foreground mb-3" />
                <p className="font-semibold">Nenhum contato nesta lista</p>
                <p className="text-sm text-muted-foreground mb-4">Importe uma planilha ou adicione manualmente</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="gap-1.5" onClick={() => setImportDialogOpen(true)}>
                    <Upload className="size-4" /> Importar Planilha
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={() => setAddContactDialog(true)}>
                    <UserPlus className="size-4" /> Adicionar Contato
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
              <CardContent className="p-0">
                <ScrollArea className="max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-3 font-medium">Nome</th>
                        <th className="text-left p-3 font-medium">Telefone</th>
                        {/* Dynamic custom field columns */}
                        {contacts.some(c => c.customFields) && (() => {
                          const customKeys = new Set<string>()
                          contacts.forEach(c => {
                            if (c.customFields) {
                              try { Object.keys(JSON.parse(c.customFields)).forEach(k => customKeys.add(k)) } catch {}
                            }
                          })
                          return Array.from(customKeys).sort().map(k => (
                            <th key={k} className="text-left p-3 font-medium capitalize">{k.replace(/_/g, ' ')}</th>
                          ))
                        })()}
                        <th className="text-left p-3 font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map(c => {
                        let customData: Record<string, string> = {}
                        if (c.customFields) {
                          try { customData = JSON.parse(c.customFields) } catch {}
                        }
                        return (
                          <tr key={c.id} className="border-t hover:bg-muted/30 transition-colors">
                            <td className="p-3 font-medium">{c.name}</td>
                            <td className="p-3 text-muted-foreground">{c.phone}</td>
                            {/* Dynamic custom field values */}
                            {contacts.some(c2 => c2.customFields) && (() => {
                              const customKeys = new Set<string>()
                              contacts.forEach(c2 => {
                                if (c2.customFields) {
                                  try { Object.keys(JSON.parse(c2.customFields)).forEach(k => customKeys.add(k)) } catch {}
                                }
                              })
                              return Array.from(customKeys).sort().map(k => (
                                <td key={k} className="p-3 text-muted-foreground text-xs">{customData[k] || '-'}</td>
                              ))
                            })()}
                            <td className="p-3">
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600" onClick={() => openEditContact(c)}>
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600" onClick={() => setDeleteContactConfirm(c.id)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
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
              <Card className="shadow-lg hover:shadow-xl transition-all duration-200 cursor-pointer border-0" onClick={() => { setSelectedList(list); fetchContacts(list.id) }}>
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
            <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200 col-span-full">
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

      <ConfirmDialog open={!!deleteContactConfirm} onOpenChange={() => setDeleteContactConfirm(null)}
        title="Remover Contato" description="Tem certeza que deseja remover este contato?"
        onConfirm={() => { if (deleteContactConfirm) deleteContact(deleteContactConfirm) }} confirmLabel="Remover" variant="destructive" />

      {/* Edit Contact Dialog */}
      <Dialog open={editContactDialog} onOpenChange={setEditContactDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Contato</DialogTitle><DialogDescription>Atualize as informações do contato</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Nome</Label><Input value={editContactForm.name} onChange={e => setEditContactForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={editContactForm.phone} onChange={e => setEditContactForm(p => ({ ...p, phone: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveEditContact} disabled={!editContactForm.name || !editContactForm.phone} className="bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Import Dialog (inside a list) */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importar Planilha</DialogTitle><DialogDescription>Importe contatos de um arquivo CSV, Excel ou ODS</DialogDescription></DialogHeader>
          <div className="py-4 space-y-4">
            <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-emerald-400 transition-colors">
              <Upload className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">Arraste o arquivo aqui</p>
              <p className="text-sm text-muted-foreground mb-3">CSV, Excel (.xlsx, .xls) ou LibreOffice (.ods)</p>
              <Input type="file" accept=".csv,.xlsx,.xls,.ods" onChange={handleImport} className="max-w-xs mx-auto" />
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-3">
              <p className="font-medium">Formato da planilha:</p>
              <p className="text-muted-foreground">A coluna <strong>Telefone</strong> é obrigatória. As demais colunas ficam disponíveis como variáveis {'{{nome}}'}, {'{{empresa}}'}, {'{{vendedor}}'} etc. no texto da mensagem. Adicione quantas colunas quiser!</p>
              <code className="block bg-muted p-2 rounded text-[11px]">Empresa,Nome,Telefone,Vendedor,Nota{'\n'}Tech Corp,João,11999990001,Renato,VIP{'\n'}Info Ltda,Maria,21988880002,Carlos,</code>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Import Dialog — create list + import in one step */}
      <Dialog open={quickImportOpen} onOpenChange={(open) => { setQuickImportOpen(open); if (!open) { setQuickImportName(''); setQuickImportFile(null) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importar Planilha</DialogTitle><DialogDescription>Crie uma lista e importe contatos em um passo só</DialogDescription></DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">Nome da Lista <span className="text-rose-500 text-sm">*</span></Label>
              <Input placeholder="Ex: Leads Black Friday (obrigatório)" value={quickImportName} onChange={e => setQuickImportName(e.target.value)} className={!quickImportName.trim() && quickImportFile ? 'border-amber-400 focus:border-amber-500' : ''} />
              {!quickImportName.trim() && quickImportFile && (
                <p className="text-xs text-amber-600 font-medium">⚠ Preencha o nome da lista para ativar o botão de importação</p>
              )}
            </div>
            <div className="border-2 border-dashed rounded-xl p-6 text-center hover:border-emerald-400 transition-colors">
              {quickImportFile ? (
                <div className="flex items-center gap-3 justify-center">
                  <FileSpreadsheet className="size-8 text-emerald-500" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{quickImportFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(quickImportFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="ghost" size="sm" className="ml-2" onClick={() => setQuickImportFile(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="size-8 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">Selecione o arquivo</p>
                  <p className="text-sm text-muted-foreground mb-3">CSV, Excel (.xlsx, .xls) ou LibreOffice (.ods)</p>
                </>
              )}
              <Input type="file" accept=".csv,.xlsx,.xls,.ods" onChange={e => {
                const file = e.target.files?.[0] || null
                setQuickImportFile(file)
                // Auto-fill list name from filename if field is empty
                if (file && !quickImportName.trim()) {
                  const nameFromFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
                  setQuickImportName(nameFromFile)
                }
              }} className="max-w-xs mx-auto" />
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-2">
              <p className="font-medium">Não tem uma planilha?</p>
              <p className="text-muted-foreground">Baixe o modelo, preencha com seus dados e importe. Qualquer coluna que você adicionar vira uma variável automática!</p>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={() => {
                  const a = document.createElement('a')
                  a.href = '/templates/modelo_contatos.xlsx'
                  a.download = 'modelo_contatos_octupuszap.xlsx'
                  a.click()
                  toast.success('Modelo XLSX baixado!')
                }}>
                  <Download className="size-3" /> Baixar XLSX
                </Button>
                <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={async () => {
                  try {
                    const res = await fetch('/api/templates/download?format=csv')
                    const csv = await res.text()
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    window.open('https://docs.google.com/spreadsheets/create', '_blank')
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'modelo_contatos_octupuszap.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                    toast.success('CSV baixado! No Google Sheets: Arquivo → Importar → Enviar', { duration: 8000 })
                  } catch { toast.error('Erro ao gerar CSV') }
                }}>
                  <FileSpreadsheet className="size-3" /> Google Sheets
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {!quickImportFile && !quickImportName.trim() && (
              <p className="text-xs text-amber-600 text-center font-medium">⚠ Preencha o nome da lista e selecione um arquivo para importar</p>
            )}
            {quickImportFile && !quickImportName.trim() && (
              <p className="text-xs text-amber-600 text-center font-medium">⚠ Digite um nome para a lista acima</p>
            )}
            {!quickImportFile && quickImportName.trim() && (
              <p className="text-xs text-amber-600 text-center font-medium">⚠ Selecione um arquivo para importar</p>
            )}
            <div className="flex gap-2 w-full justify-end">
              <DialogClose asChild><Button variant="outline" disabled={quickImporting}>Cancelar</Button></DialogClose>
              <Button onClick={handleQuickImport} disabled={!quickImportName.trim() || !quickImportFile || quickImporting} className="bg-emerald-600 hover:bg-emerald-700 gap-2 min-w-[200px]">
                {quickImporting ? <><RefreshCw className="size-4 animate-spin" /> Importando...</> : <><Upload className="size-4" /> Criar Lista e Importar</>}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Campanhas Tab =====
// Step form type for campaign creation
type StepForm = {
  content: string
  delayMinutes: number
  mediaFile: File | null
  mediaUrl: string
  mediatype: string
  caption: string
  linkUrl: string
  linkPreview: boolean
  contactName: string
  contactPhone: string
  locationLat: string
  locationLng: string
  locationName: string
  variations: { content: string; mediaFile: File | null; mediaUrl: string; mediatype: string; caption: string; linkUrl: string; linkPreview: boolean; contactName: string; contactPhone: string; locationLat: string; locationLng: string; locationName: string }[]
}

// ===== MessageBuilder Component =====
// Visual message editor with inline KEY blocks, variable chips, and WhatsApp preview

// Helper: parse {{KEY: var1 | var2 | var3}} blocks from text
function parseKeyBlocksFromText(text: string): Array<{ fullMatch: string; variations: string[] }> {
  const blocks: Array<{ fullMatch: string; variations: string[] }> = []
  // Match {{KEY: ...}} but handle nested {{variable}} inside
  // Strategy: find {{KEY: then match until the matching }}
  const regex = /\{\{KEY:\s*/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const startIdx = match.index
    let depth = 0
    let i = startIdx + match[0].length
    // Skip past "KEY:" part, now find the closing }}
    // We need to find the matching }} accounting for nested {{ }}
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++
        i++ // skip next {
      } else if (text[i] === '}' && text[i + 1] === '}') {
        if (depth > 0) {
          depth--
          i++ // skip next }
        } else {
          // Found the closing }}
          const innerContent = text.slice(startIdx + match[0].length, i)
          const fullMatch = text.slice(startIdx, i + 2)
          const variations = innerContent.split('|').map(s => s.trim()).filter(Boolean)
          blocks.push({ fullMatch, variations })
          break
        }
      }
    }
    // Prevent infinite loop
    if (match.index === regex.lastIndex) regex.lastIndex++
  }
  return blocks
}

// Helper: generate preview text replacing KEY blocks and contact variables
function generatePreviewText(text: string, messageKeys: Array<{ id: string; name: string; label: string; category: string; variations: string }>, seed: number, contactVariables?: Array<{ tag: string; label: string; source: string }>): string {
  // First, resolve {{KEY: ...}} blocks — pick a deterministic variation based on seed
  let preview = text.replace(/\{\{KEY:\s*((?:[^{}]|\{\{[^}]*\}\})*)\}\}/g, (_, inner) => {
    const options = inner.split('|').map((s: string) => s.trim()).filter(Boolean)
    if (options.length === 0) return ''
    const idx = seed % options.length
    return options[idx]
  })

  // Replace old-style {{KEY_NAME}} with first variation from messageKeys (backward compat)
  messageKeys.forEach(k => {
    try {
      const vars = JSON.parse(k.variations)
      if (vars?.length) preview = preview.replace(new RegExp(`\\{\\{${k.name}\\}\\}`, 'g'), vars[0])
    } catch { /* ignore */ }
  })

  // Replace contact variables dynamically
  // Sample data for preview
  const sampleData: Record<string, string> = {
    nome: 'João',
    telefone: '11999990001',
    empresa: 'Tech Corp',
    vendedor: 'Renato',
    nota: 'VIP',
  }

  // Use contactVariables if available, otherwise fallback to hardcoded
  if (contactVariables && contactVariables.length > 0) {
    preview = preview.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (match, varName) => {
      const key = varName.toLowerCase()
      if (sampleData[key]) return sampleData[key]
      // For unknown custom variables, show the label
      const cv = contactVariables.find(v => v.tag === `{{${key}}}`)
      return cv ? cv.label : match
    })
  } else {
    // Fallback: only replace known variables
    preview = preview
      .replace(/\{\{nome\}\}/g, 'João')
      .replace(/\{\{telefone\}\}/g, '11999990001')
      .replace(/\{\{empresa\}\}/g, 'Tech Corp')
      .replace(/\{\{vendedor\}\}/g, 'Renato')
  }

  // Strip WhatsApp bold markers
  preview = preview.replace(/\*([^*]+)\*/g, '$1')
  return preview
}

function MessageBuilder({ value, onChange, messageKeys, templates, contactVariables, rows = 3 }: {
  value: string
  onChange: (v: string) => void
  messageKeys: Array<{ id: string; name: string; label: string; category: string; variations: string }>
  templates?: MessageTemplate[]
  contactVariables?: Array<{ tag: string; label: string; source: string }>
  rows?: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [newBlockOpen, setNewBlockOpen] = useState(false)
  const [newBlockVariations, setNewBlockVariations] = useState('')
  const [previewSeed, setPreviewSeed] = useState(0)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')

  // Parse KEY blocks from current text
  const keyBlocks = parseKeyBlocksFromText(value)

  // Insert text at cursor position
  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = value.substring(0, start) + text + value.substring(end)
      onChange(newValue)
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + text.length
        textarea.focus()
      }, 0)
    } else {
      onChange(value + text)
    }
  }

  // Insert new KEY block
  const insertNewBlock = () => {
    const lines = newBlockVariations.split('\n').map(l => l.trim()).filter(Boolean)
    // Also support | separator within lines
    const allVariations: string[] = []
    lines.forEach(line => {
      line.split('|').forEach(v => {
        const trimmed = v.trim()
        if (trimmed) allVariations.push(trimmed)
      })
    })
    if (allVariations.length < 2) {
      toast.error('Adicione pelo menos 2 variações separadas por | ou uma por linha')
      return
    }
    const keyBlock = `{{KEY: ${allVariations.join(' | ')}}}`
    insertAtCursor(keyBlock)
    setNewBlockVariations('')
    setNewBlockOpen(false)
  }

  const previewText = generatePreviewText(value, messageKeys, previewSeed, contactVariables)
  const charCount = previewText.length
  const lineCount = value.split('\n').length

  return (
    <div className="space-y-2">
      {/* Variable chips bar */}
      <div className="space-y-1.5 p-2 bg-muted/30 rounded-lg border">
        {/* Contact variables */}
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground font-medium w-full">📋 Dados do Contato</span>
          {(contactVariables && contactVariables.length > 0 ? contactVariables : CONTACT_VARIABLES).map(v => (
            <Button key={v.tag} variant="outline" size="sm"
              className={`h-6 text-[11px] gap-1 px-2 ${
                v.source === 'custom'
                  ? 'text-sky-600 border-sky-200 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-800 dark:hover:bg-sky-900/30'
                  : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30'
              }`}
              onClick={() => insertAtCursor(v.tag)}>
              {v.source === 'custom' ? '📎' : v.tag === '{{nome}}' ? '👤' : v.tag === '{{telefone}}' ? '📱' : '📋'} {v.label}
            </Button>
          ))}
          {(!contactVariables || contactVariables.length === 0) && (
            <span className="text-[9px] text-muted-foreground italic">Selecione uma lista de contatos para ver as variáveis disponíveis</span>
          )}
        </div>
        {/* KEY block chips */}
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground font-medium w-full">🔀 Blocos de Variação</span>
          {keyBlocks.map((block, idx) => {
            const firstVar = block.variations[0] || ''
            const extraCount = block.variations.length - 1
            const truncated = firstVar.length > 25 ? firstVar.slice(0, 25) + '…' : firstVar
            return (
              <Popover key={idx}>
                <PopoverTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
                  >
                    <Shuffle className="size-2.5" />
                    <span className="truncate max-w-[120px]">{truncated}</span>
                    {extraCount > 0 && (
                      <span className="inline-flex items-center justify-center size-4 rounded-full bg-amber-200 text-amber-700 text-[9px] font-bold dark:bg-amber-800 dark:text-amber-200">
                        +{extraCount}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" side="bottom" align="start">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold flex items-center gap-1">
                      <Shuffle className="size-3 text-amber-500" /> Bloco de Variação ({block.variations.length} variações)
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {block.variations.map((v, vi) => (
                        <div key={vi} className="flex items-start gap-2 text-xs p-1.5 rounded bg-muted/50">
                          <span className="text-muted-foreground font-mono shrink-0">{vi + 1}.</span>
                          <span className="break-words">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )
          })}
          {/* Saved keys from Chaves tab */}
          {messageKeys.map(k => {
            let varCount = 0
            try { varCount = JSON.parse(k.variations).length } catch { /* ignore */ }
            return (
              <Popover key={k.id}>
                <PopoverTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50 transition-colors cursor-pointer"
                  >
                    <Key className="size-2.5" />
                    <span className="truncate max-w-[100px]">{k.label}</span>
                    <span className="inline-flex items-center justify-center size-4 rounded-full bg-violet-200 text-violet-700 text-[9px] font-bold dark:bg-violet-800 dark:text-violet-200">
                      {varCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" side="bottom" align="start">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold flex items-center gap-1">
                      <Key className="size-3 text-violet-500" /> {k.label} ({varCount} variações)
                    </p>
                    <p className="text-[10px] text-muted-foreground">Clique para inserir como bloco inline ou como marcador</p>
                    <div className="space-y-1.5">
                      <Button size="sm" className="w-full h-7 text-[11px] gap-1" variant="outline"
                        onClick={() => {
                          try {
                            const vars = JSON.parse(k.variations)
                            if (vars?.length) {
                              insertAtCursor(`{{KEY: ${vars.join(' | ')}}}`)
                            }
                          } catch { /* ignore */ }
                        }}>
                        <Shuffle className="size-3" /> Inserir como Bloco Inline
                      </Button>
                      <Button size="sm" className="w-full h-7 text-[11px] gap-1" variant="outline"
                        onClick={() => insertAtCursor(`{{${k.name}}}`)}>
                        <Key className="size-3" /> Inserir como Marcador
                      </Button>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {(() => {
                        try {
                          return JSON.parse(k.variations).map((v: string, vi: number) => (
                            <div key={vi} className="flex items-start gap-2 text-xs p-1.5 rounded bg-muted/50">
                              <span className="text-muted-foreground font-mono shrink-0">{vi + 1}.</span>
                              <span className="break-words">{v}</span>
                            </div>
                          ))
                        } catch { return null }
                      })()}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )
          })}
          {/* Usar Template button */}
          {templates && templates.length > 0 && (
            <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm"
                  className="h-6 text-[11px] gap-1 px-2 text-sky-600 border-sky-200 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-800 dark:hover:bg-sky-900/30 border-dashed">
                  <FileText className="size-2.5" /> Usar Template
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" side="bottom" align="start">
                <div className="space-y-2">
                  <p className="text-xs font-semibold flex items-center gap-1">
                    <FileText className="size-3 text-sky-500" /> Selecionar Template
                  </p>
                  <Input
                    placeholder="Buscar template..."
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    className="h-7 text-xs"
                  />
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {templates
                      .filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.content.toLowerCase().includes(templateSearch.toLowerCase()))
                      .map(t => (
                        <button
                          key={t.id}
                          className="w-full text-left p-2 rounded-md hover:bg-muted/80 transition-colors group"
                          onClick={() => {
                            onChange(t.content)
                            setTemplatePickerOpen(false)
                            setTemplateSearch('')
                            toast.success(`Template "${t.name}" carregado!`)
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate">{t.name}</span>
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${{
                              'saudação': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                              'vendas': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                              'follow-up': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
                              'pós-venda': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
                              'geral': 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400',
                            }[t.category] || 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400'}`}>{t.category}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{t.content}</p>
                        </button>
                      ))}
                    {templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.content.toLowerCase().includes(templateSearch.toLowerCase())).length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-2">Nenhum template encontrado</p>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {/* + Novo Bloco button */}
          <Popover open={newBlockOpen} onOpenChange={setNewBlockOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm"
                className="h-6 text-[11px] gap-1 px-2 text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/30 border-dashed">
                <Plus className="size-2.5" /> Novo Bloco
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" side="bottom" align="start">
              <div className="space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Shuffle className="size-3 text-amber-500" /> Novo Bloco de Variação
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Digite as variações separadas por <code className="bg-muted px-1 rounded">|</code> ou uma por linha. Pode usar variáveis como {'{{nome}}'} dentro das variações.
                </p>
                <Textarea
                  placeholder={"Oi, bom dia... tudo bem? | Olá, tudo bem? Bom dia... | Bom dia! Tudo bem?"}
                  value={newBlockVariations}
                  onChange={e => setNewBlockVariations(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {(() => {
                      const lines = newBlockVariations.split('\n').map(l => l.trim()).filter(Boolean)
                      const allVars: string[] = []
                      lines.forEach(line => {
                        line.split('|').forEach(v => {
                          const t = v.trim()
                          if (t) allVars.push(t)
                        })
                      })
                      return allVars.length > 0 ? `${allVars.length} variação(ões) detectada(s)` : 'Separe variações com | ou Enter'
                    })()}
                  </span>
                  <Button size="sm" className="h-7 text-[11px] gap-1 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={insertNewBlock}
                    disabled={!newBlockVariations.trim()}>
                    <Plus className="size-3" /> Inserir
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Main text area */}
      <Textarea
        ref={textareaRef}
        placeholder="Texto da mensagem... Use {{nome}}, {{KEY: var1 | var2}} para variações"
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className="text-sm font-mono"
      />

      {/* WhatsApp Preview */}
      {value.trim() && (
        <div className="border rounded-xl overflow-hidden shadow-sm">
          <div className="bg-[#0b141a] px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Smartphone className="size-3.5 text-emerald-400" />
              <span className="text-[11px] text-emerald-400 font-medium">WhatsApp Preview</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 ml-1 text-white/40 hover:text-white/80 hover:bg-transparent"
                onClick={() => setPreviewSeed(s => s + 1)}
                title="Alternar variação"
              >
                <RefreshCw className="size-3" />
              </Button>
              <span className="text-[11px] text-white/30 ml-auto">{charCount} chars · {lineCount} linha(s)</span>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-[#005c4b] rounded-lg rounded-tr-none px-3.5 py-2.5">
                <p className="text-[13px] text-white/90 whitespace-pre-wrap break-words leading-[1.5]">{previewText}</p>
                <p className="text-[10px] text-white/40 text-right mt-1">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ✓✓</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CampanhasTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([])
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [availableLists, setAvailableLists] = useState<ContactList[]>([])
  const [messageKeys, setMessageKeys] = useState<Array<{ id: string; name: string; label: string; category: string; variations: string }>>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [contactVariables, setContactVariables] = useState<Array<{ tag: string; label: string; source: string }>>([])
  const [activeStep, setActiveStep] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
  })

  const [newCampaign, setNewCampaign] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
  })

  const resetNewCampaign = () => setNewCampaign({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, mediaFile: null, mediaUrl: '', mediatype: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
  })

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns')
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : [])
    }
    catch { toast.error('Erro ao carregar campanhas') } finally { setLoading(false) }
  }, [])
  const fetchChips = useCallback(async () => {
    try { const res = await fetch('/api/chips'); setAvailableChips(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchLists = useCallback(async () => {
    try { const res = await fetch('/api/contact-lists'); setAvailableLists(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchKeys = useCallback(async () => {
    try { const res = await fetch('/api/keys'); setMessageKeys(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchTemplates = useCallback(async () => {
    try { const res = await fetch('/api/templates'); setTemplates(await res.json()) } catch { /* empty */ }
  }, [])

  // Fetch available variables from the selected contact list
  const fetchContactVariables = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/contact-lists/${listId}/contacts?limit=1`)
      const data = await res.json()
      if (data.availableVariables) {
        setContactVariables(data.availableVariables)
      } else {
        setContactVariables([])
      }
    } catch {
      setContactVariables([])
    }
  }, [])

  useEffect(() => { fetchCampaigns(); fetchChips(); fetchLists(); fetchKeys(); fetchTemplates() }, [fetchCampaigns, fetchChips, fetchLists, fetchKeys, fetchTemplates])

  // When contact list changes, fetch available variables
  useEffect(() => {
    if (newCampaign.contactListId) {
      fetchContactVariables(newCampaign.contactListId)
    } else {
      setContactVariables([])
    }
  }, [newCampaign.contactListId, fetchContactVariables])

  const createCampaign = async () => {
    try {
      // Upload media and build steps payload
      const stepsPayload: Array<{ stepOrder: number; content: string; delayMinutes: number; mediaUrl?: string; mediatype?: string; variations: string }> = []

      for (let i = 0; i < newCampaign.steps.length; i++) {
        const s = newCampaign.steps[i]
        let mediaUrl = s.mediaUrl || ''
        let mediatype = s.mediatype || ''

        // Upload step media if present
        if (s.mediaFile && mediatype) {
          const uploadForm = new FormData()
          uploadForm.append('file', s.mediaFile)
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm })
          const uploadData = await uploadRes.json()
          if (!uploadRes.ok) throw new Error(uploadData.error || 'Erro ao fazer upload da mídia')
          mediaUrl = uploadData.mediaUrl
          mediatype = uploadData.mediatype
        }

        // Upload media for each variation
        const variationsWithMedia: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        for (const v of s.variations) {
          if (!v.content.trim()) continue
          let vMediaUrl = v.mediaUrl || ''
          let vMediatype = v.mediatype || ''

          if (v.mediaFile && vMediatype) {
            const uploadForm = new FormData()
            uploadForm.append('file', v.mediaFile)
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm })
            const uploadData = await uploadRes.json()
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Erro ao fazer upload da mídia')
            vMediaUrl = uploadData.mediaUrl
            vMediatype = uploadData.mediatype
          }

          variationsWithMedia.push({ content: v.content, mediaUrl: vMediaUrl || undefined, mediatype: vMediatype || undefined })
        }

        stepsPayload.push({
          stepOrder: i + 1,
          content: s.content,
          delayMinutes: s.delayMinutes,
          mediaUrl: mediaUrl || undefined,
          mediatype: mediatype || undefined,
          variations: JSON.stringify(variationsWithMedia),
        })
      }

      const payload = {
        name: newCampaign.name, sendIntervalMin: newCampaign.sendIntervalMin, sendIntervalMax: newCampaign.sendIntervalMax,
        chipIds: newCampaign.chipIds, contactListId: newCampaign.contactListId || null,
        scheduledAt: newCampaign.scheduledAt ? new Date(newCampaign.scheduledAt).toISOString() : null,
        steps: stepsPayload, antiBanEnabled: newCampaign.antiBanEnabled, warmingMode: newCampaign.warmingMode,
      }
      const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error) }
      toast.success('Campanha criada com sucesso!')
      setCreateDialogOpen(false); resetNewCampaign(); fetchCampaigns()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao criar campanha') }
  }

  const startCampaignAction = async (id: string) => {
    try {
      const res = await fetch(`/api/campaigns/${id}/start`, { method: 'POST' })
      let data
      try { data = await res.json() } catch { data = {} }
      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar campanha')
      toast.success(`Campanha iniciada! ${data.messageCount || 0} mensagens criadas.`)
      fetchCampaigns()
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro ao iniciar campanha'
      toast.error(msg)
      console.error('Campaign start error:', err)
    }
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

  const processAllCampaigns = async () => {
    setProcessing(true)
    try {
      const res = await fetch('/api/campaigns/process-all', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao processar campanhas')
      const processed = data.processed ?? data.startedScheduled ?? 0
      toast.success(`${processed} campanha(s) processada(s) com sucesso!`)
      fetchCampaigns()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao processar campanhas')
    } finally {
      setProcessing(false)
    }
  }

  const openDetail = async (campaign: Campaign) => {
    setSelectedCampaign(campaign); setDetailDialogOpen(true); setEditing(false)
    try { const res = await fetch(`/api/messages?campaignId=${campaign.id}`); const data = await res.json(); setDetailMessages(Array.isArray(data) ? data : []) }
    catch { setDetailMessages([]) }
  }

  const toggleChip = (chipId: string) => {
    setNewCampaign(prev => ({
      ...prev,
      chipIds: prev.chipIds.includes(chipId) ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId],
    }))
  }

  const addStep = () => setNewCampaign(prev => ({ ...prev, steps: [...prev.steps, { content: '', delayMinutes: 60, mediaFile: null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] }))
  const removeStep = (idx: number) => setNewCampaign(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  const updateStep = (idx: number, field: 'content' | 'delayMinutes' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | number | File | boolean | null) => {
    setNewCampaign(prev => { const steps = [...prev.steps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, steps } })
  }

  // Variation helpers (within a step)
  const addVariation = (stepIdx: number) => setNewCampaign(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: [...steps[stepIdx].variations, { content: '', mediaFile: null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }
    return { ...prev, steps }
  })
  const removeVariation = (stepIdx: number, varIdx: number) => setNewCampaign(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: steps[stepIdx].variations.filter((_, i) => i !== varIdx) }
    return { ...prev, steps }
  })
  const updateVariation = (stepIdx: number, varIdx: number, field: 'content' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | File | boolean | null) => {
    setNewCampaign(prev => {
      const steps = [...prev.steps]
      const vars = [...steps[stepIdx].variations]
      vars[varIdx] = { ...vars[varIdx], [field]: value }
      steps[stepIdx] = { ...steps[stepIdx], variations: vars }
      return { ...prev, steps }
    })
  }

  const canCreate = newCampaign.name.trim() && newCampaign.chipIds.length > 0 &&
    newCampaign.steps.some(s => s.content.trim() || s.variations.some(v => v.content.trim()))

  // ─── Edit Campaign Helpers ──────────────────────────────────
  const startEditing = (campaign: Campaign) => {
    const steps: StepForm[] = (campaign.sequenceSteps || [])
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map(s => {
        let parsedVars: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        try { parsedVars = JSON.parse(s.variations || '[]') } catch { /* ignore */ }
        return {
          content: s.content || '',
          delayMinutes: s.delayMinutes || 0,
          mediaFile: null as File | null,
          mediaUrl: s.mediaUrl || '',
          mediatype: s.mediatype || '',
          variations: parsedVars.length > 0
            ? parsedVars.map(v => ({ content: v.content, mediaFile: null as File | null, mediaUrl: v.mediaUrl || '', mediatype: v.mediatype || '' }))
            : [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }],
        }
      })
    if (steps.length === 0) {
      steps.push({ content: '', delayMinutes: 0, mediaFile: null, mediaUrl: '', mediatype: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] })
    }
    setEditForm({
      name: campaign.name,
      sendIntervalMin: campaign.sendIntervalMin || 30,
      sendIntervalMax: campaign.sendIntervalMax || 90,
      chipIds: (campaign.chips || []).map(cc => cc.chipId),
      contactListId: campaign.contactList?.id || '',
      scheduledAt: campaign.scheduledAt ? new Date(campaign.scheduledAt).toISOString().slice(0, 16) : '',
      steps,
      antiBanEnabled: campaign.antiBanEnabled ?? true,
      warmingMode: campaign.warmingMode || 'normal',
    })
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
  }

  const saveEdit = async () => {
    if (!selectedCampaign) return
    setSaving(true)
    try {
      const stepsPayload: Array<{ stepOrder: number; content: string; delayMinutes: number; mediaUrl?: string; mediatype?: string; variations: string }> = []
      for (let i = 0; i < editForm.steps.length; i++) {
        const s = editForm.steps[i]
        let mediaUrl = s.mediaUrl || ''
        let mediatype = s.mediatype || ''
        if (s.mediaFile && mediatype) {
          const uploadForm = new FormData()
          uploadForm.append('file', s.mediaFile)
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm })
          const uploadData = await uploadRes.json()
          if (!uploadRes.ok) throw new Error(uploadData.error || 'Erro ao fazer upload da mídia')
          mediaUrl = uploadData.mediaUrl
          mediatype = uploadData.mediatype
        }
        const variationsWithMedia: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        for (const v of s.variations) {
          if (!v.content.trim()) continue
          let vMediaUrl = v.mediaUrl || ''
          let vMediatype = v.mediatype || ''
          if (v.mediaFile && vMediatype) {
            const uploadForm = new FormData()
            uploadForm.append('file', v.mediaFile)
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm })
            const uploadData = await uploadRes.json()
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Erro ao fazer upload da mídia')
            vMediaUrl = uploadData.mediaUrl
            vMediatype = uploadData.mediatype
          }
          variationsWithMedia.push({ content: v.content, mediaUrl: vMediaUrl || undefined, mediatype: vMediatype || undefined })
        }
        stepsPayload.push({
          stepOrder: i + 1,
          content: s.content,
          delayMinutes: s.delayMinutes,
          mediaUrl: mediaUrl || undefined,
          mediatype: mediatype || undefined,
          variations: JSON.stringify(variationsWithMedia),
        })
      }
      const payload = {
        name: editForm.name,
        sendIntervalMin: editForm.sendIntervalMin,
        sendIntervalMax: editForm.sendIntervalMax,
        chipIds: editForm.chipIds,
        contactListId: editForm.contactListId || null,
        scheduledAt: editForm.scheduledAt ? new Date(editForm.scheduledAt).toISOString() : null,
        steps: stepsPayload,
        antiBanEnabled: editForm.antiBanEnabled,
        warmingMode: editForm.warmingMode,
      }
      const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Erro ao atualizar campanha') }
      toast.success('Campanha atualizada com sucesso!')
      setEditing(false)
      fetchCampaigns()
      // Refresh selected campaign
      const updated = await fetch(`/api/campaigns/${selectedCampaign.id}`).then(r => r.json())
      setSelectedCampaign(updated)
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao atualizar campanha')
    } finally {
      setSaving(false)
    }
  }

  const editToggleChip = (chipId: string) => {
    setEditForm(prev => ({
      ...prev,
      chipIds: prev.chipIds.includes(chipId) ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId],
    }))
  }
  const editAddStep = () => setEditForm(prev => ({ ...prev, steps: [...prev.steps, { content: '', delayMinutes: 60, mediaFile: null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] }))
  const editRemoveStep = (idx: number) => setEditForm(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  const editUpdateStep = (idx: number, field: 'content' | 'delayMinutes' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | number | File | boolean | null) => {
    setEditForm(prev => { const steps = [...prev.steps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, steps } })
  }
  const editAddVariation = (stepIdx: number) => setEditForm(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: [...steps[stepIdx].variations, { content: '', mediaFile: null, mediaUrl: '', mediatype: '', caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }
    return { ...prev, steps }
  })
  const editRemoveVariation = (stepIdx: number, varIdx: number) => setEditForm(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: steps[stepIdx].variations.filter((_, i) => i !== varIdx) }
    return { ...prev, steps }
  })
  const editUpdateVariation = (stepIdx: number, varIdx: number, field: 'content' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | File | boolean | null) => {
    setEditForm(prev => {
      const steps = [...prev.steps]
      const vars = [...steps[stepIdx].variations]
      vars[varIdx] = { ...vars[varIdx], [field]: value }
      steps[stepIdx] = { ...steps[stepIdx], variations: vars }
      return { ...prev, steps }
    })
  }

  const canSaveEdit = editForm.name.trim() && editForm.chipIds.length > 0 &&
    editForm.steps.some(s => s.content.trim() || s.variations.some(v => v.content.trim()))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas campanhas de envio em massa</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={processAllCampaigns} disabled={processing}>
            {processing ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
            {processing ? 'Processando...' : 'Processar Campanhas'}
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) { resetNewCampaign(); setActiveStep(0) } }}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
                <Plus className="size-4" /> Nova Campanha
              </Button>
            </DialogTrigger>
          <DialogContent className="sm:!max-w-[95vw] !max-w-[95vw] w-[95vw] max-h-[95vh] h-[90vh] p-0 gap-0 overflow-hidden !flex !flex-col" style={{ maxWidth: '95vw', width: '95vw', height: '90vh' }}>
            <DialogHeader className="px-6 py-4 border-b shrink-0">
              <DialogTitle>Criar Campanha</DialogTitle>
              <DialogDescription>Configure uma nova campanha de envio</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left: Configuration Panel - Compact Sidebar */}
              <div className="w-[30%] min-w-[300px] border-r overflow-y-auto p-4 space-y-3 bg-muted/10">
                {/* Campaign Name */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Type className="size-3" /> Nome da Campanha</Label>
                  <Input placeholder="Ex: Campanha Black Friday" value={newCampaign.name} onChange={e => setNewCampaign(prev => ({ ...prev, name: e.target.value }))} className="h-8 text-sm" />
                </div>

                {/* Contact List */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Users className="size-3" /> Lista de Contatos</Label>
                  <Select value={newCampaign.contactListId} onValueChange={v => setNewCampaign(prev => ({ ...prev, contactListId: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                    <SelectContent>
                      {availableLists.map(l => (
                        <SelectItem key={l.id} value={l.id}>
                          <div className="flex items-center gap-2">{l.name}<span className="text-xs text-muted-foreground">({l._count?.contacts || 0})</span></div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Scheduling */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><CalendarDays className="size-3" /> Agendamento</Label>
                  <Input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(prev => ({ ...prev, scheduledAt: e.target.value }))} className="h-8 text-sm" />
                  <p className="text-[10px] text-muted-foreground">Deixe vazio para executar imediatamente</p>
                </div>

                {/* Chips for Sending */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Smartphone className="size-3" /> Chips para envio</Label>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {availableChips.map(chip => (
                      <label key={chip.id} className={`flex items-center gap-2 p-1.5 rounded-md border cursor-pointer transition-all text-sm ${newCampaign.chipIds.includes(chip.id) ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                        <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 ${newCampaign.chipIds.includes(chip.id) ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground'}`}>
                          {newCampaign.chipIds.includes(chip.id) && <Check className="size-3 text-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{chip.name}</p>
                          <p className="text-[10px] text-muted-foreground">{chip.phoneNumber}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Anti-Ban Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Shield className="size-3.5 text-emerald-500" />
                      <Label className="text-xs font-semibold">Proteção Anti-Ban</Label>
                    </div>
                    <Switch checked={newCampaign.antiBanEnabled} onCheckedChange={v => setNewCampaign(prev => ({ ...prev, antiBanEnabled: v }))} />
                  </div>
                  {newCampaign.antiBanEnabled && (
                    <div className="space-y-1.5 p-2.5 bg-muted/50 rounded-lg">
                      <Label className="text-[11px] font-medium">Modo de Aquecimento</Label>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { value: 'normal', label: 'Normal', icon: Shield, desc: 'Equilibrado' },
                          { value: 'agressive', label: 'Agressivo', icon: Flame, desc: 'Mais rápido' },
                          { value: 'stealth', label: 'Furtivo', icon: Snowflake, desc: 'Máx. segurança' },
                        ].map(m => (
                          <button key={m.value} type="button" onClick={() => setNewCampaign(prev => ({ ...prev, warmingMode: m.value }))}
                            className={`p-1.5 rounded-md border text-center transition-all ${newCampaign.warmingMode === m.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                            <m.icon className={`size-3.5 mx-auto mb-0.5 ${newCampaign.warmingMode === m.value ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                            <p className="text-[11px] font-medium">{m.label}</p>
                            <p className="text-[9px] text-muted-foreground">{m.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Message Builder + Preview */}
              <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Editor Panel */}
                <div className="flex-1 flex flex-col min-h-0 border-r">
                  {/* Step Tabs */}
                  <div className="flex items-center gap-1 px-4 pt-2 pb-0 border-b shrink-0 bg-muted/20">
                    {newCampaign.steps.map((step, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors border border-b-0 ${activeStep === idx ? 'bg-background text-emerald-600 border-border' : 'text-muted-foreground hover:text-foreground border-transparent'}`}
                        onClick={() => setActiveStep(idx)}
                      >
                        <span className="flex items-center justify-center size-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">{idx + 1}</span>
                        Mensagem {idx + 1}
                      </button>
                    ))}
                    <Button variant="ghost" size="sm" className="gap-1 text-emerald-600 h-8 px-2" onClick={addStep}>
                      <Plus className="size-3.5" />
                    </Button>
                    {newCampaign.steps.length > 1 && activeStep > 0 && (
                      <Button variant="ghost" size="sm" className="ml-auto text-rose-500 h-8 px-2" onClick={() => { removeStep(activeStep); setActiveStep(Math.max(0, activeStep - 1)) }}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Active Step Content */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {newCampaign.steps.map((step, idx) => idx === activeStep && (
                      <div key={idx} className="space-y-3">
                        {/* Delay config for steps > 0 */}
                        {idx > 0 && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
                            <Clock className="size-3.5" />
                            <span>Atraso antes desta mensagem:</span>
                            <Input type="number" min={0} value={step.delayMinutes} onChange={e => updateStep(idx, 'delayMinutes', parseInt(e.target.value) || 0)} className="w-20 h-7 text-xs" />
                            <span>min após mensagem anterior</span>
                          </div>
                        )}

                        <MessageBuilder value={step.content} onChange={v => updateStep(idx, 'content', v)} messageKeys={messageKeys} templates={templates} contactVariables={contactVariables} rows={10} />

                        {/* Attach media */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium flex items-center gap-1"><Paperclip className="size-3" /> Anexar Mídia</Label>
                          <div className="flex gap-2">
                            <Select value={step.mediatype} onValueChange={v => updateStep(idx, 'mediatype', v)}>
                              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="image">Imagem</SelectItem>
                                <SelectItem value="video">Vídeo</SelectItem>
                                <SelectItem value="audio">Áudio</SelectItem>
                                <SelectItem value="document">Documento</SelectItem>
                                <SelectItem value="contact">Contato</SelectItem>
                                <SelectItem value="location">Localização</SelectItem>
                                <SelectItem value="link">Link</SelectItem>
                              </SelectContent>
                            </Select>
                            {['image','video','audio','document'].includes(step.mediatype) && (
                              <Input type="file" className="h-8 text-xs flex-1" accept={step.mediatype === 'image' ? 'image/*' : step.mediatype === 'video' ? 'video/*' : step.mediatype === 'audio' ? 'audio/*' : undefined} onChange={e => { const f = e.target.files?.[0] || null; updateStep(idx, 'mediaFile', f) }} />
                            )}
                          </div>
                          {['image','video'].includes(step.mediatype) && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Legenda</Label>
                              <Input placeholder="Legenda da imagem/vídeo..." value={step.caption} onChange={e => updateStep(idx, 'caption', e.target.value)} className="h-8 text-xs" />
                            </div>
                          )}
                          {step.mediatype === 'contact' && (
                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="Nome do contato" value={step.contactName} onChange={e => updateStep(idx, 'contactName', e.target.value)} className="h-8 text-xs" />
                              <Input placeholder="Telefone (5511999999999)" value={step.contactPhone} onChange={e => updateStep(idx, 'contactPhone', e.target.value)} className="h-8 text-xs" />
                            </div>
                          )}
                          {step.mediatype === 'location' && (
                            <div className="space-y-2">
                              <Input placeholder="Nome do local" value={step.locationName} onChange={e => updateStep(idx, 'locationName', e.target.value)} className="h-8 text-xs" />
                              <div className="grid grid-cols-2 gap-2">
                                <Input placeholder="Latitude" value={step.locationLat} onChange={e => updateStep(idx, 'locationLat', e.target.value)} className="h-8 text-xs" />
                                <Input placeholder="Longitude" value={step.locationLng} onChange={e => updateStep(idx, 'locationLng', e.target.value)} className="h-8 text-xs" />
                              </div>
                            </div>
                          )}
                          {step.mediatype === 'link' && (
                            <div className="space-y-2">
                              <Input placeholder="https://..." value={step.linkUrl} onChange={e => updateStep(idx, 'linkUrl', e.target.value)} className="h-8 text-xs" />
                              <div className="flex items-center gap-2">
                                <Switch checked={step.linkPreview} onCheckedChange={v => updateStep(idx, 'linkPreview', v)} />
                                <Label className="text-xs">Com visualização (preview)</Label>
                              </div>
                            </div>
                          )}
                          {step.mediaFile && (
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg text-xs">
                              {step.mediatype === 'image' ? <ImageIcon className="size-3.5 text-emerald-500" /> : step.mediatype === 'video' ? <Film className="size-3.5 text-sky-500" /> : step.mediatype === 'audio' ? <Music className="size-3.5 text-amber-500" /> : <File className="size-3.5 text-zinc-500" />}
                              <span className="truncate">{step.mediaFile.name}</span>
                              <span className="text-muted-foreground">({(step.mediaFile.size / 1024).toFixed(1)}KB)</span>
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => updateStep(idx, 'mediaFile', null)}><X className="size-3" /></Button>
                            </div>
                          )}
                        </div>

                        {/* Variations (collapsible) */}
                        <details className="group border rounded-lg">
                          <summary className="flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-muted/30 rounded-lg transition-colors">
                            <div className="flex items-center gap-2">
                              <Shuffle className="size-3.5 text-amber-500" />
                              <Label className="text-xs font-semibold cursor-pointer">Variações da Mensagem {idx + 1}</Label>
                              {step.variations.length > 1 && (
                                <Badge variant="secondary" className="h-4 text-[10px] px-1.5">{step.variations.length}</Badge>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 text-xs text-emerald-600 gap-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); addVariation(idx) }}>
                              <Plus className="size-3" /> Variação
                            </Button>
                          </summary>
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-[11px] text-muted-foreground">Uma variação aleatória será escolhida para cada contato (anti-ban)</p>
                            {step.variations.map((v, vIdx) => (
                              <div key={vIdx} className="relative p-3 border rounded-lg space-y-2 bg-background/50">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-muted-foreground">Variação {vIdx + 1}</span>
                                  {step.variations.length > 1 && (
                                    <Button variant="ghost" size="sm" className="ml-auto text-rose-500 h-5 w-5 p-0" onClick={() => removeVariation(idx, vIdx)}>
                                      <X className="size-3" />
                                    </Button>
                                  )}
                                </div>
                                <Textarea placeholder={`Texto da variação ${vIdx + 1}...`} value={v.content} onChange={e => updateVariation(idx, vIdx, 'content', e.target.value)} rows={2} />
                                <div className="space-y-1.5">
                                  <div className="flex flex-wrap gap-1">
                                    <span className="text-[10px] text-muted-foreground font-medium w-full">📋 Contato</span>
                                    {CONTACT_VARIABLES.map(cv => (
                                      <Button key={cv.tag} variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30" onClick={() => updateVariation(idx, vIdx, 'content', v.content + cv.tag)}>
                                        {cv.icon} {cv.label}
                                      </Button>
                                    ))}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <span className="text-[10px] text-muted-foreground font-medium w-full">🔀 Blocos de Variação</span>
                                    {messageKeys.map(k => {
                                      let varCount = 0
                                      try { varCount = JSON.parse(k.variations).length } catch { /* ignore */ }
                                      return (
                                        <Button key={k.id} variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-900/30" onClick={() => {
                                          try {
                                            const vars = JSON.parse(k.variations)
                                            if (vars?.length) {
                                              updateVariation(idx, vIdx, 'content', v.content + `{{KEY: ${vars.join(' | ')}}}`)
                                            }
                                          } catch {
                                            updateVariation(idx, vIdx, 'content', v.content + `{{${k.name}}}`)
                                          }
                                        }} title={`${k.label} — ${varCount} variações`}>
                                          <Shuffle className="size-2.5" /> {k.label}
                                        </Button>
                                      )
                                    })}
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground">Se tiver mídia, o texto será a legenda/descrição</p>
                                {/* Anexar (variation) */}
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <Select value={v.mediatype} onValueChange={mt => updateVariation(idx, vIdx, 'mediatype', mt)}>
                                      <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="image">Imagem</SelectItem>
                                        <SelectItem value="video">Vídeo</SelectItem>
                                        <SelectItem value="audio">Áudio</SelectItem>
                                        <SelectItem value="document">Documento</SelectItem>
                                        <SelectItem value="contact">Contato</SelectItem>
                                        <SelectItem value="location">Localização</SelectItem>
                                        <SelectItem value="link">Link</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {['image','video','audio','document'].includes(v.mediatype) && (
                                      <Input type="file" className="h-7 text-xs flex-1" accept={v.mediatype === 'image' ? 'image/*' : v.mediatype === 'video' ? 'video/*' : v.mediatype === 'audio' ? 'audio/*' : undefined} onChange={e => { const f = e.target.files?.[0] || null; updateVariation(idx, vIdx, 'mediaFile', f) }} />
                                    )}
                                  </div>
                                  {['image','video'].includes(v.mediatype) && (
                                    <Input placeholder="Legenda..." value={v.caption} onChange={e => updateVariation(idx, vIdx, 'caption', e.target.value)} className="h-7 text-xs" />
                                  )}
                                  {v.mediatype === 'contact' && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input placeholder="Nome" value={v.contactName} onChange={e => updateVariation(idx, vIdx, 'contactName', e.target.value)} className="h-7 text-xs" />
                                      <Input placeholder="Telefone" value={v.contactPhone} onChange={e => updateVariation(idx, vIdx, 'contactPhone', e.target.value)} className="h-7 text-xs" />
                                    </div>
                                  )}
                                  {v.mediatype === 'location' && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input placeholder="Nome do local" value={v.locationName} onChange={e => updateVariation(idx, vIdx, 'locationName', e.target.value)} className="h-7 text-xs" />
                                      <Input placeholder="Lat, Lng" value={v.locationLat && v.locationLng ? `${v.locationLat}, ${v.locationLng}` : ''} onChange={e => { const [lat, lng] = e.target.value.split(',').map(s => s.trim()); updateVariation(idx, vIdx, 'locationLat', lat || ''); updateVariation(idx, vIdx, 'locationLng', lng || '') }} className="h-7 text-xs" />
                                    </div>
                                  )}
                                  {v.mediatype === 'link' && (
                                    <div className="space-y-1">
                                      <Input placeholder="https://..." value={v.linkUrl} onChange={e => updateVariation(idx, vIdx, 'linkUrl', e.target.value)} className="h-7 text-xs" />
                                      <div className="flex items-center gap-2">
                                        <Switch checked={v.linkPreview} onCheckedChange={val => updateVariation(idx, vIdx, 'linkPreview', val)} />
                                        <Label className="text-xs">Preview</Label>
                                      </div>
                                    </div>
                                  )}
                                  {v.mediaFile && (
                                    <div className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg text-xs">
                                      {v.mediatype === 'image' ? <ImageIcon className="size-3 text-emerald-500" /> : v.mediatype === 'video' ? <Film className="size-3 text-sky-500" /> : v.mediatype === 'audio' ? <Music className="size-3 text-amber-500" /> : <File className="size-3 text-zinc-500" />}
                                      <span className="truncate">{v.mediaFile.name}</span>
                                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 ml-auto" onClick={() => updateVariation(idx, vIdx, 'mediaFile', null)}><X className="size-2.5" /></Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WhatsApp Preview Panel */}
                <div className="w-[320px] shrink-0 flex flex-col bg-muted/10 overflow-y-auto">
                  <div className="px-3 py-2 border-b bg-muted/20">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Eye className="size-3" /> Pré-visualização</p>
                  </div>
                  <div className="flex-1 p-3 flex flex-col items-center justify-start">
                    {/* WhatsApp-style chat preview */}
                    <div className="w-full max-w-[280px]">
                      {/* Chat header */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-700 rounded-t-lg text-white">
                        <div className="size-8 rounded-full bg-emerald-500/40 flex items-center justify-center text-xs font-bold">C</div>
                        <div>
                          <p className="text-xs font-medium">Cliente</p>
                          <p className="text-[10px] text-emerald-100">online</p>
                        </div>
                      </div>
                      {/* Chat background */}
                      <div className="bg-[#e5ddd5] dark:bg-[#1a2730] p-3 rounded-b-lg min-h-[200px] space-y-2">
                        {newCampaign.steps.map((step, idx) => {
                          const previewContent = step.content
                            .replace(/\{\{nome\}\}/gi, 'João')
                            .replace(/\{\{telefone\}\}/gi, '48999999999')
                            .replace(/\{\{empresa\}\}/gi, 'M-Tech')
                            .replace(/\{\{vendedor\}\}/gi, 'Artur')
                            .replace(/\{\{KEY:\s*([^}]+)\}\}/g, (_: string, vars: string) => {
                              const options = vars.split('|').map((s: string) => s.trim())
                              return options[0] || 'variação'
                            })
                            .replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => `[${key}]`)
                          if (!step.content) return null
                          return (
                            <div key={idx} className="flex justify-end">
                              <div className="bg-[#dcf8c6] dark:bg-[#005c4b] rounded-lg px-2.5 py-1.5 max-w-[250px] shadow-sm">
                                {idx > 0 && step.delayMinutes > 0 && (
                                  <div className="text-[9px] text-muted-foreground mb-0.5 flex items-center gap-0.5">
                                    <Clock className="size-2" /> +{step.delayMinutes}min
                                  </div>
                                )}
                                <p className="text-[12px] text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{previewContent}</p>
                                <div className="flex items-center justify-end gap-0.5 mt-0.5">
                                  <span className="text-[9px] text-gray-500 dark:text-gray-400">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <svg className="size-3 text-blue-500" viewBox="0 0 16 16" fill="currentColor"><path d="M12.354 4.354a.5.5 0 00-.708-.708L5.5 9.793 3.354 7.646a.5.5 0 10-.708.708l2.5 2.5a.5.5 0 00.708 0l6.5-6.5z"/><path d="M15 8A7 7 0 111 8a7 7 0 0114 0zm-1 0A6 6 0 102 8a6 6 0 0012 0z"/></svg>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        {newCampaign.steps.every(s => !s.content) && (
                          <div className="flex items-center justify-center h-[180px]">
                            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">Comece a digitar sua mensagem<br/>para ver a pré-visualização</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="px-6 py-3 border-t shrink-0">
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createCampaign} disabled={!canCreate} className="bg-emerald-600 hover:bg-emerald-700">Criar Campanha</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : campaigns.length === 0 ? (
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
              <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0">
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
                      {['draft', 'paused', 'scheduled'].includes(c.status) && <Button variant="outline" size="sm" className="gap-1" onClick={() => { setSelectedCampaign(c); startEditing(c); setDetailDialogOpen(true) }}><Pencil className="size-3.5" /> Editar</Button>}
                      {c.status === 'draft' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => startCampaignAction(c.id)}><Play className="size-3.5" /> Iniciar</Button>}
                      {c.status === 'running' && <Button variant="outline" size="sm" className="gap-1" onClick={async () => { try { await fetch(`/api/campaigns/${c.id}/pause`, { method: 'POST' }); toast.success('Campanha pausada!'); fetchCampaigns() } catch { toast.error('Erro ao pausar') } }}><Pause className="size-3.5" /> Pausar</Button>}
                      {c.status === 'paused' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={async () => { try { await fetch(`/api/campaigns/${c.id}/resume`, { method: 'POST' }); toast.success('Campanha retomada!'); fetchCampaigns() } catch { toast.error('Erro ao retomar') } }}><Play className="size-3.5" /> Retomar</Button>}
                      {(c.status === 'running' || c.status === 'paused') && <Button variant="outline" size="sm" className="gap-1 text-amber-600 hover:text-amber-700 border-amber-200" onClick={() => updateCampaignStatus(c.id, 'cancelled')}><X className="size-3.5" /> Cancelar</Button>}
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
      <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setEditing(false) }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {editing ? 'Editar Campanha' : selectedCampaign?.name}
              {!editing && selectedCampaign && ['draft', 'paused', 'scheduled'].includes(selectedCampaign.status) && (
                <Button variant="outline" size="sm" className="gap-1.5 text-amber-500 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 font-semibold" onClick={() => startEditing(selectedCampaign)}>
                  <Pencil className="size-3.5" /> Editar
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>{editing ? 'Modifique os dados da campanha' : 'Detalhes da campanha'}</DialogDescription>
          </DialogHeader>
          {selectedCampaign && !editing && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={selectedCampaign.status} />
                {selectedCampaign.antiBanEnabled && <Badge variant="outline" className="gap-1 text-emerald-600"><Shield className="size-3" /> Anti-Ban</Badge>}
                <Badge variant="outline" className="gap-1">{selectedCampaign.warmingMode === 'stealth' ? <><Snowflake className="size-3" /> Furtivo</> : selectedCampaign.warmingMode === 'agressive' ? <><Flame className="size-3" /> Agressivo</> : <><Shield className="size-3" /> Normal</>}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="shadow-lg"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Pendentes</p><p className="text-xl font-bold">{detailMessages.filter(m => m.status === 'pending').length}</p></CardContent></Card>
                <Card className="shadow-lg"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Enviadas</p><p className="text-xl font-bold text-sky-600">{detailMessages.filter(m => m.status === 'sent').length}</p></CardContent></Card>
                <Card className="shadow-lg"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Entregues</p><p className="text-xl font-bold text-emerald-600">{detailMessages.filter(m => m.status === 'delivered' || m.status === 'read').length}</p></CardContent></Card>
                <Card className="shadow-lg"><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Falharam</p><p className="text-xl font-bold text-rose-600">{detailMessages.filter(m => m.status === 'failed').length}</p></CardContent></Card>
              </div>
              {detailMessages.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Detalhes das Mensagens</Label>
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-1.5">
                      {detailMessages.map((m, i) => (
                        <div key={m.id} className={`p-2.5 rounded-lg text-xs flex items-center gap-3 ${m.status === 'failed' ? 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800' : m.status === 'pending' ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/50'}`}>
                          <span className="font-mono text-muted-foreground w-5 text-center">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{m.contact?.name || '—'}</span>
                              <span className="text-muted-foreground">{m.contact?.phone || ''}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <StatusBadge status={m.status} />
                              {m.chip?.name && <span className="text-muted-foreground">via {m.chip.name}</span>}
                            </div>
                            {m.error && <p className="text-rose-600 mt-1 font-medium">Erro: {m.error}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            {m.sentAt && <p className="text-muted-foreground">Envio: {new Date(m.sentAt).toLocaleString('pt-BR')}</p>}
                            {m.deliveredAt && <p className="text-emerald-600">Entrega: {new Date(m.deliveredAt).toLocaleString('pt-BR')}</p>}
                            {m.readAt && <p className="text-sky-600">Leitura: {new Date(m.readAt).toLocaleString('pt-BR')}</p>}
                            {m.status === 'pending' && !m.sentAt && <p className="text-amber-600 font-medium">Aguardando envio</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
              {selectedCampaign.sequenceSteps?.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Mensagens & Variações</Label>
                  {selectedCampaign.sequenceSteps.sort((a, b) => a.stepOrder - b.stepOrder).map((step, idx) => {
                    let parsedVars: Array<{content: string; mediaUrl?: string; mediatype?: string}> = []
                    try { parsedVars = JSON.parse(step.variations || '[]') } catch { /* ignore */ }
                    return (
                      <div key={step.id} className="p-3 rounded-lg bg-muted/50 space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center justify-center size-7 rounded-full bg-emerald-600 text-white text-xs font-bold">{step.stepOrder}</span>
                          <p className="flex-1 text-sm truncate">{step.content}</p>
                          {step.delayMinutes > 0 && <Badge variant="secondary" className="text-xs gap-1"><Clock className="size-3" />{step.delayMinutes}min</Badge>}
                        </div>
                        {parsedVars.length > 0 && (
                          <div className="ml-10 space-y-1">
                            <p className="text-xs text-muted-foreground font-medium">Variações ({parsedVars.length}):</p>
                            {parsedVars.map((v, vi) => (
                              <div key={vi} className="flex items-center gap-2 text-xs">
                                <Shuffle className="size-3 text-emerald-500" />
                                <span className="truncate">{v.content}</span>
                                {v.mediatype && <Badge variant="outline" className="text-[10px] px-1 py-0">{v.mediatype}</Badge>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {selectedCampaign && editing && (
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label>Nome da Campanha</Label>
                <Input placeholder="Ex: Campanha Black Friday" value={editForm.name} onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Intervalo Mín (seg)</Label>
                  <Input type="number" min={5} value={editForm.sendIntervalMin} onChange={e => setEditForm(prev => ({ ...prev, sendIntervalMin: parseInt(e.target.value) || 30 }))} />
                </div>
                <div className="space-y-2">
                  <Label>Intervalo Máx (seg)</Label>
                  <Input type="number" min={10} value={editForm.sendIntervalMax} onChange={e => setEditForm(prev => ({ ...prev, sendIntervalMax: parseInt(e.target.value) || 90 }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Lista de Contatos</Label>
                <Select value={editForm.contactListId} onValueChange={v => setEditForm(prev => ({ ...prev, contactListId: v }))}>
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
                <Input type="datetime-local" value={editForm.scheduledAt} onChange={e => setEditForm(prev => ({ ...prev, scheduledAt: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Chips para envio</Label>
                <div className="grid grid-cols-2 gap-2">
                  {availableChips.map(chip => (
                    <label key={chip.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${editForm.chipIds.includes(chip.id) ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                      <input type="checkbox" checked={editForm.chipIds.includes(chip.id)} onChange={() => editToggleChip(chip.id)} className="sr-only" />
                      <div className={`size-4 rounded border-2 flex items-center justify-center ${editForm.chipIds.includes(chip.id) ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground'}`}>
                        {editForm.chipIds.includes(chip.id) && <Check className="size-3 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{chip.name}</p>
                        <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {editForm.steps.map((step, idx) => (
                  <div key={idx} className="relative border rounded-xl p-4 space-y-3 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center size-7 rounded-full bg-emerald-600 text-white text-xs font-bold">{idx + 1}</span>
                      <span className="text-sm font-semibold">Mensagem {idx + 1}</span>
                      {idx > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
                          <Clock className="size-3" /> {step.delayMinutes}min após mensagem anterior
                        </div>
                      )}
                      {editForm.steps.length > 1 && (
                        <Button variant="ghost" size="sm" className="ml-auto text-rose-500 h-6 w-6 p-0" onClick={() => editRemoveStep(idx)}>
                          <X className="size-3" />
                        </Button>
                      )}
                    </div>
                    <MessageBuilder value={step.content} onChange={v => editUpdateStep(idx, 'content', v)} messageKeys={messageKeys} templates={templates} contactVariables={contactVariables} />
                    {idx > 0 && (
                      <div className="mt-2">
                        <Label className="text-xs">Atraso antes desta mensagem (minutos)</Label>
                        <Input type="number" min={0} value={step.delayMinutes} onChange={e => editUpdateStep(idx, 'delayMinutes', parseInt(e.target.value) || 0)} className="mt-1 w-40" />
                      </div>
                    )}
                    {/* Anexar */}
                    <div className="space-y-2">
                      <Label className="text-xs flex items-center gap-1"><Paperclip className="size-3" /> Anexar</Label>
                      <div className="flex gap-2">
                        <Select value={step.mediatype} onValueChange={v => editUpdateStep(idx, 'mediatype', v)}>
                          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="image">Imagem</SelectItem>
                            <SelectItem value="video">Vídeo</SelectItem>
                            <SelectItem value="audio">Áudio</SelectItem>
                            <SelectItem value="document">Documento</SelectItem>
                            <SelectItem value="contact">Contato</SelectItem>
                            <SelectItem value="location">Localização</SelectItem>
                            <SelectItem value="link">Link</SelectItem>
                          </SelectContent>
                        </Select>
                        {['image','video','audio','document'].includes(step.mediatype) && (
                          <Input type="file" className="h-8 text-xs flex-1" accept={step.mediatype === 'image' ? 'image/*' : step.mediatype === 'video' ? 'video/*' : step.mediatype === 'audio' ? 'audio/*' : undefined} onChange={e => { const f = e.target.files?.[0] || null; editUpdateStep(idx, 'mediaFile', f) }} />
                        )}
                      </div>
                      {/* Caption for image/video */}
                      {['image','video'].includes(step.mediatype) && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Legenda</Label>
                          <Input placeholder="Legenda da imagem/vídeo..." value={step.caption} onChange={e => editUpdateStep(idx, 'caption', e.target.value)} className="h-8 text-xs" />
                        </div>
                      )}
                      {/* Contact fields */}
                      {step.mediatype === 'contact' && (
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder="Nome do contato" value={step.contactName} onChange={e => editUpdateStep(idx, 'contactName', e.target.value)} className="h-8 text-xs" />
                          <Input placeholder="Telefone (5511999999999)" value={step.contactPhone} onChange={e => editUpdateStep(idx, 'contactPhone', e.target.value)} className="h-8 text-xs" />
                        </div>
                      )}
                      {/* Location fields */}
                      {step.mediatype === 'location' && (
                        <div className="space-y-2">
                          <Input placeholder="Nome do local" value={step.locationName} onChange={e => editUpdateStep(idx, 'locationName', e.target.value)} className="h-8 text-xs" />
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder="Latitude" value={step.locationLat} onChange={e => editUpdateStep(idx, 'locationLat', e.target.value)} className="h-8 text-xs" />
                            <Input placeholder="Longitude" value={step.locationLng} onChange={e => editUpdateStep(idx, 'locationLng', e.target.value)} className="h-8 text-xs" />
                          </div>
                        </div>
                      )}
                      {/* Link fields */}
                      {step.mediatype === 'link' && (
                        <div className="space-y-2">
                          <Input placeholder="https://..." value={step.linkUrl} onChange={e => editUpdateStep(idx, 'linkUrl', e.target.value)} className="h-8 text-xs" />
                          <div className="flex items-center gap-2">
                            <Switch checked={step.linkPreview} onCheckedChange={v => editUpdateStep(idx, 'linkPreview', v)} />
                            <Label className="text-xs">Com visualização (preview)</Label>
                          </div>
                        </div>
                      )}
                      {(step.mediaUrl || step.mediaFile) && (
                        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg text-xs">
                          {step.mediatype === 'image' ? <ImageIcon className="size-3.5 text-emerald-500" /> : step.mediatype === 'video' ? <Film className="size-3.5 text-sky-500" /> : step.mediatype === 'audio' ? <Music className="size-3.5 text-amber-500" /> : <File className="size-3.5 text-zinc-500" />}
                          <span className="truncate">{step.mediaFile ? step.mediaFile.name : step.mediaUrl}</span>
                          {step.mediaFile && <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => editUpdateStep(idx, 'mediaFile', null)}><X className="size-3" /></Button>}
                        </div>
                      )}
                    </div>
                    {/* Variations for this step */}
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold flex items-center gap-1">
                          <Shuffle className="size-3" /> Variações da Mensagem {idx + 1}
                        </Label>
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-emerald-600 gap-1" onClick={() => editAddVariation(idx)}>
                          <Plus className="size-3" /> Variação
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Uma variação aleatória será escolhida para cada contato</p>
                      {step.variations.map((v, vIdx) => (
                        <div key={vIdx} className="relative p-3 border rounded-lg space-y-2 bg-background/50">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-muted-foreground">Variação {vIdx + 1}</span>
                            {step.variations.length > 1 && (
                              <Button variant="ghost" size="sm" className="ml-auto text-rose-500 h-5 w-5 p-0" onClick={() => editRemoveVariation(idx, vIdx)}>
                                <X className="size-3" />
                              </Button>
                            )}
                          </div>
                          <Textarea placeholder={`Texto da variação ${vIdx + 1}...`} value={v.content} onChange={e => editUpdateVariation(idx, vIdx, 'content', e.target.value)} rows={2} />
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap gap-1">
                              <span className="text-[10px] text-muted-foreground font-medium w-full">📋 Contato</span>
                              {CONTACT_VARIABLES.map(cv => (
                                <Button key={cv.tag} variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30" onClick={() => editUpdateVariation(idx, vIdx, 'content', v.content + cv.tag)}>
                                  {cv.icon} {cv.label}
                                </Button>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <span className="text-[10px] text-muted-foreground font-medium w-full">🔀 Blocos de Variação</span>
                              {messageKeys.map(k => {
                                let varCount = 0
                                try { varCount = JSON.parse(k.variations).length } catch { /* ignore */ }
                                return (
                                  <Button key={k.id} variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-900/30" onClick={() => {
                                    try {
                                      const vars = JSON.parse(k.variations)
                                      if (vars?.length) {
                                        editUpdateVariation(idx, vIdx, 'content', v.content + `{{KEY: ${vars.join(' | ')}}}`)
                                      }
                                    } catch {
                                      editUpdateVariation(idx, vIdx, 'content', v.content + `{{${k.name}}}`)
                                    }
                                  }} title={`${k.label} — ${varCount} variações`}>
                                    <Shuffle className="size-2.5" /> {k.label}
                                  </Button>
                                )
                              })}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <Select value={v.mediatype} onValueChange={mt => editUpdateVariation(idx, vIdx, 'mediatype', mt)}>
                                <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="image">Imagem</SelectItem>
                                  <SelectItem value="video">Vídeo</SelectItem>
                                  <SelectItem value="audio">Áudio</SelectItem>
                                  <SelectItem value="document">Documento</SelectItem>
                                  <SelectItem value="contact">Contato</SelectItem>
                                  <SelectItem value="location">Localização</SelectItem>
                                  <SelectItem value="link">Link</SelectItem>
                                </SelectContent>
                              </Select>
                              {['image','video','audio','document'].includes(v.mediatype) && (
                                <Input type="file" className="h-7 text-xs flex-1" accept={v.mediatype === 'image' ? 'image/*' : v.mediatype === 'video' ? 'video/*' : v.mediatype === 'audio' ? 'audio/*' : undefined} onChange={e => { const f = e.target.files?.[0] || null; editUpdateVariation(idx, vIdx, 'mediaFile', f) }} />
                              )}
                            </div>
                            {['image','video'].includes(v.mediatype) && (
                              <Input placeholder="Legenda..." value={v.caption} onChange={e => editUpdateVariation(idx, vIdx, 'caption', e.target.value)} className="h-7 text-xs" />
                            )}
                            {v.mediatype === 'contact' && (
                              <div className="grid grid-cols-2 gap-2">
                                <Input placeholder="Nome" value={v.contactName} onChange={e => editUpdateVariation(idx, vIdx, 'contactName', e.target.value)} className="h-7 text-xs" />
                                <Input placeholder="Telefone" value={v.contactPhone} onChange={e => editUpdateVariation(idx, vIdx, 'contactPhone', e.target.value)} className="h-7 text-xs" />
                              </div>
                            )}
                            {v.mediatype === 'location' && (
                              <div className="grid grid-cols-2 gap-2">
                                <Input placeholder="Nome do local" value={v.locationName} onChange={e => editUpdateVariation(idx, vIdx, 'locationName', e.target.value)} className="h-7 text-xs" />
                                <Input placeholder="Lat, Lng" value={v.locationLat && v.locationLng ? `${v.locationLat}, ${v.locationLng}` : ''} onChange={e => { const [lat, lng] = e.target.value.split(',').map(s => s.trim()); editUpdateVariation(idx, vIdx, 'locationLat', lat || ''); editUpdateVariation(idx, vIdx, 'locationLng', lng || '') }} className="h-7 text-xs" />
                              </div>
                            )}
                            {v.mediatype === 'link' && (
                              <div className="space-y-1">
                                <Input placeholder="https://..." value={v.linkUrl} onChange={e => editUpdateVariation(idx, vIdx, 'linkUrl', e.target.value)} className="h-7 text-xs" />
                                <div className="flex items-center gap-2">
                                  <Switch checked={v.linkPreview} onCheckedChange={val => editUpdateVariation(idx, vIdx, 'linkPreview', val)} />
                                  <Label className="text-xs">Preview</Label>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={editAddStep} className="gap-1.5 w-full">
                  <Plus className="size-3.5" /> Adicionar Mensagem
                </Button>
              </div>
              {/* Anti-Ban Section */}
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="size-5 text-emerald-500" />
                    <Label className="text-base font-semibold">Proteção Anti-Ban</Label>
                  </div>
                  <Switch checked={editForm.antiBanEnabled} onCheckedChange={v => setEditForm(prev => ({ ...prev, antiBanEnabled: v }))} />
                </div>
                {editForm.antiBanEnabled && (
                  <div className="space-y-3 p-4 bg-muted/50 rounded-xl">
                    <Label className="text-sm">Modo de Aquecimento</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: 'normal', label: 'Normal', icon: Shield, desc: 'Equilibrado' },
                        { value: 'agressive', label: 'Agressivo', icon: Flame, desc: 'Mais rápido' },
                        { value: 'stealth', label: 'Furtivo', icon: Snowflake, desc: 'Máx. segurança' },
                      ].map(m => (
                        <button key={m.value} type="button" onClick={() => setEditForm(prev => ({ ...prev, warmingMode: m.value }))}
                          className={`p-3 rounded-lg border text-center transition-all ${editForm.warmingMode === m.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                          <m.icon className={`size-5 mx-auto mb-1 ${editForm.warmingMode === m.value ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                          <p className="text-sm font-medium">{m.label}</p>
                          <p className="text-xs text-muted-foreground">{m.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Save / Cancel buttons */}
              <div className="flex items-center gap-3 pt-2">
                <Button variant="outline" onClick={cancelEditing} disabled={saving}>Cancelar</Button>
                <Button onClick={saveEdit} disabled={!canSaveEdit || saving} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
                  {saving ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
              </div>
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
  const [newTemplate, setNewTemplate] = useState({ name: '', content: '', category: 'geral', mediatype: 'text', mediaDescription: '', linkUrl: '', linkPreview: true })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('todas')
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null)
  const [editForm, setEditForm] = useState({ name: '', content: '', category: 'geral', mediatype: 'text', mediaDescription: '', linkUrl: '', linkPreview: true })

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
      setNewTemplate({ name: '', content: '', category: 'geral', mediatype: 'text', mediaDescription: '', linkUrl: '', linkPreview: true })
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
  const insertEditVariable = (v: string) => {
    setEditForm(prev => ({ ...prev, content: prev.content + v }))
  }

  const TEMPLATE_VARS = ['{{nome}}', '{{saudacao}}', '{{telefone}}', '{{empresa}}', '{{vendedor}}']

  const openEditTemplate = (t: MessageTemplate) => {
    setEditTemplate(t)
    setEditForm({ name: t.name, content: t.content, category: t.category, mediatype: t.mediatype || 'text', mediaDescription: t.mediaDescription || '', linkUrl: t.linkUrl || '', linkPreview: t.linkPreview !== undefined ? t.linkPreview : true })
    setEditDialogOpen(true)
  }

  const saveEditTemplate = async () => {
    if (!editTemplate) return
    try {
      const res = await fetch(`/api/templates/${editTemplate.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error()
      toast.success('Template atualizado!')
      setEditDialogOpen(false)
      fetchTemplates()
    } catch { toast.error('Erro ao atualizar template') }
  }

  const categoryColors: Record<string, string> = {
    'saudação': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    'vendas': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    'follow-up': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    'pós-venda': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    'geral': 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400',
  }

  const mediaTypeIcons: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    'text': { icon: <MessageCircle className="size-3.5" />, color: 'text-zinc-500', label: 'Texto' },
    'image': { icon: <ImageIcon className="size-3.5" />, color: 'text-emerald-500', label: 'Imagem' },
    'video': { icon: <Film className="size-3.5" />, color: 'text-sky-500', label: 'Vídeo' },
    'audio': { icon: <Music className="size-3.5" />, color: 'text-amber-500', label: 'Áudio' },
    'document': { icon: <File className="size-3.5" />, color: 'text-violet-500', label: 'Documento' },
    'contact': { icon: <Users className="size-3.5" />, color: 'text-rose-500', label: 'Contato' },
    'location': { icon: <MapPin className="size-3.5" />, color: 'text-orange-500', label: 'Localização' },
    'link': { icon: <Link2 className="size-3.5" />, color: 'text-blue-500', label: 'Link' },
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
              <div className="grid grid-cols-2 gap-3">
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
                  <Label className="flex items-center gap-1"><Paperclip className="size-3" /> Tipo de Mídia</Label>
                  <Select value={newTemplate.mediatype} onValueChange={v => setNewTemplate(p => ({ ...p, mediatype: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Somente texto</SelectItem>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="audio">Áudio</SelectItem>
                      <SelectItem value="document">Documento</SelectItem>
                      <SelectItem value="contact">Contato</SelectItem>
                      <SelectItem value="location">Localização</SelectItem>
                      <SelectItem value="link">Link</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {newTemplate.mediatype !== 'text' && (
                <div className="space-y-2">
                  <Label>Descrição da mídia</Label>
                  <Input placeholder={newTemplate.mediatype === 'image' ? 'Ex: Foto do monitor 27"' : newTemplate.mediatype === 'audio' ? 'Ex: Áudio de apresentação' : 'Descreva a mídia a anexar...'} value={newTemplate.mediaDescription} onChange={e => setNewTemplate(p => ({ ...p, mediaDescription: e.target.value }))} />
                </div>
              )}
              {newTemplate.mediatype === 'link' && (
                <div className="space-y-2">
                  <Label>URL do Link</Label>
                  <Input placeholder="https://..." value={newTemplate.linkUrl} onChange={e => setNewTemplate(p => ({ ...p, linkUrl: e.target.value }))} />
                  <div className="flex items-center gap-2">
                    <Switch checked={newTemplate.linkPreview} onCheckedChange={v => setNewTemplate(p => ({ ...p, linkPreview: v }))} />
                    <Label className="text-xs">Com visualização (preview)</Label>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>Conteúdo</Label>
                <Textarea placeholder="Ex: Olá {{nome}}! Tudo bem?" value={newTemplate.content} onChange={e => setNewTemplate(p => ({ ...p, content: e.target.value }))} rows={4} />
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARS.map(v => (
                    <Button key={v} variant="outline" size="sm" className="h-7 text-xs gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => insertVariable(v)}>
                      {v}
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
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">Nenhum template encontrado</p>
            <p className="text-sm text-muted-foreground">Crie seu primeiro template de mensagem</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t, i) => {
            const vars = t.content.match(/\{\{[^}]+\}\}/g) || []
            const mediaInfo = mediaTypeIcons[t.mediatype || 'text'] || mediaTypeIcons['text']
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0 group">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
                        <MessageCircle className="size-5 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate text-base">{t.name}</CardTitle>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge className={`text-xs ${categoryColors[t.category] || categoryColors['geral']}`}>
                            {t.category}
                          </Badge>
                          {t.mediatype && t.mediatype !== 'text' && (
                            <Badge variant="outline" className={`text-xs gap-1 ${mediaInfo.color}`}>
                              {mediaInfo.icon} {mediaInfo.label}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground line-clamp-3">{t.content}</p>
                    {t.mediaDescription && (
                      <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                        <Paperclip className="size-3" /> {t.mediaDescription}
                      </p>
                    )}
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
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-emerald-600 h-7 w-7 p-0" onClick={() => openEditTemplate(t)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600 h-7 w-7 p-0" onClick={() => setDeleteConfirm(t.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
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

      {/* Edit Template Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Template</DialogTitle>
            <DialogDescription>Atualize as informações do template</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={editForm.category} onValueChange={v => setEditForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['geral', 'saudação', 'vendas', 'follow-up', 'pós-venda'].map(c => (
                      <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><Paperclip className="size-3" /> Tipo de Mídia</Label>
                <Select value={editForm.mediatype} onValueChange={v => setEditForm(p => ({ ...p, mediatype: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Somente texto</SelectItem>
                    <SelectItem value="image">Imagem</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                    <SelectItem value="audio">Áudio</SelectItem>
                    <SelectItem value="document">Documento</SelectItem>
                    <SelectItem value="contact">Contato</SelectItem>
                    <SelectItem value="location">Localização</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editForm.mediatype !== 'text' && (
              <div className="space-y-2">
                <Label>Descrição da mídia</Label>
                <Input placeholder="Descreva a mídia a anexar..." value={editForm.mediaDescription} onChange={e => setEditForm(p => ({ ...p, mediaDescription: e.target.value }))} />
              </div>
            )}
            {editForm.mediatype === 'link' && (
              <div className="space-y-2">
                <Label>URL do Link</Label>
                <Input placeholder="https://..." value={editForm.linkUrl} onChange={e => setEditForm(p => ({ ...p, linkUrl: e.target.value }))} />
                <div className="flex items-center gap-2">
                  <Switch checked={editForm.linkPreview} onCheckedChange={v => setEditForm(p => ({ ...p, linkPreview: v }))} />
                  <Label className="text-xs">Com visualização (preview)</Label>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Conteúdo</Label>
              <Textarea value={editForm.content} onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))} rows={4} />
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map(v => (
                  <Button key={v} variant="outline" size="sm" className="h-7 text-xs gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => insertEditVariable(v)}>
                    {v}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveEditTemplate} disabled={!editForm.name || !editForm.content} className="bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Anti-Ban Tab =====
function AntiBanTab() {
  const [settings, setSettings] = useState<AntiBanSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Sending window defaults in minutes-from-midnight (8:00=480, 21:00=1260)
  const DEFAULTS: Record<string, unknown> = {
    typingMinDelay: 3000,
    typingMaxDelay: 15000,
    messageIntervalMin: 30,
    messageIntervalMax: 90,
    dailyLimitPerChip: 200,
    warmingEnabled: true,
    warmingDays: 7,
    cooldownMinutes: 30,
    cooldownAfterMessages: 50,
    stopOnWarning: true,
    sendingWindowStart: 480,
    sendingWindowEnd: 1260,
    timezone: 'America/Sao_Paulo',
  }

  // Convert minutes-from-midnight to HH:MM string
  const minsToTime = (mins: number) => {
    const m = Math.max(0, Math.min(1440, mins))
    const h = Math.floor(m / 60)
    const min = m % 60
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }

  // Convert HH:MM string to minutes-from-midnight
  const timeToMins = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  // Backward compat: if value is < 25, it's old hour format → convert to minutes
  const toMins = (val: number) => val < 25 ? val * 60 : val

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

  const resetField = async (field: string) => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _resetField: field }) })
      setSettings(await res.json())
      toast.success('Campo restaurado para o padrão!')
    } catch { toast.error('Erro ao restaurar campo') }
    finally { setSaving(false) }
  }

  const resetSection = async (section: string, sectionLabel: string) => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _resetSection: section }) })
      setSettings(await res.json())
      toast.success(`${sectionLabel} restaurado para o padrão!`)
    } catch { toast.error('Erro ao restaurar seção') }
    finally { setSaving(false) }
  }

  const resetToDefaults = async () => {
    setResetting(true)
    try {
      const res = await fetch('/api/antiban', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _resetToDefaults: true }) })
      setSettings(await res.json())
      toast.success('Configurações restauradas para o padrão!')
      setResetDialogOpen(false)
    } catch { toast.error('Erro ao restaurar padrões') }
    finally { setResetting(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  if (!settings) return null

  // Two-phase warming schedules (matching sending-engine.ts)
  const NURSERY_SCHEDULE = [
    { dayRange: '1-2',   limit: 2 },
    { dayRange: '3-4',   limit: 3 },
    { dayRange: '5-6',   limit: 3 },
    { dayRange: '7-8',   limit: 5 },
    { dayRange: '9-10',  limit: 5 },
    { dayRange: '11-12', limit: 6 },
    { dayRange: '13-14', limit: 10 },
  ]
  const PREWARM_SCHEDULE = [
    { dayRange: '1',   limit: 11 },
    { dayRange: '2',   limit: 15 },
    { dayRange: '3',   limit: 20 },
    { dayRange: '4',   limit: 25 },
    { dayRange: '5',   limit: 30 },
    { dayRange: '6',   limit: 35 },
    { dayRange: '7',   limit: 40 },
    { dayRange: '8',   limit: 45 },
    { dayRange: '9',   limit: 50 },
    { dayRange: '10',  limit: 60 },
    { dayRange: '11',  limit: 70 },
    { dayRange: '12',  limit: 80 },
    { dayRange: '13',  limit: 90 },
    { dayRange: '14',  limit: 100 },
    { dayRange: '15',  limit: 120 },
    { dayRange: '16',  limit: 140 },
    { dayRange: '17',  limit: 160 },
    { dayRange: '18',  limit: 180 },
    { dayRange: '19',  limit: 190 },
    { dayRange: '20',  limit: 200 },
  ]
  const maxPrewarm = PREWARM_SCHEDULE[PREWARM_SCHEDULE.length - 1].limit

  const tips = [
    { icon: Clock, title: 'Varie os horários de envio', desc: 'Não envie sempre no mesmo horário' },
    { icon: AlertCircle, title: 'Não envie links no primeiro dia', desc: 'Espere o chip aquecer antes' },
    { icon: UserPlus, title: 'Use mensagens personalizadas com {nome}', desc: 'Mensagens genéricas são mais detectáveis' },
    { icon: Flame, title: 'Aqueça chips novos gradualmente', desc: 'Comece com poucas mensagens' },
    { icon: RefreshCw, title: 'Alterne entre chips a cada 50 mensagens', desc: 'Distribua o envio entre múltiplos chips' },
    { icon: EyeOff, title: 'Evite mensagens idênticas para muitos contatos', desc: 'Use variações de texto' },
  ]

  // Backward-compat minutes for sending window display
  const windowStartMins = toMins(settings.sendingWindowStart)
  const windowEndMins = toMins(settings.sendingWindowEnd)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Anti-Ban</h2>
          <p className="text-sm text-muted-foreground">Configurações de envio para minimizar risco de bloqueios</p>
        </div>
        <Button
          variant="outline"
          className="gap-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
          onClick={() => setResetDialogOpen(true)}
          disabled={saving}
        >
          <RotateCcw className="size-4" />
          Restaurar Tudo
        </Button>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar todas as configurações padrão?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai redefinir todas as configurações anti-ban para os valores originais. Suas personalizações serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={resetToDefaults}
              disabled={resetting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {resetting ? <RefreshCw className="size-4 animate-spin mr-2" /> : <RotateCcw className="size-4 mr-2" />}
              {resetting ? 'Restaurando...' : 'Restaurar Padrões'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Row 1: Typing Simulation + Message Interval */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Typing Simulation */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Type className="size-3.5 text-amber-600" />
                </div>
                <CardTitle className="text-base">Simulação de Digitação</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-amber-600 gap-1 h-7" onClick={() => resetSection('typing', 'Simulação de Digitação')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Atraso mínimo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-amber-600" onClick={() => resetField('typingMinDelay')} title={`Padrão: ${DEFAULTS.typingMinDelay}ms`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1000} max={10000} step={100} value={settings.typingMinDelay} onChange={e => updateSetting('typingMinDelay', Math.max(1000, parseInt(e.target.value) || 1000))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">ms</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Atraso máximo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-amber-600" onClick={() => resetField('typingMaxDelay')} title={`Padrão: ${DEFAULTS.typingMaxDelay}ms`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={2000} max={30000} step={100} value={settings.typingMaxDelay} onChange={e => updateSetting('typingMaxDelay', Math.max(2000, parseInt(e.target.value) || 2000))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">ms</span>
                </div>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-emerald-600">
                  <MessageCircle className="size-3.5" />
                  <span className="text-xs">Digitando</span>
                  <span className="animate-pulse text-xs">...</span>
                </div>
                <span className="text-[11px] text-muted-foreground">({settings.typingMinDelay}–{settings.typingMaxDelay}ms)</span>
                <span className="text-xs">→ Olá, tudo bem?</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Message Interval */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                  <Timer className="size-3.5 text-sky-600" />
                </div>
                <CardTitle className="text-base">Intervalo entre Mensagens</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-sky-600 gap-1 h-7" onClick={() => resetSection('interval', 'Intervalo entre Mensagens')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo mínimo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-sky-600" onClick={() => resetField('messageIntervalMin')} title={`Padrão: ${DEFAULTS.messageIntervalMin}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={5} max={120} step={5} value={settings.messageIntervalMin} onChange={e => updateSetting('messageIntervalMin', Math.max(5, parseInt(e.target.value) || 5))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Intervalo máximo</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-sky-600" onClick={() => resetField('messageIntervalMax')} title={`Padrão: ${DEFAULTS.messageIntervalMax}s`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={10} max={300} step={5} value={settings.messageIntervalMax} onChange={e => updateSetting('messageIntervalMax', Math.max(10, parseInt(e.target.value) || 10))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">seg</span>
                </div>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <React.Fragment key={i}>
                    <div className="size-2.5 rounded-full bg-emerald-500" />
                    {i < 5 && <div className="flex-1 h-0.5 bg-gradient-to-r from-emerald-300 to-teal-300" />}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">Aleatório entre {settings.messageIntervalMin}–{settings.messageIntervalMax}s</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Progressive Warming (full width) + Cooldown & Limits */}
      <div className="grid grid-cols-1 gap-4">
        {/* Progressive Warming — Full Width with Two Phases */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                  <Flame className="size-3.5 text-orange-600" />
                </div>
                <CardTitle className="text-base">Aquecimento Progressivo</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={settings.warmingEnabled} onCheckedChange={v => updateSetting('warmingEnabled', v)} />
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-orange-600 gap-1 h-7" onClick={() => resetSection('warming', 'Aquecimento Progressivo')} disabled={saving}>
                  <RotateCcw className="size-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Phase Overview */}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <Baby className="size-4 text-amber-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Berçário</p>
                  <p className="text-[10px] text-muted-foreground">14 dias • Até 10 msg/dia</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                <Flame className="size-4 text-orange-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Pré-aquecido</p>
                  <p className="text-[10px] text-muted-foreground">20 dias • 11→200 msg/dia</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Pronto</p>
                  <p className="text-[10px] text-muted-foreground">Sem limite de aquecimento</p>
                </div>
              </div>
            </div>

            {/* Two-phase schedule tables side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Phase 1: Nursery (Berçário) */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-5 items-center justify-center rounded bg-amber-100 dark:bg-amber-900/30">
                    <Baby className="size-3 text-amber-600" />
                  </div>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Fase 1: Berçário (Chip Novo)</span>
                </div>
                <div className="space-y-1.5">
                  {NURSERY_SCHEDULE.map((entry, i) => {
                    const pct = Math.max(5, (entry.limit / 10) * 100)
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-10 shrink-0 text-right">Dia {entry.dayRange}</span>
                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full flex items-center justify-end pr-1"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: i * 0.1 }}
                          >
                            <span className="text-[9px] font-bold text-white">{entry.limit}</span>
                          </motion.div>
                        </div>
                        <span className="text-[10px] text-muted-foreground w-10 shrink-0">msg/dia</span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 italic">Após 14 dias → chip pré-aquecido</p>
              </div>

              {/* Phase 2: Prewarm (Pré-aquecido) */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-5 items-center justify-center rounded bg-orange-100 dark:bg-orange-900/30">
                    <Flame className="size-3 text-orange-600" />
                  </div>
                  <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">Fase 2: Pré-aquecido (Ramp-up)</span>
                </div>
                <div className="space-y-1">
                  {PREWARM_SCHEDULE.map((entry, i) => {
                    const pct = Math.max(5, (entry.limit / maxPrewarm) * 100)
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-7 shrink-0 text-right">D{entry.dayRange}</span>
                        <div className="flex-1 h-3.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-orange-400 to-emerald-500 rounded-full flex items-center justify-end pr-1"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, delay: i * 0.05 }}
                          >
                            {pct > 15 && <span className="text-[8px] font-bold text-white">{entry.limit}</span>}
                          </motion.div>
                        </div>
                        <span className="text-[9px] text-muted-foreground w-7 shrink-0">{entry.limit} msg</span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 italic">Após 20 dias → chip pronto (sem restrição)</p>
              </div>
            </div>

            {/* Timeline visual */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[11px] font-medium mb-2">Timeline completa do aquecimento</p>
              <div className="flex items-center gap-0.5">
                {/* Nursery phase: 14 days */}
                {Array.from({ length: 14 }, (_, i) => {
                  const day = i + 1
                  const limit = NURSERY_SCHEDULE.find(s => {
                    const [from, to] = s.dayRange.split('-').map(Number)
                    return day >= from && day <= to
                  })?.limit || 2
                  return (
                    <div
                      key={`n-${i}`}
                      className="flex-1 h-5 rounded-sm bg-amber-400 flex items-center justify-center"
                      title={`Berçário Dia ${day}: ${limit} msg/dia`}
                    >
                      <span className="text-[7px] font-bold text-white">{limit}</span>
                    </div>
                  )
                })}
                {/* Prewarm phase: 20 days */}
                {Array.from({ length: 20 }, (_, i) => {
                  const day = i + 1
                  const entry = PREWARM_SCHEDULE.find(s => {
                    const [from, to] = s.dayRange.split('-').map(Number)
                    return day >= from && day <= to
                  })
                  const limit = entry?.limit || 11
                  const intensity = limit / 200
                  return (
                    <div
                      key={`p-${i}`}
                      className="flex-1 h-5 rounded-sm flex items-center justify-center"
                      style={{ backgroundColor: `rgba(16, 185, 129, ${0.2 + intensity * 0.8})` }}
                      title={`Pré-aquecido Dia ${day}: ${limit} msg/dia`}
                    >
                      <span className="text-[7px] font-bold text-white">{limit}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-amber-600 font-medium">← Berçário (14 dias)</span>
                <span className="text-[9px] text-orange-600 font-medium">Pré-aquecido (20 dias) →</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2.5: Cooldown & Limits + Sending Window */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
                  <ShieldAlert className="size-3.5 text-rose-600" />
                </div>
                <CardTitle className="text-base">Cooldown & Limites</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-rose-600 gap-1 h-7" onClick={() => resetSection('cooldown', 'Cooldown & Limites')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Limite diário/chip</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('dailyLimitPerChip')} title={`Padrão: ${DEFAULTS.dailyLimitPerChip}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={50} max={500} step={10} value={settings.dailyLimitPerChip} onChange={e => updateSetting('dailyLimitPerChip', Math.max(50, parseInt(e.target.value) || 50))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">msgs</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Cooldown após</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('cooldownAfterMessages')} title={`Padrão: ${DEFAULTS.cooldownAfterMessages}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={10} max={100} step={5} value={settings.cooldownAfterMessages} onChange={e => updateSetting('cooldownAfterMessages', Math.max(10, parseInt(e.target.value) || 10))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">msgs</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Duração cooldown</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('cooldownMinutes')} title={`Padrão: ${DEFAULTS.cooldownMinutes} min`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={5} max={120} step={5} value={settings.cooldownMinutes} onChange={e => updateSetting('cooldownMinutes', Math.max(5, parseInt(e.target.value) || 5))} className="w-24 h-8 text-sm" />
                  <span className="text-[11px] text-muted-foreground">min</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-xs font-medium">Parada em Aviso</p>
                  <p className="text-[10px] text-muted-foreground">Para ao detectar aviso</p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={settings.stopOnWarning} onCheckedChange={v => updateSetting('stopOnWarning', v)} />
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-rose-600" onClick={() => resetField('stopOnWarning')} title="Restaurar padrão">
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sending Window */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                  <Clock className="size-3.5 text-violet-600" />
                </div>
                <CardTitle className="text-base">Janela de Envio</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-violet-600 gap-1 h-7" onClick={() => resetSection('sendingWindow', 'Janela de Envio')} disabled={saving}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Início</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-violet-600" onClick={() => resetField('sendingWindowStart')} title={`Padrão: ${minsToTime(DEFAULTS.sendingWindowStart as number)}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <Select
                  value={String(windowStartMins)}
                  onValueChange={v => updateSetting('sendingWindowStart', parseInt(v))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {Array.from({ length: 289 }, (_, i) => i * 5).map(mins => (
                      <SelectItem key={mins} value={String(mins)}>
                        {minsToTime(mins)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Término</Label>
                  <Button variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-violet-600" onClick={() => resetField('sendingWindowEnd')} title={`Padrão: ${minsToTime(DEFAULTS.sendingWindowEnd as number)}`}>
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
                <Select
                  value={String(windowEndMins)}
                  onValueChange={v => updateSetting('sendingWindowEnd', parseInt(v))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {Array.from({ length: 289 }, (_, i) => i * 5).map(mins => (
                      <SelectItem key={mins} value={String(mins)}>
                        {minsToTime(mins)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-0.5 mb-1.5">
                {Array.from({ length: 24 }, (_, i) => {
                  const hourStartMins = i * 60
                  const isActive = hourStartMins >= windowStartMins && hourStartMins < windowEndMins
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-5 rounded-sm ${isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                      title={`${i}h`}
                    />
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">Envio permitido das <strong>{minsToTime(windowStartMins)}</strong> às <strong>{minsToTime(windowEndMins)}</strong> (fuso: {settings.timezone})</p>
            </div>
          </CardContent>
        </Card>

        {/* Tips */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Star className="size-3.5 text-amber-600" />
              </div>
              <CardTitle className="text-base">Dicas Anti-Ban</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tips.map((tip, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                  className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex size-6 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/20 shrink-0">
                    <tip.icon className="size-3 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium">{tip.title}</p>
                    <p className="text-[10px] text-muted-foreground">{tip.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ===== Inbox Tab =====
function InboxTab() {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchMessages = useCallback(async (p = 1) => {
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' })
      if (searchQuery) params.set('search', searchQuery)
      const res = await fetch(`/api/inbox?${params}`)
      const data = await res.json()
      setMessages(data.messages || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 1)
      setPage(data.page || 1)
    } catch { toast.error('Erro ao carregar mensagens') }
    finally { setLoading(false) }
  }, [searchQuery])

  useEffect(() => { fetchMessages(1) }, [fetchMessages])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Caixa de Entrada</h2>
          <p className="text-sm text-muted-foreground">Mensagens recebidas via WhatsApp</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => fetchMessages(page)}>
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou mensagem..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : messages.length === 0 ? (
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">Nenhuma mensagem recebida</p>
            <p className="text-sm text-muted-foreground">Mensagens recebidas aparecerão aqui</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardContent className="p-0">
            <ScrollArea className="max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-3 font-medium">Remetente</th>
                    <th className="text-left p-3 font-medium">Mensagem</th>
                    <th className="text-left p-3 font-medium">Tipo</th>
                    <th className="text-left p-3 font-medium">Instância</th>
                    <th className="text-left p-3 font-medium">Data/Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium">{m.pushName || m.remoteJid.split('@')[0]}</td>
                      <td className="p-3 max-w-[250px] truncate text-muted-foreground">{m.messageContent}</td>
                      <td className="p-3"><Badge variant="outline" className="text-xs">{m.messageType}</Badge></td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{m.instanceName}</td>
                      <td className="p-3 text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} mensagens — Página {page} de {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => fetchMessages(page - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => fetchMessages(page + 1)}>Próxima</Button>
          </div>
        </div>
      )}
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

  const resendMessage = async (id: string) => {
    try {
      const res = await fetch(`/api/messages/${id}/resend`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Mensagem reenviada!')
      fetchMessages()
    } catch { toast.error('Erro ao reenviar mensagem') }
  }

  const resendAllFailed = async () => {
    try {
      const res = await fetch('/api/messages/resend-all-failed', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao reenviar')
      toast.success(`${data.count || 0} mensagens reenviadas!`)
      fetchMessages()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao reenviar mensagens') }
  }

  const failedCount = messages.filter(m => m.status === 'failed').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Mensagens</h2>
          <p className="text-sm text-muted-foreground">Histórico completo de mensagens enviadas</p>
        </div>
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <Button variant="outline" className="gap-2 text-amber-600 hover:text-amber-700 border-amber-200" onClick={resendAllFailed}>
              <RotateCcw className="size-4" /> Reenviar Todas Falhas ({failedCount})
            </Button>
          )}
          <Button variant="outline" className="gap-2" onClick={exportCSV}>
            <Download className="size-4" /> Exportar CSV
          </Button>
        </div>
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
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageSquare className="size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">Nenhuma mensagem encontrada</p>
            <p className="text-sm text-muted-foreground">As mensagens aparecerão aqui após o envio</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
                    <th className="text-left p-3 font-medium">Ações</th>
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
                      <td className="p-3">
                        {m.status === 'failed' && (
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-amber-600 hover:text-amber-700" onClick={() => resendMessage(m.id)}>
                            <RotateCcw className="size-3.5" /> Reenviar
                          </Button>
                        )}
                      </td>
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
    evolutionApiUrl: '', evolutionApiKey: '',
    socks5Host: '', socks5Port: '8080', socks5User: '', socks5Pass: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings')
        const data = await res.json()
        if (data.resetHour !== undefined) setConfig(prev => ({ ...prev, resetHour: parseInt(data.resetHour) || 0 }))
        if (data.defaultProxyMode) setConfig(prev => ({ ...prev, defaultProxyMode: data.defaultProxyMode }))
        if (data.globalDailyLimit) setConfig(prev => ({ ...prev, globalDailyLimit: parseInt(data.globalDailyLimit) || 1000 }))
        if (data.emailNotifications !== undefined) setConfig(prev => ({ ...prev, emailNotifications: data.emailNotifications === 'true' }))
        if (data.timezone) setConfig(prev => ({ ...prev, timezone: data.timezone }))
        if (data.evolution_api_url) setConfig(prev => ({ ...prev, evolutionApiUrl: data.evolution_api_url }))
        if (data.evolution_api_key) setConfig(prev => ({ ...prev, evolutionApiKey: data.evolution_api_key }))
        if (data.default_socks5_host) setConfig(prev => ({ ...prev, socks5Host: data.default_socks5_host }))
        if (data.default_socks5_port) setConfig(prev => ({ ...prev, socks5Port: data.default_socks5_port }))
        if (data.default_socks5_user) setConfig(prev => ({ ...prev, socks5User: data.default_socks5_user }))
        if (data.default_socks5_pass) setConfig(prev => ({ ...prev, socks5Pass: data.default_socks5_pass }))
      } catch { /* empty */ }
      finally { setLoading(false) }
    }
    loadSettings()
  }, [])

  const saveSettings = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetHour: String(config.resetHour),
          defaultProxyMode: config.defaultProxyMode,
          globalDailyLimit: String(config.globalDailyLimit),
          emailNotifications: String(config.emailNotifications),
          timezone: config.timezone,
          evolution_api_url: config.evolutionApiUrl,
          evolution_api_key: config.evolutionApiKey,
          default_socks5_host: config.socks5Host,
          default_socks5_port: config.socks5Port,
          default_socks5_user: config.socks5User,
          default_socks5_pass: config.socks5Pass,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Configurações salvas!')
      setConnectionResult(null)
    } catch { toast.error('Erro ao salvar configurações') }
    finally { setSaving(false) }
  }

  const testEvolutionConnection = async () => {
    setTestingConnection(true)
    setConnectionResult(null)
    try {
      // First save the settings so the test uses the latest values
      const saveRes = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evolution_api_url: config.evolutionApiUrl,
          evolution_api_key: config.evolutionApiKey,
        }),
      })
      if (!saveRes.ok) throw new Error('Erro ao salvar antes de testar')

      const res = await fetch('/api/whatsapp/test-connection', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setConnectionResult({ success: true, message: `Conexão OK! ${data.instanceCount} instância(s) encontrada(s)` })
        toast.success('Conexão com Evolution API bem sucedida!')
      } else {
        setConnectionResult({ success: false, message: data.error || 'Erro ao conectar' })
        toast.error('Falha na conexão com Evolution API')
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro ao testar conexão'
      setConnectionResult({ success: false, message: msg })
      toast.error(msg)
    } finally {
      setTestingConnection(false)
    }
  }

  const changePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('Preencha todos os campos de senha')
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('A nova senha e a confirmação não coincidem')
      return
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres')
      return
    }
    setChangingPassword(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao alterar senha')
      toast.success('Senha alterada com sucesso!')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao alterar senha')
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configurações</h2>
        <p className="text-sm text-muted-foreground">Configurações gerais do sistema</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evolution API Card - FULL WIDTH */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200 lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <Globe className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">Evolution API</CardTitle>
              <Badge variant="outline" className="gap-1 text-xs ml-auto">
                <Zap className="size-3" /> WhatsApp Engine
              </Badge>
            </div>
            <CardDescription>Configure a conexão com a Evolution API que gerencia as instâncias WhatsApp</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>URL da API</Label>
                <Input placeholder="https://evolution.seudominio.com" value={config.evolutionApiUrl}
                  onChange={e => setConfig(p => ({ ...p, evolutionApiUrl: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Endereço do servidor Evolution API</p>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input type="password" placeholder="Sua API Key" value={config.evolutionApiKey}
                  onChange={e => setConfig(p => ({ ...p, evolutionApiKey: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Chave de autenticação da Evolution API</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="gap-2" onClick={testEvolutionConnection} disabled={testingConnection || !config.evolutionApiUrl || !config.evolutionApiKey}>
                {testingConnection ? <RefreshCw className="size-4 animate-spin" /> : <Activity className="size-4" />}
                {testingConnection ? 'Testando...' : 'Testar Conexão'}
              </Button>
              {connectionResult && (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  connectionResult.success
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                }`}>
                  {connectionResult.success ? <Check className="size-4" /> : <AlertCircle className="size-4" />}
                  {connectionResult.message}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Proxy SOCKS5 Global Card - FULL WIDTH */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200 lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Globe className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-lg">Proxy SOCKS5 Global</CardTitle>
              <Badge variant="outline" className="gap-1 text-xs ml-auto">
                <Shield className="size-3" /> Roteamento de IP
              </Badge>
            </div>
            <CardDescription>
              Configure o proxy SOCKS5 uma vez e todos os chips usarão automaticamente.
              Ideal para usar com WireGuard + Every Proxy no celular — não precisa configurar cada chip individualmente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Host do Proxy</Label>
                <Input placeholder="Ex: 10.0.0.100 (IP do WireGuard)" value={config.socks5Host}
                  onChange={e => setConfig(p => ({ ...p, socks5Host: e.target.value }))} />
                <p className="text-xs text-muted-foreground">IP do celular na rede WireGuard (Every Proxy)</p>
              </div>
              <div className="space-y-2">
                <Label>Porta do Proxy</Label>
                <Input placeholder="8080" value={config.socks5Port}
                  onChange={e => setConfig(p => ({ ...p, socks5Port: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Porta SOCKS5 do Every Proxy (padrão: 8080)</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Usuário (opcional)</Label>
                <Input placeholder="Deixe vazio se não houver autenticação" value={config.socks5User}
                  onChange={e => setConfig(p => ({ ...p, socks5User: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Senha (opcional)</Label>
                <Input type="password" placeholder="Deixe vazio se não houver autenticação" value={config.socks5Pass}
                  onChange={e => setConfig(p => ({ ...p, socks5Pass: e.target.value }))} />
              </div>
            </div>
            {config.socks5Host && config.socks5Port && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-sm">
                <Check className="size-4" />
                Proxy SOCKS5 ativo: {config.socks5Host}:{config.socks5Port} — será aplicado automaticamente a todos os chips
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
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
          onClick={saveSettings} disabled={saving}>
          {saving ? <RefreshCw className="size-4 animate-spin" /> : <Check className="size-4" />} Salvar Configurações
        </Button>
      </div>

      {/* Change Password Card */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
              <Lock className="size-4 text-rose-600" />
            </div>
            <CardTitle className="text-lg">Alterar Senha</CardTitle>
          </div>
          <CardDescription>Altere a senha de acesso do administrador</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Senha Atual</Label>
            <Input type="password" placeholder="••••••" value={passwordForm.currentPassword}
              onChange={e => setPasswordForm(p => ({ ...p, currentPassword: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" placeholder="Mínimo 6 caracteres" value={passwordForm.newPassword}
                onChange={e => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Confirmar Nova Senha</Label>
              <Input type="password" placeholder="Repita a nova senha" value={passwordForm.confirmPassword}
                onChange={e => setPasswordForm(p => ({ ...p, confirmPassword: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button className="gap-2" onClick={changePassword}
              disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}>
              {changingPassword ? <RefreshCw className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {changingPassword ? 'Alterando...' : 'Alterar Senha'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ===== VPS / Proxy Setup Tab =====
function VpsSetupTab() {
  const [loading, setLoading] = useState(true)
  const [setupData, setSetupData] = useState<{
    serverEndpoint: string
    serverPort: string
    subnet: string
    chipCount: number
    configuredChips: number
    wgServerConfig: string
    serverSetupScript: string
    evolutionVpsScript: string
    dockerComposeNote: string
    proxyConfigs: { chipId: string; chipName: string; wireguardIp: string; socksPort: number; proxyHost: string; proxyPort: number }[]
  } | null>(null)
  const [autoConfiguring, setAutoConfiguring] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/vps-setup').then(r => r.json()).then(data => { setSetupData(data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const autoConfigure = async () => {
    setAutoConfiguring(true)
    try {
      const res = await fetch('/api/vps-setup', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message || `${data.updated} chips configurados!`)
      // Refresh data
      const refresh = await fetch('/api/vps-setup')
      setSetupData(await refresh.json())
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao auto-configurar')
    } finally {
      setAutoConfiguring(false)
    }
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      toast.success('Copiado!')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  }

  if (!setupData) {
    return (
      <Card className="shadow-lg border-0">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <AlertCircle className="size-8 text-rose-500 mb-2" />
          <p className="text-sm text-muted-foreground">Erro ao carregar dados do VPS</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">VPS / Proxy</h2>
          <p className="text-sm text-muted-foreground">Configure WireGuard + SOCKS5 proxy para roteamento de IP</p>
        </div>
        <Button onClick={autoConfigure} disabled={autoConfiguring} className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
          {autoConfiguring ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
          {autoConfiguring ? 'Configurando...' : 'Auto-Configurar Proxies'}
        </Button>
      </div>

      {/* Architecture Overview */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <Server className="size-4 text-emerald-600" />
            </div>
            <CardTitle className="text-lg">Arquitetura</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30 shrink-0">
                <Smartphone className="size-4 text-amber-600" />
              </div>
              <div>
                <p className="font-medium">Celular (Chip 4G)</p>
                <p className="text-xs text-muted-foreground">WireGuard + Every Proxy (SOCKS5 :1080)</p>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDownToLine className="size-4 text-muted-foreground" /></div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 shrink-0">
                <Globe className="size-4 text-violet-600" />
              </div>
              <div>
                <p className="font-medium">VPN WireGuard ({setupData.serverEndpoint})</p>
                <p className="text-xs text-muted-foreground">Subnet {setupData.subnet}.0/24 — Porta {setupData.serverPort}</p>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDownToLine className="size-4 text-muted-foreground" /></div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30 shrink-0">
                <Server className="size-4 text-sky-600" />
              </div>
              <div>
                <p className="font-medium">KVM8 — Evolution API</p>
                <p className="text-xs text-muted-foreground">Instâncias usam SOCKS5 proxy → saem pelo IP do celular</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Chips', value: setupData.chipCount, icon: Smartphone, color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30' },
          { label: 'Com WireGuard', value: setupData.configuredChips, icon: Lock, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Subnet', value: setupData.subnet + '.x', icon: Globe, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
          { label: 'Porta WG', value: setupData.serverPort, icon: Shield, color: 'text-sky-600 bg-sky-100 dark:bg-sky-900/30' },
        ].map(s => (
          <Card key={s.label} className="shadow-lg">
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

      {/* Step 1: WireGuard Server Config */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">1</span>
            <CardTitle className="text-lg">Servidor WireGuard ({setupData.serverEndpoint.split(':')[0]})</CardTitle>
          </div>
          <CardDescription>Cole esta config no arquivo /etc/wireguard/wg0.conf do servidor VPN</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700 max-h-64 overflow-y-auto">
            {setupData.wgServerConfig}
          </pre>
          <Button onClick={() => copyToClipboard(setupData.wgServerConfig, 'server')} variant="outline" className="w-full gap-2">
            {copied === 'server' ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            {copied === 'server' ? 'Copiado!' : 'Copiar Config do Servidor'}
          </Button>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              Depois de colar, execute: <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">wg syncconf wg0 &lt;(wg-quick strip wg0)</code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Chip Proxy Table */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">2</span>
            <CardTitle className="text-lg">Proxy SOCKS5 por Chip</CardTitle>
          </div>
          <CardDescription>Configure no celular: WireGuard (QR Code) + Every Proxy (SOCKS5)</CardDescription>
        </CardHeader>
        <CardContent>
          {setupData.proxyConfigs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Smartphone className="size-8 mb-2 opacity-50" />
              <p className="text-sm">Nenhum chip com WireGuard configurado</p>
              <p className="text-xs">Crie chips primeiro na aba "Chips"</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium">Chip</th>
                    <th className="text-left p-2 font-medium">IP VPN</th>
                    <th className="text-left p-2 font-medium">Porta SOCKS5</th>
                    <th className="text-left p-2 font-medium">QR Code</th>
                  </tr>
                </thead>
                <tbody>
                  {setupData.proxyConfigs.map((proxy) => (
                    <tr key={proxy.chipId} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="p-2 font-medium">{proxy.chipName}</td>
                      <td className="p-2 font-mono text-xs">{proxy.wireguardIp}</td>
                      <td className="p-2 font-mono">{proxy.proxyPort}</td>
                      <td className="p-2">
                        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => {
                          fetch(`/api/wireguard/${proxy.chipId}`).then(r => r.json()).then(data => {
                            if (data.config) copyToClipboard(data.config, `qr-${proxy.chipId}`)
                          })
                        }}>
                          <QrCode className="size-3.5" /> Ver QR
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Instructions */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">3</span>
            <CardTitle className="text-lg">Passo a Passo</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {[
            { step: 1, title: 'No Servidor VPN', items: ['SSH para 187.77.48.22', 'Cole a config do Passo 1 em /etc/wireguard/wg0.conf', 'Execute: wg syncconf wg0 <(wg-quick strip wg0)', 'Verifique: wg show wg0'] },
            { step: 2, title: 'No Celular (para cada chip)', items: ['Instale o app WireGuard', 'Vá na aba Chips → ícone WireGuard → escaneie o QR Code', 'Ative o túnel VPN', 'Instale o app Every Proxy', 'Vá na aba SOCKS5 → ligue o switch (porta 1080)'] },
            { step: 3, title: 'No OctupusZap', items: ['Clique em "Auto-Configurar Proxies" acima', 'O sistema preenche Host + Porta automaticamente', 'A Evolution API passa a usar o proxy SOCKS5', 'Cada chip sai pelo IP 4G do celular!'] },
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
        </CardContent>
      </Card>
    </div>
  )
}

// ===== Usuários Tab =====
interface AdminUserItem {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  twoFactorEnabled: boolean
  imagem: string
  isSystemUser: boolean
  createdAt: string
  updatedAt: string
}

function UsuariosTab() {
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminUserItem | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'operador', active: true, isSystemUser: false })
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', active: true, password: '', isSystemUser: false })

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error('Erro ao carregar usuários')
      const data = await res.json()
      setUsers(data)
    } catch {
      toast.error('Erro ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const createUser = async () => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar usuário')
      toast.success('Usuário criado com sucesso!')
      setAddDialogOpen(false)
      setNewUser({ name: '', email: '', password: '', role: 'operador', active: true, isSystemUser: false })
      fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao criar usuário')
    }
  }

  const updateUser = async () => {
    if (!selectedUser) return
    try {
      const updateData: Record<string, any> = {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        active: editForm.active,
        isSystemUser: editForm.isSystemUser,
      }
      if (editForm.password) updateData.password = editForm.password

      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao atualizar usuário')
      toast.success('Usuário atualizado com sucesso!')
      setEditDialogOpen(false)
      setSelectedUser(null)
      fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao atualizar usuário')
    }
  }

  const deleteUser = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir usuário')
      toast.success('Usuário excluído com sucesso!')
      fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao excluir usuário')
    }
  }

  const openEditDialog = (user: AdminUserItem) => {
    setSelectedUser(user)
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      password: '',
      isSystemUser: user.isSystemUser,
    })
    setEditDialogOpen(true)
  }

  const roleLabel = (role: string) => {
    const map: Record<string, string> = { master: 'Master', admin: 'Admin', operador: 'Operador' }
    return map[role] || role
  }

  const roleBadgeColor = (role: string) => {
    const map: Record<string, string> = {
      master: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
      admin: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
      operador: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
    }
    return map[role] || ''
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const masterCount = users.filter(u => u.role === 'master' && u.active).length
  const adminCount = users.filter(u => u.role === 'admin' && u.active).length
  const operadorCount = users.filter(u => u.role === 'operador' && u.active).length
  const inactiveCount = users.filter(u => !u.active).length

  if (loading) {
    return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Usuários</h2>
          <p className="text-sm text-muted-foreground">Gerencie os usuários do sistema</p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
          onClick={() => setAddDialogOpen(true)}>
          <Plus className="size-4" /> Novo Usuário
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-violet-600">{masterCount}</p>
            <p className="text-xs text-muted-foreground">Masters ativos</p>
          </CardContent>
        </Card>
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-sky-600">{adminCount}</p>
            <p className="text-xs text-muted-foreground">Admins ativos</p>
          </CardContent>
        </Card>
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-zinc-600 dark:text-zinc-400">{operadorCount}</p>
            <p className="text-xs text-muted-foreground">Operadores ativos</p>
          </CardContent>
        </Card>
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-rose-600">{inactiveCount}</p>
            <p className="text-xs text-muted-foreground">Inativos</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, email ou papel..." value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
      </div>

      {/* Users List */}
      <Card className="shadow-lg border-0">
        <CardContent className="p-0">
          <div className="divide-y">
            {filteredUsers.map(user => (
              <div key={user.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                <div className={`flex size-10 items-center justify-center rounded-full ${
                  user.role === 'master' ? 'bg-gradient-to-br from-violet-400 to-purple-500' :
                  user.role === 'admin' ? 'bg-gradient-to-br from-sky-400 to-blue-500' :
                  'bg-gradient-to-br from-zinc-400 to-zinc-500'
                } shadow-md`}>
                  <span className="text-sm font-bold text-white">{user.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{user.name}</p>
                    {user.isSystemUser && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">Sistema</Badge>
                    )}
                    {!user.active && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inativo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                </div>
                <Badge className={roleBadgeColor(user.role)}>{roleLabel(user.role)}</Badge>
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditDialog(user)}>
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          onClick={() => setDeleteConfirm(user.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Excluir</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Users className="size-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhum usuário encontrado</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription>Crie um novo usuário no sistema</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Nome completo" value={newUser.name}
                onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" placeholder="email@exemplo.com" value={newUser.email}
                onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Senha</Label>
              <Input type="password" placeholder="Mínimo 6 caracteres" value={newUser.password}
                onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={newUser.role} onValueChange={v => setNewUser(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master — Acesso total</SelectItem>
                  <SelectItem value="admin">Admin — Operações + Anti-Ban</SelectItem>
                  <SelectItem value="operador">Operador — Envio e monitoramento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newUser.active} onCheckedChange={v => setNewUser(p => ({ ...p, active: v }))} />
              <Label>Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newUser.isSystemUser} onCheckedChange={v => setNewUser(p => ({ ...p, isSystemUser: v }))} />
              <Label>Usuário de sistema</Label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600"
              onClick={createUser} disabled={!newUser.name || !newUser.email || !newUser.password}>
              <Plus className="size-4" /> Criar Usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>Altere os dados do usuário</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" placeholder="Deixe vazio para manter a atual" value={editForm.password}
                onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master — Acesso total</SelectItem>
                  <SelectItem value="admin">Admin — Operações + Anti-Ban</SelectItem>
                  <SelectItem value="operador">Operador — Envio e monitoramento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editForm.active} onCheckedChange={v => setEditForm(p => ({ ...p, active: v }))} />
              <Label>Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editForm.isSystemUser} onCheckedChange={v => setEditForm(p => ({ ...p, isSystemUser: v }))} />
              <Label>Usuário de sistema</Label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600" onClick={updateUser}>
              <Pencil className="size-4" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Excluir Usuário" description="Tem certeza? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) { deleteUser(deleteConfirm); setDeleteConfirm(null) } }}
        confirmLabel="Excluir" />
    </div>
  )
}

// ===== Main App =====
export default function OctupusZapApp() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [username, setUsername] = useState('')
  const [userRole, setUserRole] = useState('operador')
  const [authLoading, setAuthLoading] = useState(true)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginErrorType, setLoginErrorType] = useState<'credentials' | 'locked' | 'database' | 'internal' | ''>('')
  const [forgotDialogOpen, setForgotDialogOpen] = useState(false)
  const [forgotForm, setForgotForm] = useState({ newPassword: '', confirmPassword: '', verificationKey: '' })
  const [forgotLoading, setForgotLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(data => {
      if (data.authenticated) {
        setLoggedIn(true)
        setUsername(data.user?.username || '')
        setUserRole(data.user?.role || 'operador')
        // If active tab is not accessible with user's role, reset to dashboard
        const userLevel = ROLE_LEVELS[data.user?.role || 'operador'] || 1
        const currentItem = NAV_ITEMS.find(n => n.id === activeTab)
        if (currentItem) {
          const requiredLevel = ROLE_LEVELS[currentItem.minRole] || 1
          if (userLevel < requiredLevel) setActiveTab('dashboard')
        }
      }
    }).catch(() => {}).finally(() => setAuthLoading(false))
  }, [])

  // Auto-refresh stats every 60 seconds when logged in
  useEffect(() => {
    if (!loggedIn) return
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    const interval = setInterval(() => {
      fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [loggedIn])

  // Auto-process campaigns every 60 seconds when logged in
  useEffect(() => {
    if (!loggedIn) return
    const processCampaigns = () => {
      fetch('/api/campaigns/process-all', { method: 'POST' }).catch(() => {})
    }
    // First process after 10 seconds (give time for page to load)
    const timeout = setTimeout(processCampaigns, 10000)
    // Then every 60 seconds
    const interval = setInterval(processCampaigns, 60000)
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, [loggedIn])

  const refreshStats = () => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
  }

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError('')
    setLoginErrorType('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await res.json()
      if (!res.ok) {
        // Detect error type from HTTP status code
        if (res.status === 429) {
          setLoginErrorType('locked')
          setLoginError(data.error || 'Muitas tentativas de login falharam. Tente novamente em 5 minutos.')
        } else if (res.status === 401) {
          setLoginErrorType('credentials')
          setLoginError(data.error || 'Email ou senha incorretos.')
        } else if (res.status === 503) {
          setLoginErrorType('database')
          setLoginError(data.error || 'Erro de conexão com o banco de dados.')
        } else {
          setLoginErrorType('internal')
          setLoginError(data.error || 'Erro interno do servidor.')
        }
        throw new Error(data.error || 'Erro ao fazer login')
      }
      setLoggedIn(true)
      setUsername(data.user?.name || loginForm.email)
      setUserRole(data.user?.role || 'operador')
      toast.success('Login realizado com sucesso!')
    } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao fazer login') }
    finally { setLoginLoading(false) }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setLoggedIn(false)
      setUsername('')
      toast.success('Logout realizado!')
    } catch { toast.error('Erro ao fazer logout') }
  }

  const handleForgotPassword = async () => {
    if (!forgotForm.newPassword || forgotForm.newPassword.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres')
      return
    }
    if (forgotForm.newPassword !== forgotForm.confirmPassword) {
      toast.error('As senhas não conferem')
      return
    }
    setForgotLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: forgotForm.newPassword, verificationKey: forgotForm.verificationKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao redefinir senha')
      toast.success('Senha redefinida com sucesso! Faça login com a nova senha.')
      setForgotDialogOpen(false)
      setForgotForm({ newPassword: '', confirmPassword: '', verificationKey: '' })
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao redefinir senha')
    } finally {
      setForgotLoading(false)
    }
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardTab stats={stats} onRefresh={refreshStats} setActiveTab={setActiveTab} />
      case 'chips': return <ChipsTab />
      case 'inbox': return <InboxTab />
      case 'contatos': return <ContatosTab />
      case 'verificar': return <VerificarSection />
      case 'campanhas': return <CampanhasTab />
      case 'templates': return <TemplatesTab />
      case 'chaves': return <KeysSection />
      case 'vendedores': return <VendedoresSection />
      case 'antiban': return <AntiBanTab />
      case 'mensagens': return <MensagensTab />
      case 'usuarios': return <UsuariosTab />
      case 'vps': return <VpsSetupTab />
      case 'config': return <ConfiguracoesTab />
      default: return <DashboardTab stats={stats} onRefresh={refreshStats} setActiveTab={setActiveTab} />
    }
  }

  // Auth loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <RefreshCw className="size-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  // Login screen
  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md">
          <Card className="shadow-2xl border-zinc-700/50 bg-zinc-900/80 backdrop-blur-xl">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-4">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.4 }}
                  className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-xl shadow-emerald-500/25"
                >
                  <Zap className="size-10 text-white" />
                </motion.div>
              </div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <CardTitle className="text-2xl text-white">OctupusZap</CardTitle>
                <CardDescription className="text-zinc-400">Faça login para acessar o painel</CardDescription>
              </motion.div>
            </CardHeader>
            <CardContent className="space-y-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="space-y-4">
                {/* Login Error Banner */}
                {loginError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
                      loginErrorType === 'locked'
                        ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                        : loginErrorType === 'database'
                        ? 'bg-sky-500/15 border border-sky-500/30 text-sky-300'
                        : loginErrorType === 'credentials'
                        ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {loginErrorType === 'locked' ? <AlertTriangle className="size-4 mt-0.5 shrink-0" /> : <XCircle className="size-4 mt-0.5 shrink-0" />}
                    <span>{loginError}</span>
                  </motion.div>
                )}
                <div className="space-y-2">
                  <Label className="text-zinc-300">Email</Label>
                  <Input
                    placeholder="seu@email.com"
                    value={loginForm.email}
                    onChange={e => { setLoginForm(p => ({ ...p, email: e.target.value })); setLoginError(''); setLoginErrorType('') }}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Senha</Label>
                  <Input
                    type="password"
                    placeholder="••••••"
                    value={loginForm.password}
                    onChange={e => { setLoginForm(p => ({ ...p, password: e.target.value })); setLoginError(''); setLoginErrorType('') }}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                  />
                </div>
                <Button
                  className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/25 text-white font-semibold h-11"
                  onClick={handleLogin}
                  disabled={loginLoading || !loginForm.email || !loginForm.password}
                >
                  {loginLoading ? <RefreshCw className="size-4 animate-spin" /> : <Lock className="size-4" />}
                  {loginLoading ? 'Entrando...' : 'Entrar'}
                </Button>
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors underline underline-offset-2"
                    onClick={() => setForgotDialogOpen(true)}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </motion.div>
            </CardContent>
          </Card>

          {/* Forgot Password Dialog */}
          <Dialog open={forgotDialogOpen} onOpenChange={setForgotDialogOpen}>
            <DialogContent className="bg-zinc-900 border-zinc-700 text-white">
              <DialogHeader>
                <DialogTitle className="text-white">Redefinir Senha</DialogTitle>
                <DialogDescription className="text-zinc-400">
                  Crie uma nova senha para acessar o painel. A recuperação é protegida pela Evolution API Key.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Evolution API Key (verificação)</Label>
                  <Input
                    type="password"
                    placeholder="Cole a API Key da Evolution API"
                    value={forgotForm.verificationKey}
                    onChange={e => setForgotForm(p => ({ ...p, verificationKey: e.target.value }))}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                  <p className="text-xs text-zinc-500">Encontre em: Configurações → Evolution API → API Key</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Nova Senha</Label>
                  <Input
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={forgotForm.newPassword}
                    onChange={e => setForgotForm(p => ({ ...p, newPassword: e.target.value }))}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Confirmar Nova Senha</Label>
                  <Input
                    type="password"
                    placeholder="Repita a nova senha"
                    value={forgotForm.confirmPassword}
                    onChange={e => setForgotForm(p => ({ ...p, confirmPassword: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-400">Por segurança, é necessário informar a Evolution API Key para redefinir a senha. Isso garante que apenas administradores com acesso à API possam alterar a senha.</p>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancelar</Button>
                </DialogClose>
                <Button
                  className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                  onClick={handleForgotPassword}
                  disabled={forgotLoading || !forgotForm.newPassword || !forgotForm.confirmPassword || !forgotForm.verificationKey}
                >
                  {forgotLoading ? <RefreshCw className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  {forgotLoading ? 'Redefinindo...' : 'Redefinir Senha'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>
      </div>
    )
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
          {NAV_ITEMS.filter(item => {
            const userLevel = ROLE_LEVELS[userRole] || 1
            const requiredLevel = ROLE_LEVELS[item.minRole] || 1
            return userLevel >= requiredLevel
          }).map(item => (
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

        <div className="p-4 m-3 rounded-xl bg-zinc-800/50 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-md">
              <span className="text-sm font-bold text-white">{username ? username.charAt(0).toUpperCase() : 'O'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{username || 'OctupusZap'}</p>
              <p className="text-xs text-zinc-400">{userRole === 'master' ? 'Master' : userRole === 'admin' ? 'Admin' : 'Operador'}</p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-rose-400 h-8 w-8 p-0" onClick={handleLogout}>
                    <LogOut className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sair</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2 px-1">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] text-zinc-500">Auto-refresh 60s • Auto-deploy</span>
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
                {NAV_ITEMS.filter(item => {
                  const userLevel = ROLE_LEVELS[userRole] || 1
                  const requiredLevel = ROLE_LEVELS[item.minRole] || 1
                  return userLevel >= requiredLevel
                }).map(item => (
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
        <footer className="px-4 lg:px-6 py-2.5 border-t bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>OctupusZap © {new Date().getFullYear()}</p>
            <p className="flex items-center gap-1">
              <Zap className="size-3 text-emerald-500" /> Powered by OctupusZap
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
