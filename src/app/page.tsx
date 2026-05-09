'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, Radio, Send, Shield, BarChart3, Plus, Trash2,
  Copy, RefreshCw, Check, X, Clock, Zap, Users, MessageSquare,
  Activity, AlertCircle, ChevronDown, FileText, Settings, Eye,
  Pause, Play, Edit, Upload, Search, CalendarDays,
  Phone, UserPlus, FileSpreadsheet, ArrowRight, ChevronRight,
  LayoutDashboard, ShieldCheck, Bell, Moon, Sun, Menu,
  Monitor, Database, TrendingUp, CircleDot, Wifi, WifiOff,
  Timer, ArrowUpRight, Loader2, QrCode, ChevronLeft
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { toast } from 'sonner'
import QRCode from 'qrcode'

// ===== Types =====
interface Chip {
  id: string; name: string; phoneNumber: string; wireguardIp: string;
  wireguardPrivKey: string; wireguardPubKey: string; socksPort: number;
  status: string; lastSeen: string | null; createdAt: string; updatedAt: string;
}
interface SequenceStep {
  id: string; campaignId: string; stepOrder: number; content: string;
  delayMinutes: number; createdAt: string;
}
interface Campaign {
  id: string; name: string; status: string; messageVariations: string;
  sendIntervalMin: number; sendIntervalMax: number; contactListId: string | null;
  scheduledAt: string | null; startedAt: string | null; completedAt: string | null;
  createdAt: string; updatedAt: string;
  chips: { id: string; chipId: string; chip: Chip }[];
  sequenceSteps: SequenceStep[];
  contactList: { id: string; name: string } | null;
  _count?: { messages: number };
}
interface ContactItem {
  id: string; name: string; phone: string; contactListId: string | null;
  chipId: string | null; createdAt: string;
  contactList?: { id: string; name: string } | null;
}
interface ContactList {
  id: string; name: string; createdAt: string; updatedAt: string;
  _count?: { contacts: number; campaigns: number };
}
interface MessageItem {
  id: string; campaignId: string | null; chipId: string; contactId: string;
  content: string; status: string; sentAt: string | null; deliveredAt: string | null;
  readAt: string | null; error: string | null; createdAt: string;
  chip: { name: string; phoneNumber: string };
  contact: { name: string; phone: string };
  campaign?: { name: string } | null;
}
interface Stats {
  totalChips: number; connectedChips: number; totalCampaigns: number;
  activeCampaigns: number; totalMessages: number; sentMessages: number;
  deliveredMessages: number; failedMessages: number; deliveryRate: number; totalContacts: number;
}

type TabId = 'dashboard' | 'dispositivos' | 'campanhas' | 'contatos' | 'mensagens' | 'antiban' | 'configuracoes'

// ===== Nav Items =====
const NAV_ITEMS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'dispositivos', label: 'Dispositivos', icon: <Smartphone className="size-4" /> },
  { id: 'campanhas', label: 'Campanhas', icon: <Radio className="size-4" /> },
  { id: 'contatos', label: 'Contatos', icon: <Users className="size-4" /> },
  { id: 'mensagens', label: 'Mensagens', icon: <MessageSquare className="size-4" /> },
  { id: 'antiban', label: 'Anti-Ban', icon: <ShieldCheck className="size-4" /> },
  { id: 'configuracoes', label: 'Configuracoes', icon: <Settings className="size-4" /> },
]

const SECTION_TITLES: Record<TabId, string> = {
  dashboard: 'Dashboard',
  dispositivos: 'Dispositivos',
  campanhas: 'Campanhas',
  contatos: 'Contatos',
  mensagens: 'Mensagens',
  antiban: 'Anti-Ban',
  configuracoes: 'Configuracoes',
}

// ===== Helper Components =====
function LoadingScreen() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="size-6 animate-spin text-emerald-500" />
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="flex size-14 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 mb-4">{icon}</div>
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">{description}</p>
      </CardContent>
    </Card>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: 'bg-emerald-500', connecting: 'bg-amber-500 animate-pulse',
    error: 'bg-rose-500', disconnected: 'bg-zinc-400',
    running: 'bg-emerald-500', paused: 'bg-amber-500', completed: 'bg-emerald-600',
    scheduled: 'bg-blue-500', draft: 'bg-zinc-400', cancelled: 'bg-rose-500',
    sent: 'bg-blue-400', delivered: 'bg-emerald-500', read: 'bg-emerald-600',
    pending: 'bg-zinc-400', failed: 'bg-rose-500',
  }
  return <span className={`inline-block size-2 rounded-full ${colors[status] || 'bg-zinc-400'}`} />
}

function DeviceStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    connected: { color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', label: 'Conectado' },
    connecting: { color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25', label: 'Conectando' },
    error: { color: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25', label: 'Erro' },
    disconnected: { color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25', label: 'Desconectado' },
  }
  const c = config[status] || config.disconnected
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.color}`}>
      <StatusDot status={status} /> {c.label}
    </span>
  )
}

function CampaignStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    draft: { color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25', label: 'Rascunho' },
    scheduled: { color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25', label: 'Agendada' },
    running: { color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', label: 'Executando' },
    paused: { color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25', label: 'Pausada' },
    completed: { color: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25', label: 'Concluida' },
    cancelled: { color: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25', label: 'Cancelada' },
  }
  const c = config[status] || config.draft
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.color}`}>
      <StatusDot status={status} /> {c.label}
    </span>
  )
}

function MessageStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    pending: { color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/25', label: 'Pendente' },
    sent: { color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25', label: 'Enviada' },
    delivered: { color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', label: 'Entregue' },
    read: { color: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25', label: 'Lida' },
    failed: { color: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25', label: 'Falhou' },
  }
  const c = config[status] || config.pending
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.color}`}>
      <StatusDot status={status} /> {c.label}
    </span>
  )
}

function ConfirmDialog({
  open, onOpenChange, title, description, onConfirm, confirmLabel = 'Confirmar', variant = 'destructive',
}: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string;
  onConfirm: () => void; confirmLabel?: string; variant?: 'destructive' | 'default';
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { onConfirm(); onOpenChange(false) }}
            className={variant === 'destructive' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}
          >{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function StatCard({ icon, value, label, subtitle, progress, delay = 0, accent = 'emerald' }: {
  icon: React.ReactNode; value: string | number; label: string; subtitle?: string;
  progress?: number; delay?: number; accent?: string;
}) {
  const accentMap: Record<string, string> = {
    emerald: 'from-emerald-500 to-emerald-600', purple: 'from-purple-500 to-purple-600',
    orange: 'from-orange-500 to-orange-600', rose: 'from-rose-500 to-rose-600',
    blue: 'from-blue-500 to-blue-600', amber: 'from-amber-500 to-amber-600',
  }
  const iconBg: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  }
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
      <Card className="border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
              {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            <div className={`flex size-10 items-center justify-center rounded-lg ${iconBg[accent]}`}>{icon}</div>
          </div>
          {progress !== undefined && (
            <div className="mt-3">
              <Progress value={progress} className="h-1.5 bg-zinc-100 dark:bg-zinc-800" />
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ===== DASHBOARD TAB =====
function DashboardTab({ stats, onNavigate }: { stats: Stats | null; onNavigate: (tab: TabId) => void }) {
  if (!stats) return <LoadingScreen />
  const s = {
    totalChips: stats.totalChips ?? 0, connectedChips: stats.connectedChips ?? 0,
    totalCampaigns: stats.totalCampaigns ?? 0, activeCampaigns: stats.activeCampaigns ?? 0,
    totalMessages: stats.totalMessages ?? 0, sentMessages: stats.sentMessages ?? 0,
    deliveredMessages: stats.deliveredMessages ?? 0, failedMessages: stats.failedMessages ?? 0,
    totalContacts: stats.totalContacts ?? 0,
  }
  const deliveryRate = s.totalMessages > 0 ? Math.round((s.deliveredMessages / s.totalMessages) * 100) : 0
  const connectionRate = s.totalChips > 0 ? Math.round((s.connectedChips / s.totalChips) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={<Smartphone className="size-5" />} value={s.totalChips} label="Total Dispositivos" subtitle={`${s.connectedChips} ativos`} progress={connectionRate} accent="purple" delay={0} />
        <StatCard icon={<Wifi className="size-5" />} value={s.connectedChips} label="Dispositivos Ativos" subtitle={`${connectionRate}% conectados`} accent="emerald" delay={0.05} />
        <StatCard icon={<Radio className="size-5" />} value={s.activeCampaigns} label="Campanhas Ativas" subtitle={`${s.totalCampaigns} total`} accent="blue" delay={0.1} />
        <StatCard icon={<Send className="size-5" />} value={s.totalMessages} label="Mensagens Enviadas" subtitle={`${s.sentMessages} entregues`} accent="orange" delay={0.15} />
        <StatCard icon={<TrendingUp className="size-5" />} value={`${deliveryRate}%`} label="Taxa de Entrega" subtitle={`${s.deliveredMessages}/${s.totalMessages}`} progress={deliveryRate} accent="emerald" delay={0.2} />
        <StatCard icon={<Users className="size-5" />} value={s.totalContacts} label="Contatos Total" subtitle="em todas as listas" accent="purple" delay={0.25} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Resumo de Mensagens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: 'Pendentes', value: Math.max(0, s.totalMessages - s.sentMessages - s.failedMessages), color: 'text-zinc-500', icon: <Clock className="size-4" /> },
                { label: 'Enviadas', value: s.sentMessages, color: 'text-blue-500', icon: <Send className="size-4" /> },
                { label: 'Entregues', value: s.deliveredMessages, color: 'text-emerald-500', icon: <Check className="size-4" /> },
                { label: 'Falharam', value: s.failedMessages, color: 'text-rose-500', icon: <X className="size-4" /> },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`${item.color}`}>{item.icon}</div>
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                  </div>
                  <span className="text-sm font-semibold">{item.value}</span>
                </div>
              ))}
              {s.totalMessages > 0 && (
                <div className="pt-2">
                  <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    {s.failedMessages > 0 && <div className="bg-rose-500 h-full" style={{ width: `${(s.failedMessages / s.totalMessages) * 100}%` }} />}
                    {s.sentMessages - s.deliveredMessages > 0 && <div className="bg-blue-400 h-full" style={{ width: `${((s.sentMessages - s.deliveredMessages) / s.totalMessages) * 100}%` }} />}
                    {s.deliveredMessages > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${(s.deliveredMessages / s.totalMessages) * 100}%` }} />}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Acoes Rapidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2.5 h-10 text-sm font-normal" onClick={() => onNavigate('dispositivos')}>
              <Plus className="size-4 text-emerald-500" /> Novo Dispositivo
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2.5 h-10 text-sm font-normal" onClick={() => onNavigate('campanhas')}>
              <Plus className="size-4 text-blue-500" /> Nova Campanha
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2.5 h-10 text-sm font-normal" onClick={() => onNavigate('contatos')}>
              <UserPlus className="size-4 text-purple-500" /> Importar Contatos
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2.5 h-10 text-sm font-normal" onClick={() => onNavigate('mensagens')}>
              <Eye className="size-4 text-orange-500" /> Ver Mensagens
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ===== DISPOSITIVOS TAB =====
function DispositivosTab() {
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedChip, setSelectedChip] = useState<Chip | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [qrStatus, setQrStatus] = useState<'idle' | 'generating' | 'ready' | 'scanned'>('idle')
  const [newChip, setNewChip] = useState({ name: '', phoneNumber: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      setChips(await res.json())
    } catch { toast.error('Erro ao carregar dispositivos') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { fetchChips() }, [fetchChips])

  const createChip = async () => {
    try {
      const res = await fetch('/api/chips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newChip) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Dispositivo criado com sucesso')
      setAddOpen(false); setNewChip({ name: '', phoneNumber: '' }); fetchChips()
    } catch (e: unknown) { toast.error((e as Error).message || 'Erro ao criar dispositivo') }
  }

  const deleteChip = async (id: string) => {
    try { await fetch(`/api/chips/${id}`, { method: 'DELETE' }); toast.success('Dispositivo removido'); fetchChips() }
    catch { toast.error('Erro ao remover dispositivo') }
  }

  const updateStatus = async (id: string, status: string) => {
    try { await fetch(`/api/chips/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); fetchChips() }
    catch { toast.error('Erro ao atualizar status') }
  }

  const generateQR = async (chip: Chip) => {
    setSelectedChip(chip); setQrOpen(true); setQrStatus('generating')
    try {
      const res = await fetch(`/api/wireguard/${chip.id}`)
      const data = await res.json()
      const url = await QRCode.toDataURL(data.config, { width: 280, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      setQrUrl(url); setQrStatus('ready')
    } catch { setQrStatus('idle'); toast.error('Erro ao gerar QR Code') }
  }

  const openDetail = (chip: Chip) => { setSelectedChip(chip); setDetailOpen(true) }

  if (loading) return <LoadingScreen />
  if (chips.length === 0) return <EmptyState icon={<Smartphone className="size-7 text-muted-foreground" />} title="Nenhum dispositivo cadastrado" description="Adicione um dispositivo para comecar a enviar mensagens" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{chips.length} dispositivo{chips.length !== 1 ? 's' : ''} cadastrado{chips.length !== 1 ? 's' : ''}</p>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="size-4" /> Novo Dispositivo</Button>
          </DialogTrigger>
          <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
            <DialogHeader><DialogTitle>Adicionar Dispositivo</DialogTitle><DialogDescription>Cadastre um novo dispositivo para envio de mensagens</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label>Nome do Dispositivo</Label><Input placeholder="Ex: Claro 01" value={newChip.name} onChange={e => setNewChip(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Numero de Telefone</Label><Input placeholder="Ex: 11999990001" value={newChip.phoneNumber} onChange={e => setNewChip(p => ({ ...p, phoneNumber: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createChip} disabled={!newChip.name || !newChip.phoneNumber} className="bg-emerald-600 hover:bg-emerald-700 text-white">Criar Dispositivo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader><TableRow className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Nome</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Telefone</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">IP / Proxy</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Ultimo Vista</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Acoes</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {chips.map((chip) => (
              <TableRow key={chip.id} className="border-zinc-100 dark:border-zinc-800/50">
                <TableCell className="font-medium">{chip.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{chip.phoneNumber}</TableCell>
                <TableCell><DeviceStatusBadge status={chip.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{chip.wireguardIp}:{chip.socksPort}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{chip.lastSeen ? new Date(chip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => generateQR(chip)}><QrCode className="size-3.5" />QR</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openDetail(chip)}><Eye className="size-3.5" /></Button>
                    {chip.status === 'disconnected' && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => updateStatus(chip.id, 'connected')}>Conectar</Button>
                    )}
                    {chip.status === 'connected' && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600" onClick={() => updateStatus(chip.id, 'disconnected')}>Desconectar</Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => setDeleteConfirm(chip.id)}><Trash2 className="size-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)} title="Remover Dispositivo" description="Tem certeza que deseja remover este dispositivo? Esta acao nao pode ser desfeita." onConfirm={() => { if (deleteConfirm) deleteChip(deleteConfirm) }} confirmLabel="Remover" />

      {/* QR Code Dialog */}
      <Dialog open={qrOpen} onOpenChange={(v) => { setQrOpen(v); if (!v) { setQrUrl(''); setQrStatus('idle'); setSelectedChip(null) } }}>
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><QrCode className="size-5 text-emerald-500" />Conexao WhatsApp</DialogTitle><DialogDescription>Escaneie o QR Code com o WhatsApp do dispositivo</DialogDescription></DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="relative">
              {qrStatus === 'generating' && (
                <div className="w-64 h-64 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-emerald-500" />
                </div>
              )}
              {qrStatus === 'ready' && (
                <div className="bg-white p-3 rounded-xl shadow-lg border border-zinc-200">
                  <img src={qrUrl} alt="QR Code" className="w-60 h-60" />
                </div>
              )}
              {qrStatus === 'idle' && (
                <div className="w-64 h-64 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center">
                  <div className="text-center"><Eye className="size-8 text-muted-foreground mx-auto mb-2" /><p className="text-xs text-muted-foreground">QR Code</p></div>
                </div>
              )}
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Aguardando scan...</p>
              <p className="text-xs text-muted-foreground">Abra o WhatsApp e escaneie o codigo acima</p>
              {selectedChip && <p className="text-xs text-muted-foreground mt-2">Dispositivo: {selectedChip.name}</p>}
            </div>
            <div className="w-full grid grid-cols-2 gap-3">
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-2.5 text-center">
                <p className="text-xs text-muted-foreground">IP</p>
                <p className="text-xs font-mono font-medium">{selectedChip?.wireguardIp || '-'}</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-2.5 text-center">
                <p className="text-xs text-muted-foreground">Porta</p>
                <p className="text-xs font-mono font-medium">{selectedChip?.socksPort || '-'}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(v) => { setDetailOpen(v); if (!v) setSelectedChip(null) }}>
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-w-md">
          <DialogHeader><DialogTitle>Detalhes do Dispositivo</DialogTitle></DialogHeader>
          {selectedChip && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex size-12 items-center justify-center rounded-xl bg-purple-500/10"><Smartphone className="size-6 text-purple-500" /></div>
                <div><p className="font-semibold">{selectedChip.name}</p><p className="text-sm text-muted-foreground font-mono">{selectedChip.phoneNumber}</p></div>
              </div>
              {[
                ['Status', <DeviceStatusBadge key="s" status={selectedChip.status} />],
                ['IP WireGuard', <span key="ip" className="font-mono text-sm">{selectedChip.wireguardIp}</span>],
                ['Porta SOCKS', <span key="sp" className="font-mono text-sm">{selectedChip.socksPort}</span>],
                ['Ultimo Vista', <span key="lv" className="text-sm">{selectedChip.lastSeen ? new Date(selectedChip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</span>],
                ['Criado em', <span key="ca" className="text-sm">{new Date(selectedChip.createdAt).toLocaleDateString('pt-BR')}</span>],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label as string}</span>{value}</div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== CAMPANHAS TAB =====
function CampanhasTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([])
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [availableLists, setAvailableLists] = useState<ContactList[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [step, setStep] = useState(0)

  const emptyCampaign = { name: '', sendIntervalMin: 30, sendIntervalMax: 90, chipIds: [] as string[], contactListId: '', scheduledAt: '', useSequence: false, sequenceSteps: [{ content: '', delayMinutes: 0 }], messageVariations: [''], dailyLimit: 200 }
  const [nc, setNc] = useState(emptyCampaign)
  const resetNc = () => { setNc(emptyCampaign); setStep(0) }

  const fetchCampaigns = useCallback(async () => { try { setCampaigns(await (await fetch('/api/campaigns')).json()) } catch { toast.error('Erro ao carregar campanhas') } finally { setLoading(false) } }, [])
  const fetchChips = useCallback(async () => { try { setAvailableChips(await (await fetch('/api/chips')).json()) } catch { /* */ } }, [])
  const fetchLists = useCallback(async () => { try { setAvailableLists(await (await fetch('/api/contact-lists')).json()) } catch { /* */ } }, [])
  useEffect(() => { fetchCampaigns(); fetchChips(); fetchLists() }, [fetchCampaigns, fetchChips, fetchLists])

  const createCampaign = async () => {
    const steps = nc.useSequence ? nc.sequenceSteps.map((s, i) => ({ stepOrder: i + 1, content: s.content, delayMinutes: s.delayMinutes })) : []
    try {
      const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nc.name, sendIntervalMin: nc.sendIntervalMin, sendIntervalMax: nc.sendIntervalMax, chipIds: nc.chipIds, contactListId: nc.contactListId || null, scheduledAt: nc.scheduledAt ? new Date(nc.scheduledAt).toISOString() : null, steps }) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Campanha criada com sucesso'); setCreateOpen(false); resetNc(); fetchCampaigns()
    } catch (e: unknown) { toast.error((e as Error).message || 'Erro ao criar campanha') }
  }

  const updateStatus = async (id: string, status: string) => {
    try { await fetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); toast.success('Status atualizado'); fetchCampaigns() }
    catch { toast.error('Erro ao atualizar status') }
  }

  const deleteCampaign = async (id: string) => {
    try { await fetch(`/api/campaigns/${id}`, { method: 'DELETE' }); toast.success('Campanha removida'); fetchCampaigns() }
    catch { toast.error('Erro ao remover campanha') }
  }

  const openDetail = async (c: Campaign) => {
    setSelectedCampaign(c); setDetailOpen(true)
    try { setDetailMessages(await (await fetch(`/api/messages?campaignId=${c.id}`)).json()) }
    catch { setDetailMessages([]) }
  }

  const toggleChip = (id: string) => setNc(p => ({ ...p, chipIds: p.chipIds.includes(id) ? p.chipIds.filter(x => x !== id) : [...p.chipIds, id] }))
  const canCreate = nc.name.trim() && nc.chipIds.length > 0 && (nc.useSequence ? nc.sequenceSteps.some(s => s.content.trim()) : nc.messageVariations.some(v => v.trim()))

  const STEPS = ['Info Basica', 'Dispositivos', 'Contatos', 'Mensagem', 'Intervalo']

  if (loading) return <LoadingScreen />
  if (campaigns.length === 0) return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) resetNc() }}>
          <DialogTrigger asChild><Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="size-4" /> Nova Campanha</Button></DialogTrigger>
          <CreateCampaignDialog nc={nc} setNc={setNc} step={step} setStep={setStep} availableChips={availableChips} availableLists={availableLists} toggleChip={toggleChip} canCreate={canCreate} createCampaign={createCampaign} />
        </Dialog>
      </div>
      <EmptyState icon={<Radio className="size-7 text-muted-foreground" />} title="Nenhuma campanha criada" description="Crie sua primeira campanha para comecar a enviar mensagens em massa" />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{campaigns.length} campanha{campaigns.length !== 1 ? 's' : ''}</p>
        <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) resetNc() }}>
          <DialogTrigger asChild><Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="size-4" /> Nova Campanha</Button></DialogTrigger>
          <CreateCampaignDialog nc={nc} setNc={setNc} step={step} setStep={setStep} availableChips={availableChips} availableLists={availableLists} toggleChip={toggleChip} canCreate={canCreate} createCampaign={createCampaign} />
        </Dialog>
      </div>

      <Card className="border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader><TableRow className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Nome</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Dispositivos</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Contatos</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Mensagens</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider">Agendamento</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Acoes</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {campaigns.map(c => (
              <TableRow key={c.id} className="border-zinc-100 dark:border-zinc-800/50">
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><CampaignStatusBadge status={c.status} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.chips.length}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.contactList?.name || '-'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c._count?.messages || 0}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.scheduledAt ? new Date(c.scheduledAt).toLocaleString('pt-BR') : (c.startedAt ? new Date(c.startedAt).toLocaleString('pt-BR') : '-')}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openDetail(c)}><Eye className="size-3.5" /></Button>
                    {c.status === 'draft' && <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => updateStatus(c.id, 'running')}>Iniciar</Button>}
                    {c.status === 'running' && <Button variant="ghost" size="sm" className="h-7 text-xs text-amber-600" onClick={() => updateStatus(c.id, 'paused')}>Pausar</Button>}
                    {c.status === 'paused' && <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => updateStatus(c.id, 'running')}>Retomar</Button>}
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => setDeleteConfirm(c.id)}><Trash2 className="size-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)} title="Remover Campanha" description="Tem certeza que deseja remover esta campanha e todas as mensagens associadas?" onConfirm={() => { if (deleteConfirm) deleteCampaign(deleteConfirm) }} />

      <Dialog open={detailOpen} onOpenChange={(v) => { setDetailOpen(v); if (!v) { setSelectedCampaign(null); setDetailMessages([]) } }}>
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selectedCampaign?.name}</DialogTitle><DialogDescription>Detalhes da campanha</DialogDescription></DialogHeader>
          {selectedCampaign && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-4 text-sm">
                <CampaignStatusBadge status={selectedCampaign.status} />
                <span className="text-muted-foreground">{selectedCampaign.chips.length} dispositivos</span>
                {selectedCampaign.contactList && <span className="text-muted-foreground">Lista: {selectedCampaign.contactList.name}</span>}
              </div>
              {selectedCampaign.sequenceSteps.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Etapas da Sequencia</p>
                  <div className="space-y-2">
                    {selectedCampaign.sequenceSteps.sort((a, b) => a.stepOrder - b.stepOrder).map((s, i, arr) => (
                      <div key={s.id} className="flex items-center gap-3">
                        <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold shrink-0">{i + 1}</div>
                        <p className="text-sm flex-1 line-clamp-1">{s.content || '(vazio)'}</p>
                        {i < arr.length - 1 && <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"><Timer className="size-3" />{s.delayMinutes}min</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Mensagens ({detailMessages.length})</p>
                {detailMessages.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {detailMessages.slice(0, 20).map(m => (
                      <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-sm">
                        <span className="truncate max-w-[200px]">{m.contact.name}</span>
                        <MessageStatusBadge status={m.status} />
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Nenhuma mensagem enviada</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateCampaignDialog({ nc, setNc, step, setStep, availableChips, availableLists, toggleChip, canCreate, createCampaign }: {
  nc: typeof CampanhasTab extends () => JSX.Element ? any : any
  setNc: React.Dispatch<React.SetStateAction<any>>
  step: number; setStep: React.Dispatch<React.SetStateAction<number>>
  availableChips: Chip[]; availableLists: ContactList[]
  toggleChip: (id: string) => void; canCreate: boolean; createCampaign: () => void
}) {
  return (
    <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-w-xl">
      <DialogHeader>
        <DialogTitle>Nova Campanha</DialogTitle>
        <DialogDescription>Configure sua campanha de envio em massa</DialogDescription>
      </DialogHeader>
      {/* Step indicators */}
      <div className="flex items-center gap-1 py-2">
        {['Info', 'Disp.', 'Contatos', 'Msg', 'Intervalo'].map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <div className={`flex-1 h-0.5 rounded ${i <= step ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'}`} />}
            <button onClick={() => setStep(i)} className={`flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${i === step ? 'bg-emerald-500 text-white' : i < step ? 'bg-emerald-500/20 text-emerald-600' : 'bg-zinc-100 dark:bg-zinc-800 text-muted-foreground'}`}>{i + 1}</button>
          </React.Fragment>
        ))}
      </div>

      <div className="min-h-[280px]">
        {/* Step 0: Basic Info */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nome da Campanha</Label><Input placeholder="Ex: Campanha Black Friday" value={nc.name} onChange={e => setNc(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Descricao (opcional)</Label><Textarea placeholder="Descreva o objetivo desta campanha" rows={3} /></div>
          </div>
        )}
        {/* Step 1: Devices */}
        {step === 1 && (
          <div className="space-y-3">
            <Label>Selecione os Dispositivos</Label>
            {availableChips.length === 0 && <p className="text-sm text-muted-foreground">Nenhum dispositivo disponivel. Cadastre um na aba Dispositivos.</p>}
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5">
                {availableChips.map(chip => (
                  <label key={chip.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer">
                    <Checkbox checked={nc.chipIds.includes(chip.id)} onCheckedChange={() => toggleChip(chip.id)} />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium">{chip.name}</p><p className="text-xs text-muted-foreground font-mono">{chip.phoneNumber}</p></div>
                    <DeviceStatusBadge status={chip.status} />
                  </label>
                ))}
              </div>
            </ScrollArea>
            {nc.chipIds.length > 0 && <p className="text-xs text-emerald-600">{nc.chipIds.length} dispositivo{nc.chipIds.length !== 1 ? 's' : ''} selecionado{nc.chipIds.length !== 1 ? 's' : ''}</p>}
          </div>
        )}
        {/* Step 2: Contacts */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lista de Contatos</Label>
              <Select value={nc.contactListId} onValueChange={v => setNc(p => ({ ...p, contactListId: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione uma lista de contatos" /></SelectTrigger>
                <SelectContent>
                  {availableLists.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l._count?.contacts || 0} contatos)</SelectItem>)}
                </SelectContent>
              </Select>
              {availableLists.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma lista criada. Va para a aba Contatos para criar uma.</p>}
            </div>
          </div>
        )}
        {/* Step 3: Message Config */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Tipo de Mensagem</Label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${!nc.useSequence ? 'font-semibold text-emerald-600' : 'text-muted-foreground'}`}>Variacoes</span>
                <Switch checked={nc.useSequence} onCheckedChange={v => setNc(p => ({ ...p, useSequence: v }))} />
                <span className={`text-xs ${nc.useSequence ? 'font-semibold text-emerald-600' : 'text-muted-foreground'}`}>Sequencia</span>
              </div>
            </div>
            {!nc.useSequence ? (
              <div className="space-y-2">
                <Label>Variacoes de Mensagem ({nc.messageVariations.length})</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {nc.messageVariations.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <Textarea placeholder={`Variacao ${i + 1}`} value={v} onChange={e => { const nv = [...nc.messageVariations]; nv[i] = e.target.value; setNc(p => ({ ...p, messageVariations: nv })) }} rows={2} className="flex-1" />
                      {nc.messageVariations.length > 1 && <Button variant="ghost" size="sm" className="shrink-0 text-rose-500" onClick={() => setNc(p => ({ ...p, messageVariations: p.messageVariations.filter((_, x) => x !== i) }))}><X className="size-4" /></Button>}
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setNc(p => ({ ...p, messageVariations: [...p.messageVariations, ''] }))}><Plus className="size-3.5" /> Adicionar Variacao</Button>
                <p className="text-xs text-muted-foreground">Uma variacao aleatoria sera selecionada para cada contato. Use {"{nome}"} para personalizar.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Label>Etapas da Sequencia</Label>
                <div className="space-y-3 max-h-56 overflow-y-auto">
                  {nc.sequenceSteps.map((s, i, arr) => (
                    <div key={i} className="space-y-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold">{i + 1}</span>
                        <span className="text-xs font-medium">Etapa {i + 1}</span>
                        {nc.sequenceSteps.length > 1 && <Button variant="ghost" size="sm" className="ml-auto h-6 text-rose-500" onClick={() => setNc(p => ({ ...p, sequenceSteps: p.sequenceSteps.filter((_, x) => x !== i) }))}><X className="size-3" /></Button>}
                      </div>
                      <Textarea placeholder="Mensagem desta etapa..." value={s.content} onChange={e => { const ns = [...nc.sequenceSteps]; ns[i] = { ...ns[i], content: e.target.value }; setNc(p => ({ ...p, sequenceSteps: ns })) }} rows={2} />
                      <div className="flex items-center gap-2">
                        <Label className="text-xs whitespace-nowrap">Atraso:</Label>
                        <Input type="number" min={0} value={s.delayMinutes} onChange={e => { const ns = [...nc.sequenceSteps]; ns[i] = { ...ns[i], delayMinutes: parseInt(e.target.value) || 0 }; setNc(p => ({ ...p, sequenceSteps: ns })) }} className="w-20 h-8 text-xs" />
                        <span className="text-xs text-muted-foreground">minutos</span>
                      </div>
                      {/* Timeline */}
                      {i < arr.length - 1 && (
                        <div className="flex items-center gap-2 pt-1">
                          <div className="flex-1 border-t border-dashed border-emerald-500/30" />
                          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><ArrowRight className="size-3" />{s.delayMinutes}min</span>
                          <div className="flex-1 border-t border-dashed border-emerald-500/30" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {nc.sequenceSteps.length < 10 && (
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => setNc(p => ({ ...p, sequenceSteps: [...p.sequenceSteps, { content: '', delayMinutes: 60 }] }))}><Plus className="size-3.5" /> Adicionar Etapa</Button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Step 4: Timing */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Intervalo entre mensagens (segundos)</Label>
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1"><Label className="text-xs text-muted-foreground">Minimo</Label><Input type="number" min={5} value={nc.sendIntervalMin} onChange={e => setNc(p => ({ ...p, sendIntervalMin: parseInt(e.target.value) || 30 }))} /></div>
                <span className="text-muted-foreground pt-5">a</span>
                <div className="flex-1 space-y-1"><Label className="text-xs text-muted-foreground">Maximo</Label><Input type="number" min={5} value={nc.sendIntervalMax} onChange={e => setNc(p => ({ ...p, sendIntervalMax: parseInt(e.target.value) || 90 }))} /></div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Limite diario (mensagens por dispositivo)</Label>
              <Input type="number" min={1} value={nc.dailyLimit} onChange={e => setNc(p => ({ ...p, dailyLimit: parseInt(e.target.value) || 200 }))} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /> Agendamento (opcional)</Label>
              <Input type="datetime-local" value={nc.scheduledAt} onChange={e => setNc(p => ({ ...p, scheduledAt: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Deixe vazio para execucao imediata</p>
            </div>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
        {step > 0 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>Voltar</Button>}
        {step < 4 ? (
          <Button onClick={() => setStep(s => s + 1)} className="bg-emerald-600 hover:bg-emerald-700 text-white">Proximo</Button>
        ) : (
          <Button onClick={createCampaign} disabled={!canCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">Criar Campanha</Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}

// ===== CONTATOS TAB =====
function ContatosTab() {
  const [lists, setLists] = useState<ContactList[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [contactsTotal, setContactsTotal] = useState(0)
  const [listsLoading, setListsLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [subTab, setSubTab] = useState<'lists' | 'contacts'>('lists')
  const [createListOpen, setCreateListOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newContact, setNewContact] = useState({ name: '', phone: '', contactListId: '' })
  const [deleteListConfirm, setDeleteListConfirm] = useState<string | null>(null)
  const [selectedListId, setSelectedListId] = useState('')
  const [search, setSearch] = useState('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<string[][]>([])
  const [csvMapping, setCsvMapping] = useState({ name: 0, phone: 1 })
  const [csvTargetList, setCsvTargetList] = useState('')
  const [importing, setImporting] = useState(false)

  const fetchLists = useCallback(async () => {
    try { setLists(await (await fetch('/api/contact-lists')).json()) } catch { toast.error('Erro ao carregar listas') }
    finally { setListsLoading(false) }
  }, [])

  const fetchContacts = useCallback(async (listId?: string, s?: string) => {
    setContactsLoading(true)
    try {
      const params = new URLSearchParams()
      if (listId) params.set('contactListId', listId)
      if (s) params.set('search', s)
      const data = await (await fetch(`/api/contacts?${params}`)).json()
      setContacts(data.contacts || data || []); setContactsTotal(data.total || 0)
    } catch { toast.error('Erro ao carregar contatos') }
    finally { setContactsLoading(false) }
  }, [])

  useEffect(() => { fetchLists() }, [fetchLists])
  useEffect(() => { if (subTab === 'contacts') fetchContacts(selectedListId || undefined, search) }, [subTab, selectedListId, search, fetchContacts])

  const createList = async () => {
    try { await fetch('/api/contact-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newListName }) }); toast.success('Lista criada'); setCreateListOpen(false); setNewListName(''); fetchLists() }
    catch { toast.error('Erro ao criar lista') }
  }

  const deleteList = async (id: string) => {
    try { await fetch(`/api/contact-lists?id=${id}`, { method: 'DELETE' }); toast.success('Lista removida'); fetchLists() }
    catch { toast.error('Erro ao remover lista') }
  }

  const addContact = async () => {
    try {
      const res = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contacts: [{ name: newContact.name, phone: newContact.phone }], contactListId: newContact.contactListId || null }) })
      if (!res.ok) throw new Error()
      toast.success('Contato adicionado'); setAddContactOpen(false); setNewContact({ name: '', phone: '', contactListId: '' })
      if (subTab === 'contacts') fetchContacts(selectedListId || undefined, search)
    } catch { toast.error('Erro ao adicionar contato') }
  }

  const handleCSVFile = (file: File) => {
    setCsvFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const lines = text.split('\n').filter(l => l.trim()).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')))
      setCsvPreview(lines.slice(0, 6))
      if (lines[0]?.length >= 2) setCsvMapping({ name: 0, phone: 1 })
    }
    reader.readAsText(file)
  }

  const importCSV = async () => {
    if (!csvFile || !csvTargetList) return
    setImporting(true)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const text = e.target?.result as string
        const lines = text.split('\n').filter(l => l.trim()).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')))
        const contacts = lines.map(l => ({ name: l[csvMapping.name] || '', phone: l[csvMapping.phone] || '' })).filter(c => c.name && c.phone)
        const res = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contacts, contactListId: csvTargetList }) })
        const data = await res.json()
        toast.success(`${data.created} contatos importados${data.errors > 0 ? `, ${data.errors} erros` : ''}`)
        setImportOpen(false); setCsvFile(null); setCsvPreview([]); setImporting(false); fetchLists()
      }
      reader.readAsText(csvFile)
    } catch { setImporting(false); toast.error('Erro ao importar CSV') }
  }

  return (
    <div className="space-y-4">
      {/* Sub tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(['lists', 'contacts'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${subTab === t ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t === 'lists' ? 'Listas de Contatos' : 'Contatos Individuais'}
          </button>
        ))}
      </div>

      {subTab === 'lists' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{lists.length} lista{lists.length !== 1 ? 's' : ''}</p>
            <div className="flex gap-2">
              <Dialog open={importOpen} onOpenChange={(v) => { setImportOpen(v); if (!v) { setCsvFile(null); setCsvPreview([]) } }}>
                <DialogTrigger asChild><Button variant="outline" className="gap-2"><Upload className="size-4" /> Importar CSV</Button></DialogTrigger>
                <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <DialogHeader><DialogTitle>Importar CSV</DialogTitle><DialogDescription>Carregue um arquivo CSV com os contatos</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>Lista de Destino</Label>
                      <Select value={csvTargetList} onValueChange={setCsvTargetList}>
                        <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                        <SelectContent>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Arquivo CSV</Label>
                      <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center hover:border-emerald-500/50 transition-colors cursor-pointer" onClick={() => document.getElementById('csv-input')?.click()}>
                        {csvFile ? <div className="flex items-center justify-center gap-2"><FileSpreadsheet className="size-5 text-emerald-500" /><span className="text-sm font-medium">{csvFile.name}</span></div> : <div><Upload className="size-6 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">Clique ou arraste um arquivo CSV</p></div>}
                        <input id="csv-input" type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleCSVFile(e.target.files[0])} />
                      </div>
                    </div>
                    {csvPreview.length > 0 && (
                      <div className="space-y-2">
                        <Label>Preview ({csvPreview.length} linhas)</Label>
                        <Card className="border-zinc-200 dark:border-zinc-800 overflow-hidden">
                          <Table>
                            <TableHeader><TableRow className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                              {csvPreview[0]?.map((h, i) => <TableHead key={i} className="font-semibold text-xs">{h}</TableHead>)}
                            </TableRow></TableHeader>
                            <TableBody>
                              {csvPreview.slice(1, 5).map((row, ri) => <TableRow key={ri} className="border-zinc-100 dark:border-zinc-800/50">{row.map((cell, ci) => <TableCell key={ci} className="text-xs">{cell}</TableCell>)}</TableRow>)}
                            </TableBody>
                          </Table>
                        </Card>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                    <Button onClick={importCSV} disabled={!csvFile || !csvTargetList || importing} className="bg-emerald-600 hover:bg-emerald-700 text-white">{importing ? <Loader2 className="size-4 animate-spin" /> : 'Importar'}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
                <DialogTrigger asChild><Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="size-4" /> Nova Lista</Button></DialogTrigger>
                <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <DialogHeader><DialogTitle>Criar Lista de Contatos</DialogTitle></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2"><Label>Nome da Lista</Label><Input placeholder="Ex: Clientes VIP" value={newListName} onChange={e => setNewListName(e.target.value)} /></div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                    <Button onClick={createList} disabled={!newListName.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white">Criar Lista</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {listsLoading ? <LoadingScreen /> : lists.length === 0 ? (
            <EmptyState icon={<Users className="size-7 text-muted-foreground" />} title="Nenhuma lista criada" description="Crie uma lista para organizar seus contatos" />
          ) : (
            <Card className="border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <Table>
                <TableHeader><TableRow className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Nome</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Total Contatos</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Campanhas</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Criado em</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Acoes</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {lists.map(l => (
                    <TableRow key={l.id} className="border-zinc-100 dark:border-zinc-800/50">
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l._count?.contacts || 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l._count?.campaigns || 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSelectedListId(l.id); setSubTab('contacts') }}>Ver Contatos</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => setDeleteListConfirm(l.id)}><Trash2 className="size-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <ConfirmDialog open={!!deleteListConfirm} onOpenChange={() => setDeleteListConfirm(null)} title="Remover Lista" description="Tem certeza? Todos os contatos desta lista serao removidos." onConfirm={() => { if (deleteListConfirm) deleteList(deleteListConfirm) }} />
        </>
      )}

      {subTab === 'contacts' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome ou telefone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <Select value={selectedListId} onValueChange={setSelectedListId}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Todas as listas" /></SelectTrigger>
              <SelectContent><SelectItem value="">Todas as listas</SelectItem>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
            <Dialog open={addContactOpen} onOpenChange={setAddContactOpen}>
              <DialogTrigger asChild><Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><UserPlus className="size-4" /> Adicionar</Button></DialogTrigger>
              <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                <DialogHeader><DialogTitle>Adicionar Contato</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2"><Label>Nome</Label><Input placeholder="Nome do contato" value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Telefone</Label><Input placeholder="11999990001" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} /></div>
                  <div className="space-y-2">
                    <Label>Lista (opcional)</Label>
                    <Select value={newContact.contactListId} onValueChange={v => setNewContact(p => ({ ...p, contactListId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Sem lista" /></SelectTrigger>
                      <SelectContent>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                  <Button onClick={addContact} disabled={!newContact.name || !newContact.phone} className="bg-emerald-600 hover:bg-emerald-700 text-white">Adicionar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {contactsLoading ? <LoadingScreen /> : contacts.length === 0 ? (
            <EmptyState icon={<Users className="size-7 text-muted-foreground" />} title="Nenhum contato encontrado" description="Adicione contatos manualmente ou importe via CSV" />
          ) : (
            <Card className="border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <Table>
                <TableHeader><TableRow className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Nome</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Telefone</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Lista</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Criado em</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {contacts.slice(0, 50).map(c => (
                    <TableRow key={c.id} className="border-zinc-100 dark:border-zinc-800/50">
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.phone}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.contactList?.name || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {contactsTotal > 50 && <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800"><p className="text-xs text-muted-foreground">Mostrando 50 de {contactsTotal} contatos</p></div>}
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ===== MENSAGENS TAB =====
function MensagensTab() {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [detailMsg, setDetailMsg] = useState<MessageItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const data = await (await fetch(`/api/messages?${params}`)).json()
      setMessages(data)
    } catch { toast.error('Erro ao carregar mensagens') }
    finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const filteredMessages = useMemo(() => {
    if (!search) return messages
    const s = search.toLowerCase()
    return messages.filter(m => m.contact.name.toLowerCase().includes(s) || m.contact.phone.includes(s))
  }, [messages, search])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: messages.length }
    messages.forEach(m => { counts[m.status] = (counts[m.status] || 0) + 1 })
    return counts
  }, [messages])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou telefone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex items-center gap-1">
          {[
            { key: 'all', label: 'Todas' }, { key: 'pending', label: 'Pendente' }, { key: 'sent', label: 'Enviada' },
            { key: 'delivered', label: 'Entregue' }, { key: 'read', label: 'Lida' }, { key: 'failed', label: 'Falhou' },
          ].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${statusFilter === f.key ? 'bg-emerald-500/10 text-emerald-600' : 'text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              {f.label} {(statusCounts[f.key] || 0) > 0 ? `(${statusCounts[f.key] || 0})` : ''}
            </button>
          ))}
        </div>
      </div>

      {loading ? <LoadingScreen /> : filteredMessages.length === 0 ? (
        <EmptyState icon={<MessageSquare className="size-7 text-muted-foreground" />} title="Nenhuma mensagem encontrada" description="As mensagens enviadas aparecerão aqui" />
      ) : (
        <Card className="border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader><TableRow className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Destinatario</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Dispositivo</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Conteudo</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Enviado em</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Acoes</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filteredMessages.slice(0, 100).map(m => (
                <TableRow key={m.id} className="border-zinc-100 dark:border-zinc-800/50">
                  <TableCell><div><p className="text-sm font-medium">{m.contact.name}</p><p className="text-xs text-muted-foreground font-mono">{m.contact.phone}</p></div></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.chip.name}</TableCell>
                  <TableCell className="max-w-[200px]"><p className="text-sm truncate">{m.content}</p></TableCell>
                  <TableCell><MessageStatusBadge status={m.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.sentAt ? new Date(m.sentAt).toLocaleString('pt-BR') : '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDetailMsg(m); setDetailOpen(true) }}><Eye className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={detailOpen} onOpenChange={(v) => { setDetailOpen(v); if (!v) setDetailMsg(null) }}>
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-w-md">
          <DialogHeader><DialogTitle>Detalhes da Mensagem</DialogTitle></DialogHeader>
          {detailMsg && (
            <div className="space-y-4 py-2">
              <div className="space-y-3">
                {[
                  ['Destinatario', `${detailMsg.contact.name} (${detailMsg.contact.phone})`],
                  ['Dispositivo', detailMsg.chip.name],
                  ['Campanha', detailMsg.campaign?.name || '-'],
                  ['Status', <MessageStatusBadge key="s" status={detailMsg.status} />],
                  ['Enviado em', detailMsg.sentAt ? new Date(detailMsg.sentAt).toLocaleString('pt-BR') : '-'],
                  ['Entregue em', detailMsg.deliveredAt ? new Date(detailMsg.deliveredAt).toLocaleString('pt-BR') : '-'],
                  ['Lida em', detailMsg.readAt ? new Date(detailMsg.readAt).toLocaleString('pt-BR') : '-'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span>{typeof value === 'string' ? <span className="text-sm">{value}</span> : value}</div>
                ))}
              </div>
              <Separator />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Conteudo</p>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 text-sm whitespace-pre-wrap">{detailMsg.content}</div>
              </div>
              {detailMsg.error && (
                <div className="bg-rose-50 dark:bg-rose-500/10 rounded-lg p-3">
                  <p className="text-xs font-semibold text-rose-600 mb-1">Erro</p>
                  <p className="text-sm text-rose-600">{detailMsg.error}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== ANTI-BAN TAB =====
function AntiBanTab() {
  const [settings, setSettings] = useState(() => {
    if (typeof window === 'undefined') return { maxPerHour: 30, maxPerDay: 200, minInterval: 30, maxInterval: 90, autoPause: true, rotateDevices: true, spamProtection: true, maxPerNumber: 3, randomVariation: true, longPauses: true, longPauseMin: 10, longPauseMax: 30, respectSchedule: true, startHour: '08:00', endHour: '20:00', pauseWeekends: true }
    try { const saved = localStorage.getItem('octupuszap-antiban'); return saved ? JSON.parse(saved) : { maxPerHour: 30, maxPerDay: 200, minInterval: 30, maxInterval: 90, autoPause: true, rotateDevices: true, spamProtection: true, maxPerNumber: 3, randomVariation: true, longPauses: true, longPauseMin: 10, longPauseMax: 30, respectSchedule: true, startHour: '08:00', endHour: '20:00', pauseWeekends: true } }
    catch { return { maxPerHour: 30, maxPerDay: 200, minInterval: 30, maxInterval: 90, autoPause: true, rotateDevices: true, spamProtection: true, maxPerNumber: 3, randomVariation: true, longPauses: true, longPauseMin: 10, longPauseMax: 30, respectSchedule: true, startHour: '08:00', endHour: '20:00', pauseWeekends: true } }
  })

  const save = () => {
    localStorage.setItem('octupuszap-antiban', JSON.stringify(settings))
    toast.success('Configuracoes salvas com sucesso')
  }

  const calcRisk = () => {
    let risk = 10
    if (settings.maxPerHour > 50) risk += 15
    if (settings.maxPerDay > 500) risk += 15
    if (!settings.autoPause) risk += 20
    if (!settings.rotateDevices) risk += 10
    if (!settings.randomVariation) risk += 15
    if (!settings.respectSchedule) risk += 15
    if (!settings.pauseWeekends) risk += 5
    return Math.min(risk, 100)
  }

  const risk = calcRisk()
  const riskColor = risk < 30 ? 'text-emerald-500' : risk < 60 ? 'text-amber-500' : 'text-rose-500'
  const riskBg = risk < 30 ? 'bg-emerald-500' : risk < 60 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="space-y-6">
      {/* Risk Meter */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertCircle className="size-4 text-amber-500" />Nivel de Risco</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="relative flex size-24 items-center justify-center">
              <svg className="size-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" className="text-zinc-100 dark:text-zinc-800" strokeWidth="8" />
                <circle cx="50" cy="50" r="40" fill="none" className={riskColor} strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${(risk / 100) * 251.2} 251.2`} />
              </svg>
              <span className={`absolute text-xl font-bold ${riskColor}`}>{risk}%</span>
            </div>
            <div className="flex-1 space-y-2">
              <p className={`text-sm font-semibold ${riskColor}`}>
                {risk < 30 ? 'Risco Baixo' : risk < 60 ? 'Risco Moderado' : 'Risco Alto'}
              </p>
              <p className="text-xs text-muted-foreground">
                {risk < 30 ? 'Suas configuracoes estao seguras para envio em massa.' : risk < 60 ? 'Considere reduzir os limites e ativar mais protecoes.' : 'Alto risco de banimento. Revise suas configuracoes imediatamente.'}
              </p>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><span className={`size-2 rounded-full ${riskBg}`} />Nivel atual</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sending Limits */}
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Limites de Envio</CardTitle><CardDescription>Controle a velocidade de envio</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label className="text-sm">Max por hora / dispositivo</Label><span className="text-sm font-semibold">{settings.maxPerHour}</span></div>
              <Slider min={10} max={100} step={5} value={[settings.maxPerHour]} onValueChange={v => setSettings(p => ({ ...p, maxPerHour: v[0] }))} className="[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:border-emerald-500" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label className="text-sm">Max por dia / dispositivo</Label><span className="text-sm font-semibold">{settings.maxPerDay}</span></div>
              <Slider min={50} max={1000} step={50} value={[settings.maxPerDay]} onValueChange={v => setSettings(p => ({ ...p, maxPerDay: v[0] }))} className="[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:border-emerald-500" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Intervalo entre mensagens (seg)</Label>
              <div className="flex items-center gap-3">
                <Input type="number" min={5} value={settings.minInterval} onChange={e => setSettings(p => ({ ...p, minInterval: parseInt(e.target.value) || 30 }))} className="w-24 h-8 text-sm" />
                <span className="text-xs text-muted-foreground">a</span>
                <Input type="number" min={5} value={settings.maxInterval} onChange={e => setSettings(p => ({ ...p, maxInterval: parseInt(e.target.value) || 90 }))} className="w-24 h-8 text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Protection */}
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Protecao Ativa</CardTitle><CardDescription>Regras automaticas de seguranca</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Pausa automatica ao detectar resposta</p><p className="text-xs text-muted-foreground">Interrompe o envio ao receber resposta</p></div>
              <Switch checked={settings.autoPause} onCheckedChange={v => setSettings(p => ({ ...p, autoPause: v }))} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Rotacao de dispositivos</p><p className="text-xs text-muted-foreground">Alterna entre dispositivos automaticamente</p></div>
              <Switch checked={settings.rotateDevices} onCheckedChange={v => setSettings(p => ({ ...p, rotateDevices: v }))} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Limitar mensagens por numero</p><p className="text-xs text-muted-foreground">Protecao contra marcacao de spam</p></div>
              <Switch checked={settings.spamProtection} onCheckedChange={v => setSettings(p => ({ ...p, spamProtection: v }))} />
            </div>
            {settings.spamProtection && (
              <div className="ml-4 pl-4 border-l-2 border-emerald-500/30">
                <Label className="text-xs text-muted-foreground">Max mensagens para mesmo numero / dia</Label>
                <Input type="number" min={1} max={10} value={settings.maxPerNumber} onChange={e => setSettings(p => ({ ...p, maxPerNumber: parseInt(e.target.value) || 3 }))} className="w-24 h-8 text-sm mt-1" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Human Behavior */}
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Comportamento Humano</CardTitle><CardDescription>Simule padroes humanos de envio</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Variacao aleatoria nos intervalos</p><p className="text-xs text-muted-foreground">Adiciona imprevisibilidade ao intervalo</p></div>
              <Switch checked={settings.randomVariation} onCheckedChange={v => setSettings(p => ({ ...p, randomVariation: v }))} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Pausas periodicas longas</p><p className="text-xs text-muted-foreground">Simula comportamento humano natural</p></div>
              <Switch checked={settings.longPauses} onCheckedChange={v => setSettings(p => ({ ...p, longPauses: v }))} />
            </div>
            {settings.longPauses && (
              <div className="ml-4 pl-4 border-l-2 border-emerald-500/30 space-y-2">
                <Label className="text-xs text-muted-foreground">Duracao da pausa longa (min)</Label>
                <div className="flex items-center gap-3">
                  <Input type="number" min={5} value={settings.longPauseMin} onChange={e => setSettings(p => ({ ...p, longPauseMin: parseInt(e.target.value) || 10 }))} className="w-20 h-8 text-sm" />
                  <span className="text-xs text-muted-foreground">a</span>
                  <Input type="number" min={5} value={settings.longPauseMax} onChange={e => setSettings(p => ({ ...p, longPauseMax: parseInt(e.target.value) || 30 }))} className="w-20 h-8 text-sm" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Horarios de Envio</CardTitle><CardDescription>Defina quando as mensagens podem ser enviadas</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Respeitar horario de envio</p><p className="text-xs text-muted-foreground">Envia apenas no horario definido</p></div>
              <Switch checked={settings.respectSchedule} onCheckedChange={v => setSettings(p => ({ ...p, respectSchedule: v }))} />
            </div>
            {settings.respectSchedule && (
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1"><Label className="text-xs text-muted-foreground">Inicio</Label><Input type="time" value={settings.startHour} onChange={e => setSettings(p => ({ ...p, startHour: e.target.value }))} className="h-9" /></div>
                <span className="text-muted-foreground pt-5">ate</span>
                <div className="flex-1 space-y-1"><Label className="text-xs text-muted-foreground">Fim</Label><Input type="time" value={settings.endHour} onChange={e => setSettings(p => ({ ...p, endHour: e.target.value }))} className="h-9" /></div>
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">Pausar nos finais de semana</p><p className="text-xs text-muted-foreground">Nao envia sabados e domingos</p></div>
              <Switch checked={settings.pauseWeekends} onCheckedChange={v => setSettings(p => ({ ...p, pauseWeekends: v }))} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Risk Detection */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Deteccao de Risco</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <ShieldCheck className="size-5 text-emerald-500 shrink-0" />
              <div><p className="text-sm font-medium">Nenhum alerta ativo</p><p className="text-xs text-muted-foreground">Seus dispositivos estao operando dentro dos limites seguros</p></div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <Activity className="size-5 text-blue-500 shrink-0" />
              <div><p className="text-sm font-medium">Monitoramento ativo</p><p className="text-xs text-muted-foreground">Todas as campanhas estao sendo monitoradas em tempo real</p></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]">
          <Check className="size-4" /> Salvar Configuracoes
        </Button>
      </div>
    </div>
  )
}

// ===== CONFIGURACOES TAB =====
function ConfiguracoesTab() {
  const [profile, setProfile] = useState(() => {
    if (typeof window === 'undefined') return { businessName: '', phone: '' }
    try { const saved = localStorage.getItem('octupuszap-config'); if (saved) return JSON.parse(saved).profile || { businessName: '', phone: '' }; return { businessName: '', phone: '' } }
    catch { return { businessName: '', phone: '' } }
  })
  const [notifications, setNotifications] = useState(() => {
    if (typeof window === 'undefined') return { campaignComplete: true, deviceDisconnected: true, dailyReport: false }
    try { const saved = localStorage.getItem('octupuszap-config'); if (saved) return JSON.parse(saved).notifications || { campaignComplete: true, deviceDisconnected: true, dailyReport: false }; return { campaignComplete: true, deviceDisconnected: true, dailyReport: false } }
    catch { return { campaignComplete: true, deviceDisconnected: true, dailyReport: false } }
  })

  const save = () => {
    localStorage.setItem('octupuszap-config', JSON.stringify({ profile, notifications }))
    toast.success('Configuracoes salvas')
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Profile */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Perfil</CardTitle><CardDescription>Informacoes da sua empresa</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label>Nome da Empresa</Label><Input placeholder="Sua empresa" value={profile.businessName} onChange={e => setProfile(p => ({ ...p, businessName: e.target.value }))} /></div>
          <div className="space-y-2"><Label>Telefone de Contato</Label><Input placeholder="11999990000" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} /></div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Notificacoes</CardTitle><CardDescription>Configure suas preferencias de notificacao</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Campanha concluida</p><p className="text-xs text-muted-foreground">Receber alerta quando uma campanha terminar</p></div>
            <Switch checked={notifications.campaignComplete} onCheckedChange={v => setNotifications(p => ({ ...p, campaignComplete: v }))} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Dispositivo desconectado</p><p className="text-xs text-muted-foreground">Alerta quando um dispositivo perder conexao</p></div>
            <Switch checked={notifications.deviceDisconnected} onCheckedChange={v => setNotifications(p => ({ ...p, deviceDisconnected: v }))} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Relatorio diario</p><p className="text-xs text-muted-foreground">Resumo diario de atividades</p></div>
            <Switch checked={notifications.dailyReport} onCheckedChange={v => setNotifications(p => ({ ...p, dailyReport: v }))} />
          </div>
        </CardContent>
      </Card>

      {/* API Config */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">API e Webhooks</CardTitle><CardDescription>Integre com servicos externos (em breve)</CardDescription></CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 mx-auto mb-3"><Database className="size-6 text-muted-foreground" /></div>
            <p className="text-sm font-medium text-muted-foreground">Configuracao de API disponivel em breve</p>
            <p className="text-xs text-muted-foreground mt-1">Webhooks, integracoes e automacoes</p>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Sobre</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Versao</span><span className="text-sm font-mono">1.0.0</span></div>
          <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Plataforma</span><span className="text-sm">OctupusZap</span></div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]">
          <Check className="size-4" /> Salvar Configuracoes
        </Button>
      </div>
    </div>
  )
}

// ===== MAIN HOME =====
export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => setStats(null))
  }, [])

  const navigate = (tab: TabId) => { setActiveTab(tab); setSidebarOpen(false) }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 flex-shrink-0
        bg-gradient-to-b from-zinc-950 to-zinc-900 border-r border-zinc-800/50
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 h-16 border-b border-zinc-800/50 shrink-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600">
              <Zap className="size-4 text-white" />
            </div>
            <span className="font-bold text-lg text-white tracking-tight">OctupusZap</span>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden ml-auto text-zinc-400 hover:text-white"><X className="size-5" /></button>
          </div>

          {/* Nav */}
          <ScrollArea className="flex-1 py-4">
            <nav className="space-y-1 px-3">
              {NAV_ITEMS.map(item => {
                const isActive = activeTab === item.id
                return (
                  <button key={item.id} onClick={() => navigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}>
                    <span className={isActive ? 'text-emerald-400' : 'text-zinc-500'}>{item.icon}</span>
                    {item.label}
                    {isActive && <div className="ml-auto size-1.5 rounded-full bg-emerald-400" />}
                  </button>
                )
              })}
            </nav>
          </ScrollArea>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-zinc-800/50 shrink-0">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <CircleDot className="size-3.5 text-emerald-500" />
              <span>Sistema Operacional</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between h-16 px-4 lg:px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Menu className="size-5" />
            </button>
            <h1 className="text-lg font-semibold">{SECTION_TITLES[activeTab]}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Bell className="size-4 text-muted-foreground" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6">
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                {activeTab === 'dashboard' && <DashboardTab stats={stats} onNavigate={navigate} />}
                {activeTab === 'dispositivos' && <DispositivosTab />}
                {activeTab === 'campanhas' && <CampanhasTab />}
                {activeTab === 'contatos' && <ContatosTab />}
                {activeTab === 'mensagens' && <MensagensTab />}
                {activeTab === 'antiban' && <AntiBanTab />}
                {activeTab === 'configuracoes' && <ConfiguracoesTab />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  )
}
