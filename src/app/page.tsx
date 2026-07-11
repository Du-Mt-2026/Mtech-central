'use client'

import dynamic from 'next/dynamic'
// v2025.05.19-horizontal-layout
import React, { useState, useEffect, useCallback, useRef, useMemo, CSSProperties } from 'react'
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
  Pencil, LayoutList, Database, WifiOff, ArrowDownToLine, Save, XCircle, ShieldBan,
  Inbox, LogOut, RotateCcw, Film, Music, File as FileIcon, ImageIcon, Key, Paperclip, MapPin, Link2,
  Baby, CheckCircle2, Video, MoreVertical, Mic, User, Smile, BookmarkPlus, GripVertical, Loader2, Eraser, Megaphone, ArrowRightLeft,
  Sun, Moon
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { type Chip, type Campaign, type ContactList, type ContactItem, type MessageItem, type MessageTemplate, type SequenceStep, type Stats } from '@/lib/types'
import { StatusBadge, ConfirmDialog, statusColor, statusLabel } from '@/components/shared'
import { convertAudioToOgg, calcChipEffectiveInfo, uploadMediaFile } from '@/components/campanhas-tab'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton, ChipCardSkeleton, CardListSkeleton, RowListSkeleton, TableSkeleton, StatsSkeleton, ChipsGridSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import QRCode from 'qrcode'
// Lazy loaded components (code splitting)
const VerificarSection = dynamic(() => import('@/components/verificar-section').then(m => ({ default: m.VerificarSection })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const KeysSection = dynamic(() => import('@/components/keys-section').then(m => ({ default: m.KeysSection })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const VendedoresSection = dynamic(() => import('@/components/vendedores-section').then(m => ({ default: m.VendedoresSection })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { restrictToHorizontalAxis, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
const AntiBanTab = dynamic(() => import('@/components/antiban-tab').then(m => ({ default: m.AntiBanTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const WarmingTab = dynamic(() => import('@/components/warming-tab').then(m => ({ default: m.WarmingTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const CampanhasTab = dynamic(() => import('@/components/campanhas-tab').then(m => ({ default: m.CampanhasTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const InboxTab = dynamic(() => import('@/components/inbox-tab').then(m => ({ default: m.InboxTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
import { type AntiBanSettings, WARMING_MODE_MULTIPLIERS } from '@/lib/constants'
import { logAction } from '@/lib/audit-log'
import { cn } from '@/lib/utils'

// ===== Client-side Audio Conversion (OGG/Opus for WhatsApp) =====





// ===== Types =====














// ScheduleEntry, BreakWindow, AntiBanSettings — imported from @/lib/constants



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
  { id: 'aquecimento', label: 'Aquecimento', icon: Flame, minRole: 'admin' },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquare, minRole: 'operador' },
  { id: 'usuarios', label: 'Usuários', icon: UserPlus, minRole: 'master' },
  { id: 'vps', label: 'VPS / Proxy', icon: Server, minRole: 'master' },
  { id: 'config', label: 'Configurações', icon: Settings, minRole: 'master' },
]

// ===== Variáveis de Mensagem =====
// Core variables always available (come from dedicated DB columns)

// Note: Custom variables from spreadsheet columns (empresa, vendedora, etc.) are loaded dynamically
// from the selected contact list via the API — see fetchContactVariables()

// ===== Chip Effective Info Utility =====
// Shared function to calculate effective daily limit considering warming phase


// ===== Status Helpers =====






// ===== Confirm Dialog =====


// ===== Dashboard Tab =====
function DashboardTab({ stats, onRefresh, setActiveTab }: { stats: Stats | null; onRefresh: () => void; setActiveTab: (tab: string) => void }) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  if (!stats) return <StatsSkeleton />

  const s = {
    totalChips: stats.totalChips ?? 0, connectedChips: stats.connectedChips ?? 0,
    totalCampaigns: stats.totalCampaigns ?? 0, activeCampaigns: stats.activeCampaigns ?? 0,
    totalMessages: stats.totalMessages ?? 0, sentMessages: stats.sentMessages, totalSent: stats.totalSent ?? 0,
    deliveredMessages: stats.deliveredMessages ?? 0, failedMessages: stats.failedMessages ?? 0,
    deliveryRate: stats.deliveryRate ?? 0, totalContacts: stats.totalContacts ?? 0,
    pendingMessages: stats.pendingMessages ?? 0, readMessages: stats.readMessages ?? 0,
  }

  const statCards = [
    { title: 'Chips', value: s.totalChips, sub: `${s.connectedChips} conectados`, icon: Smartphone, gradient: 'from-emerald-500 to-teal-600', trend: s.connectedChips > 0 ? `${s.connectedChips} online` : 'nenhum online', trendUp: s.connectedChips > 0 },
    { title: 'Campanhas', value: s.totalCampaigns, sub: `${s.activeCampaigns} ativas`, icon: Send, gradient: 'from-amber-500 to-orange-600', trend: s.activeCampaigns > 0 ? `${s.activeCampaigns} rodando` : 'nenhuma ativa', trendUp: s.activeCampaigns > 0 },
    { title: 'Mensagens', value: s.totalMessages, sub: `${s.totalSent ?? s.sentMessages} enviadas`, icon: MessageSquare, gradient: 'from-cyan-500 to-sky-600', trend: s.pendingMessages > 0 ? `${s.pendingMessages} pendentes` : 'todas processadas', trendUp: s.totalMessages > 0 },
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

      {/* ===== Charts Row ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Message Status Donut */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                <Activity className="size-4 text-cyan-600" />
              </div>
              <CardTitle className="text-lg">Status das Mensagens</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <DonutChart
              segments={[
                { value: s.deliveredMessages, color: '#10b981', label: 'Entregues' },
                { value: s.readMessages, color: '#3b82f6', label: 'Lidas' },
                { value: s.pendingMessages, color: '#f59e0b', label: 'Pendentes' },
                { value: s.failedMessages, color: '#ef4444', label: 'Falhas' },
              ].filter(seg => seg.value > 0)}
              centerValue={s.totalMessages > 0 ? String(s.totalMessages) : '0'}
              centerLabel="total"
            />
          </CardContent>
        </Card>

        {/* Chip Status Donut */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Smartphone className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-lg">Status dos Chips</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <DonutChart
              segments={[
                { value: stats.connectedChips ?? 0, color: '#10b981', label: 'Conectados' },
                { value: stats.disconnectedChips ?? 0, color: '#71717a', label: 'Desconectados' },
                { value: stats.errorChips ?? 0, color: '#ef4444', label: 'Erro' },
              ].filter(seg => seg.value > 0)}
              centerValue={String(s.totalChips)}
              centerLabel="chips"
            />
          </CardContent>
        </Card>

        {/* Chip Performance Bar Chart */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <TrendingUp className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">Envios por Chip (Hoje)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {stats.chipStatuses && stats.chipStatuses.length > 0 ? (
              <MiniBarChart
                data={stats.chipStatuses.slice(0, 6).map(chip => ({
                  label: chip.name.length > 15 ? chip.name.substring(0, 15) + '...' : chip.name,
                  value: chip.sentToday,
                  maxValue: chip.dailyLimit,
                  color: chip.sentToday >= chip.dailyLimit ? '#ef4444' : chip.sentToday > chip.dailyLimit * 0.8 ? '#f59e0b' : '#10b981',
                }))}
                max={Math.max(...stats.chipStatuses.map(c => c.dailyLimit), 200)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Smartphone className="size-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhum chip cadastrado</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                <div className="space-y-4">
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
              <div className="space-y-4">
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
            <div className="space-y-4">
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


// ===== SVG Chart Components (no external deps) =====

function DonutChart({ segments, size = 160, strokeWidth = 20, centerLabel, centerValue }: {
  segments: { value: number; color: string; label: string }[]
  size?: number
  strokeWidth?: number
  centerLabel?: string
  centerValue?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="shrink-0">
        {total === 0 ? (
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="currentColor" strokeWidth={strokeWidth}
            className="text-muted/30"
          />
        ) : (
          segments.map((seg, i) => {
            const dash = (seg.value / total) * circumference
            const circle = (
              <circle
                key={i}
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={seg.color} strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeLinecap="butt"
              />
            )
            offset += dash
            return circle
          })
        )}
        {centerValue && (
          <text x="50%" y="48%" textAnchor="middle" className="fill-foreground text-2xl font-bold" style={{ fontSize: '24px' }}>
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text x="50%" y="62%" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: '11px' }}>
            {centerLabel}
          </text>
        )}
      </svg>
      <div className="space-y-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-semibold ml-auto">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniBarChart({ data, max }: {
  data: { label: string; value: number; maxValue: number; color: string }[]
  max: number
}) {
  return (
    <div className="space-y-2.5">
      {data.map((item, i) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0
        const limitPct = max > 0 ? (item.maxValue / max) * 100 : 0
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium truncate">{item.label}</span>
              <span className="text-muted-foreground tabular-nums">{item.value}/{item.maxValue}</span>
            </div>
            <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/40 z-10"
                style={{ left: `${limitPct}%` }}
              />
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: item.color }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===== Visibility Hook =====
function useIsVisible() {
  const [isVisible, setIsVisible] = useState(true)
  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])
  return isVisible
}

// ===== Chips Tab =====
function ChipsTab() {
  const isVisible = useIsVisible()
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [antiBanSettings, setAntiBanSettings] = useState<AntiBanSettings | null>(null)
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
  const [disconnectConfirm, setDisconnectConfirm] = useState<Chip | null>(null)
  const [proxyForm, setProxyForm] = useState({ socks5Host: '', socks5Port: 1080, socks5User: '', socks5Pass: '' })

  // Search, filters, and grouping state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'disconnected' | 'error'>('all')
  const [proxyFilter, setProxyFilter] = useState<'all' | 'with-proxy' | 'no-proxy'>('all')
  const [warmingFilter, setWarmingFilter] = useState<'all' | 'nursery' | 'prewarm' | 'ready'>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Proxy test state
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<{ reachable: boolean; socks5Valid: boolean; message: string } | null>(null)
  // Per-chip proxy status: chipId → { online: boolean, checked: boolean }
  const [proxyStatuses, setProxyStatuses] = useState<Record<string, { online: boolean; checked: boolean }>>({})

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


  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setChips(prev => {
        // Alerta de chips que cairam (eram connected, agora não estão)
        if (prev.length > 0) {
          data.forEach((newChip: Chip) => {
            const oldChip = prev.find(c => c.id === newChip.id)
            if (oldChip && oldChip.status === 'connected' && newChip.status !== 'connected') {
              toast.warning(`⚠️ Chip "${newChip.name}" desconectou!`, {
                description: `Status atual: ${newChip.status}`,
                duration: 10000,
              })
            }
          })
          // Alerta de chips que voltaram
          data.forEach((newChip: Chip) => {
            const oldChip = prev.find(c => c.id === newChip.id)
            if (oldChip && oldChip.status !== 'connected' && newChip.status === 'connected') {
              toast.success(`✅ Chip "${newChip.name}" voltou a ficar online!`, {
                duration: 5000,
              })
            }
          })
        }
        return data
      })
    } catch { toast.error('Erro ao carregar chips') }
    finally { setLoading(false) }
  }, [])

  // PROBLEMA 4: Pausa individual de chip — pausa sem desconectar do WhatsApp.
  // Quando pausado, o chip não recebe novas mensagens de campanha, mas continua
  // conectado. Mensagens pendentes ficam aguardando (não são redistribuídas).
  const toggleChipPause = useCallback(async (chipId: string, currentlyPaused: boolean, chipName: string) => {
    try {
      const endpoint = currentlyPaused ? 'resume' : 'pause'
      const res = await fetch(`/api/chips/${chipId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: currentlyPaused ? '{}' : JSON.stringify({ reason: 'Pausa manual pelo usuário' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      // Atualiza o estado local dos chips
      setChips(prev => prev.map(c => c.id === chipId ? { ...c, paused: data.chip?.paused ?? !currentlyPaused, pausedAt: data.chip?.pausedAt ?? null, pauseReason: data.chip?.pauseReason ?? null } : c))
      toast.success(data.message || `Chip ${chipName} ${currentlyPaused ? 'retomado' : 'pausado'}`)
      logAction({ action: currentlyPaused ? 'RESUME_CHIP' : 'PAUSE_CHIP', category: 'chip', targetType: 'Chip', targetId: chipId, details: { name: chipName } })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao alterar pausa do chip'
      toast.error(msg)
    }
  }, [])

  // Check proxy status for all chips that have WireGuard or SOCKS5 config
  const checkAllProxies = useCallback(async (chipList: Chip[]) => {
    const chipsWithProxy = chipList.filter(c => c.wireguardIp || (c.proxyMode === 'socks5' && c.socks5Host && c.socks5Pass))
    if (chipsWithProxy.length === 0) return

    // Reset statuses to "checking" state
    setProxyStatuses(prev => {
      const next = { ...prev }
      chipsWithProxy.forEach(c => { next[c.id] = { online: false, checked: false } })
      return next
    })

    // Test each proxy in parallel (but with a concurrency limit of 3 to not overwhelm the API)
    const results: Record<string, { online: boolean; checked: boolean }> = {}
    const BATCH = 3
    for (let i = 0; i < chipsWithProxy.length; i += BATCH) {
      const batch = chipsWithProxy.slice(i, i + BATCH)
      const batchResults = await Promise.allSettled(
        batch.map(async (c) => {
          try {
            const res = await fetch('/api/proxy/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chipId: c.id }),
            })
            const data = await res.json()
            return { id: c.id, online: data.reachable && data.socks5Valid, checked: true }
          } catch {
            return { id: c.id, online: false, checked: true }
          }
        })
      )
      batchResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value) {
          results[r.value.id] = { online: r.value.online, checked: r.value.checked }
        }
      })
    }
    setProxyStatuses(prev => ({ ...prev, ...results }))
  }, [])

  const fetchAntiBanSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/antiban')
      if (res.ok) setAntiBanSettings(await res.json())
    } catch { /* silently fail */ }
  }, [])

  useEffect(() => {
    const init = async () => {
      await fetchChips()
      fetchAntiBanSettings()
    }
    init()
    // Auto-refresh chips every 10 seconds for real-time status updates
    // PERF FIX: was 5s, now 10s. /api/chips already syncs with Evolution API
    // internally, so this is the only polling needed for chip status.
    const interval = setInterval(fetchChips, isVisible ? 15000 : 60000)
    return () => clearInterval(interval)
  }, [fetchChips, fetchAntiBanSettings, isVisible])

  // ALERT: Detect chip disconnections and notify the user in real-time.
  const prevChipStatusesRef = useRef<Record<string, string>>({})
  const isFirstLoadRef = useRef(true)
  useEffect(() => {
    if (chips.length === 0) return
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false
      const initialStatuses: Record<string, string> = {}
      for (const chip of chips) { initialStatuses[chip.id] = chip.status }
      prevChipStatusesRef.current = initialStatuses
      return
    }
    const prevStatuses = prevChipStatusesRef.current
    const newStatuses: Record<string, string> = {}
    for (const chip of chips) {
      newStatuses[chip.id] = chip.status
      const prevStatus = prevStatuses[chip.id]
      if (prevStatus === 'connected' && (chip.status === 'disconnected' || chip.status === 'banned')) {
        const msg = chip.status === 'banned' ? `Chip ${chip.name} foi BANIDO!` : `Chip ${chip.name} desconectou!`
        toast.error(msg, { duration: 10000 })
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('OctupusZap', { body: msg, icon: '/favicon.ico' })
        }
      }
    }
    prevChipStatusesRef.current = newStatuses
  }, [chips])

  // Auto-check proxy statuses when chips are loaded or changed
  const chipsIdRef = useRef<string>('')
  useEffect(() => {
    if (chips.length > 0) {
      // Generate a stable fingerprint of chip IDs to detect actual changes
      const chipFingerprint = chips.map(c => c.id).sort().join(',')
      if (chipFingerprint !== chipsIdRef.current) {
        chipsIdRef.current = chipFingerprint
        checkAllProxies(chips)
      }
    }
  }, [chips, checkAllProxies])

  // === Calculate effective daily limit and phase day for a chip ===
  const getChipEffectiveInfo = useCallback((chip: Chip) => calcChipEffectiveInfo(chip, antiBanSettings), [antiBanSettings])

  // PERF FIX: Removed duplicate polling (syncStatuses).
  // Previously there were TWO intervals both calling fetchChips():
  //   1. setInterval(fetchChips, 5000) — line above
  //   2. setInterval(syncStatuses, 5000) — called /api/whatsapp/status then fetchChips()
  // This caused /api/chips to be called every ~2.5s (double polling).
  // /api/chips already syncs with Evolution API internally, so the second
  // interval was completely redundant.

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

      // If already connected (session was restored — no QR scan needed)
      if (data.status === 'open' || data.state === 'open') {
        // Only mark as connected if there's no QR code showing
        // If there's a QR code, the instance is waiting for scan — don't override
        if (!data.qrcode) {
          setQrConnected(true)
          setConnectAttempts(0)
          fetchChips()
          toast.success(`WhatsApp já estava conectado: ${chip.name}`)
          return
        }
        // QR code + state=open = race condition, show QR and let polling handle it
      }

      // Start polling for connection status
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/whatsapp/status?chipId=${chip.id}`)
          const statusData = await statusRes.json()

          // Only trust 'open' from the actual Evolution API status check,
          // not stale DB status. This prevents false "connected" after QR scan
          // when the session wasn't actually established.
          if (statusData.state === 'open') {
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

      // FIX: Only mark as connected if there's no QR code showing.
      // If there's a QR code + state=open, it's a race condition —
      // show QR and let polling verify the actual connection state.
      if (data.status === 'open' || data.state === 'open') {
        if (!data.qrcode) {
          setQrConnected(true)
          setConnectAttempts(0)
          fetchChips()
          toast.success(`WhatsApp conectado: ${selectedChip.name}`)
          return
        }
      }

      // Restart polling for connection status
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/whatsapp/status?chipId=${selectedChip.id}`)
          const statusData = await statusRes.json()

          // Only trust 'open' from the actual Evolution API status check,
          // not stale DB status. This prevents false "connected" after QR scan
          // when the session wasn't actually established.
          if (statusData.state === 'open') {
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
      if (rawMessage.includes('não configurada') || rawMessage.includes('URL ou API Key')) {
        friendlyMessage = 'Evolution API não configurada. Vá em Configurações e defina a URL e API Key.'
      } else if (rawMessage.includes('timeout') || rawMessage.includes('não respondeu')) {
        friendlyMessage = 'O servidor Evolution API está demorando para responder ou está offline. Tente novamente em alguns minutos.'
      } else if (rawMessage.includes('404')) {
        friendlyMessage = 'Instância não encontrada na Evolution API. Tente sincronizar primeiro.'
      } else if (rawMessage.includes('ECONNREFUSED') || rawMessage.includes('fetch failed')) {
        friendlyMessage = 'Não foi possível conectar ao servidor Evolution API. Verifique se o servidor está online.'
      } else {
        console.error('QR refresh error:', rawMessage)
        friendlyMessage = rawMessage
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
      logAction({ action: 'CREATE_CHIP', category: 'chip', targetType: 'Chip', details: { name: newChip.name, phone: newChip.phoneNumber } })
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
    setProxyForm({ socks5Host: chip.socks5Host, socks5Port: chip.wireguardIp ? 8084 : (chip.socks5Port || chip.socksPort || 8084), socks5User: chip.socks5User, socks5Pass: chip.socks5Pass })
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
        toast.error('Erro ao carregar configuração do proxy')
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
      const isOnline = data.reachable && data.socks5Valid
      setProxyTestResult({
        reachable: data.reachable || false,
        socks5Valid: data.socks5Valid || false,
        message: data.message || data.error || 'Resultado desconhecido',
      })
      // Also update the per-chip proxy status so the card badge stays in sync
      setProxyStatuses(prev => ({ ...prev, [selectedChip.id]: { online: isOnline, checked: true } }))
    } catch (err: unknown) {
      setProxyTestResult({ reachable: false, socks5Valid: false, message: (err as Error).message || 'Erro ao testar proxy' })
      setProxyStatuses(prev => ({ ...prev, [selectedChip.id]: { online: false, checked: true } }))
    } finally {
      setProxyTesting(false)
    }
  }

  const saveProxy = async () => {
    if (!selectedChip) return
    // Only set proxyMode='socks5' if all required fields are filled (including password)
    // Otherwise, the incomplete SOCKS5 config would block WireGuard auto-detect in resolveChipProxy
    const hasCompleteSocks5Config = proxyForm.socks5Host && proxyForm.socks5Port && proxyForm.socks5Pass
    await updateChip(selectedChip.id, {
      ...proxyForm,
      proxyMode: hasCompleteSocks5Config ? 'socks5' : 'none',
    })
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

  // Apply search + filters
  const filteredChips = chips.filter(chip => {
    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const match = chip.name.toLowerCase().includes(q) ||
        chip.phoneNumber.toLowerCase().includes(q) ||
        (chip.profileName?.toLowerCase().includes(q) ?? false) ||
        (chip.evolutionInstance?.toLowerCase().includes(q) ?? false)
      if (!match) return false
    }
    // Status filter
    if (statusFilter !== 'all' && chip.status !== statusFilter) return false
    // Proxy filter
    if (proxyFilter === 'with-proxy' && !(chip.wireguardIp || (chip.proxyMode === 'socks5' && chip.socks5Host))) return false
    if (proxyFilter === 'no-proxy' && (chip.wireguardIp || (chip.proxyMode === 'socks5' && chip.socks5Host))) return false
    // Warming filter
    if (warmingFilter !== 'all' && (chip.warmingPhase || 'nursery') !== warmingFilter) return false
    return true
  })

  const connectedChips = filteredChips.filter(c => c.status === 'connected')
  const disconnectedChips = filteredChips.filter(c => c.status !== 'connected')

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

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
              <div className="space-y-2">
                <Label>Servidor Evolution API</Label>
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <span>Evolution API (Go/whatsmeow)</span>
                </div>
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

      {/* Stats Row - Compact */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
        {[
          { label: 'Total', value: chips.length, icon: Smartphone, color: 'text-violet-600' },
          { label: 'Conectados', value: connected, icon: Check, color: 'text-emerald-600' },
          { label: 'Desconectados', value: disconnected, icon: X, color: 'text-zinc-500' },
          { label: 'Erro', value: errorCount, icon: AlertCircle, color: 'text-rose-600' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md">
            <s.icon className={`size-3.5 ${s.color}`} />
            <span className="text-sm font-bold">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, número, perfil ou instância..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-10"
          />
          {searchQuery && (
            <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2" onClick={() => setSearchQuery('')}>
              <X className="size-3" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Status filters */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {[
              { key: 'all', label: 'Todos', count: chips.length },
              { key: 'connected', label: 'Conectados', count: connected },
              { key: 'disconnected', label: 'Desconectados', count: disconnected },
              { key: 'error', label: 'Erro', count: errorCount },
            ].map(f => (
              <Button key={f.key} variant={statusFilter === f.key ? 'default' : 'ghost'} size="sm" className="h-7 text-xs px-2.5 gap-1" onClick={() => setStatusFilter(f.key as typeof statusFilter)}>
                {f.label} <span className="text-xs opacity-60">{f.count}</span>
              </Button>
            ))}
          </div>
          {/* Proxy filters */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {[
              { key: 'all', label: 'Proxy' },
              { key: 'with-proxy', label: 'Com Proxy' },
              { key: 'no-proxy', label: 'Sem Proxy' },
            ].map(f => (
              <Button key={f.key} variant={proxyFilter === f.key ? 'default' : 'ghost'} size="sm" className="h-7 text-xs px-2.5" onClick={() => setProxyFilter(f.key as typeof proxyFilter)}>
                {f.label}
              </Button>
            ))}
          </div>
          {/* Warming filters */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {[
              { key: 'all', label: 'Aquecimento' },
              { key: 'nursery', label: 'Berçário' },
              { key: 'prewarm', label: 'Pré-aquecido' },
              { key: 'ready', label: 'Aquecido' },
            ].map(f => (
              <Button key={f.key} variant={warmingFilter === f.key ? 'default' : 'ghost'} size="sm" className="h-7 text-xs px-2.5" onClick={() => setWarmingFilter(f.key as typeof warmingFilter)}>
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Chip Cards - Grouped by Connection Status */}
      {loading ? (
        <ChipsGridSkeleton />
      ) : filteredChips.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum chip encontrado"
          description={searchQuery ? 'Tente outro termo de busca ou ajuste os filtros aplicados.' : 'Adicione um chip para começar a enviar mensagens via WhatsApp.'}
          action={searchQuery ? undefined : { label: 'Adicionar Chip', onClick: () => setAddDialogOpen(true) }}
        />
      ) : (
        <div className="space-y-6">
          {/* Connected Group */}
          {connectedChips.length > 0 && (
            <div>
              <button onClick={() => toggleGroup('connected')} className="flex items-center gap-2 mb-3 group cursor-pointer">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-emerald-500" />
                  <h3 className="text-sm font-semibold">Conectados</h3>
                  <Badge variant="secondary" className="text-xs h-5">{connectedChips.length}</Badge>
                </div>
                <ChevronDown className={`size-4 text-muted-foreground transition-transform ${collapsedGroups.has('connected') ? '-rotate-90' : ''}`} />
              </button>
              {!collapsedGroups.has('connected') && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <AnimatePresence>
                    {connectedChips.map((chip, i) => (
                      <motion.div key={chip.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                        <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0 relative overflow-hidden">
                          <div className={`absolute top-0 left-0 right-0 h-1 ${chip.status === 'connected' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : chip.status === 'error' ? 'bg-gradient-to-r from-rose-400 to-pink-500' : chip.status === 'connecting' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-zinc-300'}`} />
                          <CardHeader className="pb-3 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${chip.status === 'connected' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-violet-100 dark:bg-violet-900/30'}`}>
                                <Smartphone className={`size-5 ${chip.status === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : 'text-violet-600 dark:text-violet-400'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <CardTitle className="flex-1 min-w-0 truncate text-sm" title={chip.name}>{chip.name}</CardTitle>
                                  <Badge variant="outline" className="gap-0.5 text-[10px] px-1 py-0 shrink-0 leading-none">
                                    v3
                                  </Badge>
                                  {chip.disconnectionReasonCode && (
                                    <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="destructive" className="gap-0.5 text-[9px] px-1 py-0 shrink-0 leading-none">
                                          <WifiOff className="size-2.5" />
                                          {chip.disconnectionReasonCode === 401 ? 'Removido' :
                                           chip.disconnectionReasonCode === 403 ? 'Banido' :
                                           chip.disconnectionReasonCode === 428 ? 'Substituído' :
                                           chip.disconnectionReasonCode === 440 ? 'Desconectado' :
                                           `${chip.disconnectionReasonCode}`}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom" className="text-xs">
                                        {chip.disconnectionReasonCode === 401 ? 'Dispositivo removido' :
                                         chip.disconnectionReasonCode === 403 ? 'Banido pelo WhatsApp' :
                                         chip.disconnectionReasonCode === 428 ? 'Dispositivo substituído' :
                                         chip.disconnectionReasonCode === 440 ? 'Dispositivo desconectado' :
                                         `Código ${chip.disconnectionReasonCode}`}
                                      </TooltipContent>
                                    </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                {chip.profileName && chip.profileName !== chip.name && (
                                  <p className="text-xs text-muted-foreground/70 truncate" title={`Perfil WhatsApp: ${chip.profileName}`}>{chip.profileName}</p>
                                )}
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <CardDescription className="flex-1 min-w-0 truncate text-xs" title={chip.phoneNumber}>{chip.phoneNumber}</CardDescription>
                                  {chip.evolutionInstance && (
                                    <span className="text-[11px] font-mono text-muted-foreground/80 truncate max-w-24" title={chip.evolutionInstance}>{chip.evolutionInstance.replace(/^OctupusZap_/, '')}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <StatusBadge status={chip.status} />
                                {chip.wireguardIp || (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Pass) ? (
                                  (() => {
                                    const ps = proxyStatuses[chip.id]
                                    const isOnline = ps?.checked && ps?.online
                                    const isChecking = ps && !ps.checked
                                    const isOffline = ps?.checked && !ps.online
                                    return (
                                      <Badge variant="outline" className={`gap-0.5 text-[9px] px-1.5 py-0 leading-none ${
                                        isOnline ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' :
                                        isChecking ? 'bg-zinc-200 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700' :
                                        isOffline ? 'bg-rose-100 text-rose-600 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800' :
                                        'bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                                      }`}>
                                        {isOnline ? <><Lock className="size-2.5" /> Proxy Online</> :
                                         isChecking ? <><RefreshCw className="size-2.5 animate-spin" /> Verificando</> :
                                         isOffline ? <><WifiOff className="size-2.5" /> Proxy Offline</> :
                                         <><Lock className="size-2.5" /> Proxy</>}
                                      </Badge>
                                    )
                                  })()
                                ) : null}
                              </div>
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
                              {(() => {
                                const info = getChipEffectiveInfo(chip)
                                const phase = chip.warmingPhase || 'nursery'
                                const isInCooldown = chip.cooldownUntil && new Date(chip.cooldownUntil) > new Date()
                                const cooldownMin = isInCooldown ? Math.ceil((new Date(chip.cooldownUntil!).getTime() - Date.now()) / 60000) : 0
                                const hitDailyLimit = chip.sentToday >= info.effectiveLimit
                                const hitHourlyLimit = (chip.hourlySent ?? 0) >= (antiBanSettings?.hourlyLimit ?? 30)

                                // Determine chip operational status
                                let chipStatus: 'available' | 'cooldown' | 'daily_limit' | 'hourly_limit' | 'disconnected' = 'available'
                                if (chip.status !== 'connected') chipStatus = 'disconnected'
                                else if (isInCooldown) chipStatus = 'cooldown'
                                else if (hitDailyLimit) chipStatus = 'daily_limit'
                                else if (hitHourlyLimit) chipStatus = 'hourly_limit'

                                const progressPct = info.effectiveLimit > 0 ? (chip.sentToday / info.effectiveLimit) * 100 : 0
                                const progressColor = progressPct >= 90 ? 'bg-red-500' : progressPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'

                                return (
                                  <>
                                    {/* Status badge — always visible, tells you WHY messages aren't going out */}
                                    {chipStatus !== 'available' && (
                                      <div className={`flex items-center gap-2 p-2 rounded-md border ${
                                        chipStatus === 'cooldown' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                                        chipStatus === 'daily_limit' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                                        chipStatus === 'hourly_limit' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' :
                                        'bg-zinc-50 dark:bg-zinc-900/20 border-zinc-200 dark:border-zinc-800'
                                      }`}>
                                        {chipStatus === 'cooldown' && <Clock className="size-4 text-amber-600 shrink-0" />}
                                        {chipStatus === 'daily_limit' && <ShieldBan className="size-4 text-red-600 shrink-0" />}
                                        {chipStatus === 'hourly_limit' && <Clock className="size-4 text-orange-600 shrink-0" />}
                                        {chipStatus === 'disconnected' && <WifiOff className="size-4 text-zinc-600 shrink-0" />}
                                        <div className="flex-1 min-w-0">
                                          {chipStatus === 'cooldown' && (
                                            <>
                                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Em cooldown</p>
                                              <p className="text-[10px] text-amber-600 dark:text-amber-500">Retoma em {cooldownMin}min</p>
                                            </>
                                          )}
                                          {chipStatus === 'daily_limit' && (
                                            <>
                                              <p className="text-xs font-semibold text-red-700 dark:text-red-400">Limite diário atingido</p>
                                              <p className="text-[10px] text-red-600 dark:text-red-500">{chip.sentToday}/{info.effectiveLimit} — aguarde até amanhã</p>
                                            </>
                                          )}
                                          {chipStatus === 'hourly_limit' && (
                                            <>
                                              <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Limite horário atingido</p>
                                              <p className="text-[10px] text-orange-600 dark:text-orange-500">{chip.hourlySent ?? 0}/{antiBanSettings?.hourlyLimit ?? 30} por hora</p>
                                            </>
                                          )}
                                          {chipStatus === 'disconnected' && (
                                            <>
                                              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-400">Chip desconectado</p>
                                              <p className="text-xs text-zinc-600 dark:text-zinc-500">Conecte para enviar mensagens</p>
                                            </>
                                          )}
                                        </div>
                                        {chipStatus === 'cooldown' && (
                                          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs shrink-0">{cooldownMin}min</Badge>
                                        )}
                                      </div>
                                    )}

                                    {/* Envio hoje — shows effective limit, not raw dailyLimit */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-muted-foreground">Envio hoje</span>
                                      <div className="flex items-center gap-1.5">
                                        <span className={`font-semibold ${hitDailyLimit ? 'text-red-600 dark:text-red-400' : ''}`}>
                                          {chip.sentToday}/{info.effectiveLimit}
                                        </span>
                                        {info.effectiveLimit < (chip.dailyLimit || 200) && (
                                          <span className="text-xs text-muted-foreground" title={`Limite total do chip: ${chip.dailyLimit || 200}/dia`}>
                                            (de {chip.dailyLimit || 200})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {/* Progress bar based on effective limit */}
                                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                                      <div className={`h-full rounded-full transition-all duration-300 ${progressColor}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
                                    </div>

                                    {/* Aquecimento — shows phase + editable day */}
                                    {chip.warmingEnabled && (
                                      <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                          <span className="text-muted-foreground">Aquecimento</span>
                                          <div className="flex items-center gap-1">
                                            <Badge variant="secondary" className="gap-1 text-xs">
                                              {phase === 'ready' ? (
                                                <><CheckCircle2 className="size-3" /> Aquecido</>
                                              ) : phase === 'prewarm' ? (
                                                <><Flame className="size-3" /> Pré-aquecido</>
                                              ) : (
                                                <><Baby className="size-3" /> Berçário</>
                                              )}
                                            </Badge>
                                            <Select value={phase} onValueChange={async (v) => {
                                              try {
                                                await fetch(`/api/chips/${chip.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warmingPhase: v }) })
                                                toast.success('Fase atualizada!')
                                                fetchChips()
                                              } catch { toast.error('Erro ao atualizar fase') }
                                            }}>
                                              <SelectTrigger className="h-7 rounded-md border border-input bg-background px-2 text-xs gap-1 hover:bg-accent"><Pencil className="size-3" /><span className="sr-only">Alterar fase</span></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="nursery">Berçário</SelectItem>
                                                <SelectItem value="prewarm">Pré-aquecido</SelectItem>
                                                <SelectItem value="ready">Aquecido</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                        {/* Day info + edit button */}
                                        {phase !== 'ready' && (
                                          <div className="flex items-center justify-between pl-2">
                                            <div className="flex items-center gap-1.5">
                                              {!chip.warmingStartedAt && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400 gap-1">
                                                  <Clock className="size-2.5" /> Nunca enviou
                                                </Badge>
                                              )}
                                              {chip.warmingStartedAt && info.phaseMaxDays > 0 && (
                                                <span className="text-[11px] text-muted-foreground">
                                                  Dia {info.phaseDay} de {info.phaseMaxDays} — <span className="text-sm font-medium text-foreground">{info.effectiveLimit} msg/dia</span>
                                                </span>
                                              )}
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                                              onClick={() => {
                                                const maxDay = info.phaseMaxDays || 20
                                                const input = prompt(`Definir dia do aquecimento (1-${maxDay}):`, String(info.phaseDay))
                                                if (input === null) return
                                                const day = parseInt(input)
                                                if (isNaN(day) || day < 1 || day > maxDay) {
                                                  toast.error(`Dia inválido. Use 1 a ${maxDay}`)
                                                  return
                                                }
                                                // Calculate the warmingStartedAt date that would result in this day
                                                // warmingStartedAt = now - (day - 1) days
                                                const newStartDate = new Date()
                                                newStartDate.setDate(newStartDate.getDate() - (day - 1))
                                                newStartDate.setHours(0, 0, 0, 0)
                                                fetch(`/api/chips/${chip.id}`, {
                                                  method: 'PATCH',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ warmingStartedAt: newStartDate.toISOString() })
                                                }).then(() => {
                                                  toast.success(`Dia ajustado para ${day} — limite: ${(() => {
                                                    const schedule = phase === 'nursery'
                                                      ? JSON.parse(antiBanSettings?.nurserySchedule || '[]')
                                                      : JSON.parse(antiBanSettings?.prewarmSchedule || '[]')
                                                    const entry = schedule.find((s: any) => day >= s.days[0] && day <= s.days[1])
                                                    return entry?.limit || 10
                                                  })()} msg/dia`)
                                                  fetchChips()
                                                }).catch(() => toast.error('Erro ao ajustar dia'))
                                              }}
                                            >
                                              <Pencil className="size-2.5" /> Ajustar dia
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )
                              })()}
                              <div className="flex justify-between items-center">
                                <span className="text-muted-foreground">Último visto</span>
                                <span className="text-xs">{chip.lastSeen ? new Date(chip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</span>
                              </div>
                            </div>
                            <Separator />
                            <div className="flex gap-1.5">
                              {chip.status === 'connected' ? (
                                <Button variant="outline" size="sm" className="gap-1 text-[11px] h-7 px-2 text-rose-500 hover:text-rose-600 border-rose-200 hover:border-rose-300" onClick={() => setDisconnectConfirm(chip)}>
                                  <X className="size-3" /> Desconectar
                                </Button>
                              ) : (
                                <Button size="sm" className="gap-1 text-[11px] h-7 px-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-md" onClick={() => connectWhatsApp(chip)}>
                                  <QrCode className="size-3" /> WhatsApp
                                </Button>
                              )}
                              <Button variant="outline" size="sm" className="gap-1 text-[11px] h-7 px-2" onClick={() => openProxyDialog(chip)}>
                                <Globe className="size-3" /> Proxy
                              </Button>
                              <div className="flex-1" />
                              <TooltipProvider><Tooltip><TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="size-7 p-0 text-rose-500 hover:text-rose-600" onClick={() => setDeleteConfirm(chip.id)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </TooltipTrigger><TooltipContent>Excluir chip</TooltipContent></Tooltip></TooltipProvider>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {/* Disconnected Group */}
          {disconnectedChips.length > 0 && (
            <div>
              <button onClick={() => toggleGroup('disconnected')} className="flex items-center gap-2 mb-3 group cursor-pointer">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-zinc-400" />
                  <h3 className="text-sm font-semibold">Desconectados</h3>
                  <Badge variant="secondary" className="text-xs h-5">{disconnectedChips.length}</Badge>
                </div>
                <ChevronDown className={`size-4 text-muted-foreground transition-transform ${collapsedGroups.has('disconnected') ? '-rotate-90' : ''}`} />
              </button>
              {!collapsedGroups.has('disconnected') && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <AnimatePresence>
                    {disconnectedChips.map((chip, i) => (
                      <motion.div key={chip.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                        <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0 relative overflow-hidden">
                          <div className={`absolute top-0 left-0 right-0 h-1 ${chip.status === 'connected' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : chip.status === 'error' ? 'bg-gradient-to-r from-rose-400 to-pink-500' : chip.status === 'connecting' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-zinc-300'}`} />
                          <CardHeader className="pb-3 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${chip.status === 'connected' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-violet-100 dark:bg-violet-900/30'}`}>
                                <Smartphone className={`size-5 ${chip.status === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : 'text-violet-600 dark:text-violet-400'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <CardTitle className="flex-1 min-w-0 truncate text-sm" title={chip.name}>{chip.name}</CardTitle>
                                  <Badge variant="outline" className="gap-0.5 text-[10px] px-1 py-0 shrink-0 leading-none">
                                    v3
                                  </Badge>
                                  {chip.disconnectionReasonCode && (
                                    <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="destructive" className="gap-0.5 text-[9px] px-1 py-0 shrink-0 leading-none">
                                          <WifiOff className="size-2.5" />
                                          {chip.disconnectionReasonCode === 401 ? 'Removido' :
                                           chip.disconnectionReasonCode === 403 ? 'Banido' :
                                           chip.disconnectionReasonCode === 428 ? 'Substituído' :
                                           chip.disconnectionReasonCode === 440 ? 'Desconectado' :
                                           `${chip.disconnectionReasonCode}`}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom" className="text-xs">
                                        {chip.disconnectionReasonCode === 401 ? 'Dispositivo removido' :
                                         chip.disconnectionReasonCode === 403 ? 'Banido pelo WhatsApp' :
                                         chip.disconnectionReasonCode === 428 ? 'Dispositivo substituído' :
                                         chip.disconnectionReasonCode === 440 ? 'Dispositivo desconectado' :
                                         `Código ${chip.disconnectionReasonCode}`}
                                      </TooltipContent>
                                    </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                {chip.profileName && chip.profileName !== chip.name && (
                                  <p className="text-xs text-muted-foreground/70 truncate" title={`Perfil WhatsApp: ${chip.profileName}`}>{chip.profileName}</p>
                                )}
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <CardDescription className="flex-1 min-w-0 truncate text-xs" title={chip.phoneNumber}>{chip.phoneNumber}</CardDescription>
                                  {chip.evolutionInstance && (
                                    <span className="text-[11px] font-mono text-muted-foreground/80 truncate max-w-24" title={chip.evolutionInstance}>{chip.evolutionInstance.replace(/^OctupusZap_/, '')}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <StatusBadge status={chip.status} />
                                {chip.wireguardIp || (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Pass) ? (
                                  (() => {
                                    const ps = proxyStatuses[chip.id]
                                    const isOnline = ps?.checked && ps?.online
                                    const isChecking = ps && !ps.checked
                                    const isOffline = ps?.checked && !ps.online
                                    return (
                                      <Badge variant="outline" className={`gap-0.5 text-[9px] px-1.5 py-0 leading-none ${
                                        isOnline ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' :
                                        isChecking ? 'bg-zinc-200 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700' :
                                        isOffline ? 'bg-rose-100 text-rose-600 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800' :
                                        'bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                                      }`}>
                                        {isOnline ? <><Lock className="size-2.5" /> Proxy Online</> :
                                         isChecking ? <><RefreshCw className="size-2.5 animate-spin" /> Verificando</> :
                                         isOffline ? <><WifiOff className="size-2.5" /> Proxy Offline</> :
                                         <><Lock className="size-2.5" /> Proxy</>}
                                      </Badge>
                                    )
                                  })()
                                ) : null}
                              </div>
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
                              {(() => {
                                const info = getChipEffectiveInfo(chip)
                                const phase = chip.warmingPhase || 'nursery'
                                const isInCooldown = chip.cooldownUntil && new Date(chip.cooldownUntil) > new Date()
                                const cooldownMin = isInCooldown ? Math.ceil((new Date(chip.cooldownUntil!).getTime() - Date.now()) / 60000) : 0
                                const hitDailyLimit = chip.sentToday >= info.effectiveLimit
                                const hitHourlyLimit = (chip.hourlySent ?? 0) >= (antiBanSettings?.hourlyLimit ?? 30)

                                // Determine chip operational status
                                let chipStatus: 'available' | 'cooldown' | 'daily_limit' | 'hourly_limit' | 'disconnected' = 'available'
                                if (chip.status !== 'connected') chipStatus = 'disconnected'
                                else if (isInCooldown) chipStatus = 'cooldown'
                                else if (hitDailyLimit) chipStatus = 'daily_limit'
                                else if (hitHourlyLimit) chipStatus = 'hourly_limit'

                                const progressPct = info.effectiveLimit > 0 ? (chip.sentToday / info.effectiveLimit) * 100 : 0
                                const progressColor = progressPct >= 90 ? 'bg-red-500' : progressPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'

                                return (
                                  <>
                                    {/* Status badge — always visible, tells you WHY messages aren't going out */}
                                    {chipStatus !== 'available' && (
                                      <div className={`flex items-center gap-2 p-2 rounded-md border ${
                                        chipStatus === 'cooldown' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                                        chipStatus === 'daily_limit' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                                        chipStatus === 'hourly_limit' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' :
                                        'bg-zinc-50 dark:bg-zinc-900/20 border-zinc-200 dark:border-zinc-800'
                                      }`}>
                                        {chipStatus === 'cooldown' && <Clock className="size-4 text-amber-600 shrink-0" />}
                                        {chipStatus === 'daily_limit' && <ShieldBan className="size-4 text-red-600 shrink-0" />}
                                        {chipStatus === 'hourly_limit' && <Clock className="size-4 text-orange-600 shrink-0" />}
                                        {chipStatus === 'disconnected' && <WifiOff className="size-4 text-zinc-600 shrink-0" />}
                                        <div className="flex-1 min-w-0">
                                          {chipStatus === 'cooldown' && (
                                            <>
                                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Em cooldown</p>
                                              <p className="text-[10px] text-amber-600 dark:text-amber-500">Retoma em {cooldownMin}min</p>
                                            </>
                                          )}
                                          {chipStatus === 'daily_limit' && (
                                            <>
                                              <p className="text-xs font-semibold text-red-700 dark:text-red-400">Limite diário atingido</p>
                                              <p className="text-[10px] text-red-600 dark:text-red-500">{chip.sentToday}/{info.effectiveLimit} — aguarde até amanhã</p>
                                            </>
                                          )}
                                          {chipStatus === 'hourly_limit' && (
                                            <>
                                              <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Limite horário atingido</p>
                                              <p className="text-[10px] text-orange-600 dark:text-orange-500">{chip.hourlySent ?? 0}/{antiBanSettings?.hourlyLimit ?? 30} por hora</p>
                                            </>
                                          )}
                                          {chipStatus === 'disconnected' && (
                                            <>
                                              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-400">Chip desconectado</p>
                                              <p className="text-xs text-zinc-600 dark:text-zinc-500">Conecte para enviar mensagens</p>
                                            </>
                                          )}
                                        </div>
                                        {chipStatus === 'cooldown' && (
                                          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs shrink-0">{cooldownMin}min</Badge>
                                        )}
                                      </div>
                                    )}

                                    {/* Envio hoje — shows effective limit, not raw dailyLimit */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-muted-foreground">Envio hoje</span>
                                      <div className="flex items-center gap-1.5">
                                        <span className={`font-semibold ${hitDailyLimit ? 'text-red-600 dark:text-red-400' : ''}`}>
                                          {chip.sentToday}/{info.effectiveLimit}
                                        </span>
                                        {info.effectiveLimit < (chip.dailyLimit || 200) && (
                                          <span className="text-xs text-muted-foreground" title={`Limite total do chip: ${chip.dailyLimit || 200}/dia`}>
                                            (de {chip.dailyLimit || 200})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {/* Progress bar based on effective limit */}
                                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                                      <div className={`h-full rounded-full transition-all duration-300 ${progressColor}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
                                    </div>

                                    {/* Aquecimento — shows phase + editable day */}
                                    {chip.warmingEnabled && (
                                      <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                          <span className="text-muted-foreground">Aquecimento</span>
                                          <div className="flex items-center gap-1">
                                            <Badge variant="secondary" className="gap-1 text-xs">
                                              {phase === 'ready' ? (
                                                <><CheckCircle2 className="size-3" /> Aquecido</>
                                              ) : phase === 'prewarm' ? (
                                                <><Flame className="size-3" /> Pré-aquecido</>
                                              ) : (
                                                <><Baby className="size-3" /> Berçário</>
                                              )}
                                            </Badge>
                                            <Select value={phase} onValueChange={async (v) => {
                                              try {
                                                await fetch(`/api/chips/${chip.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warmingPhase: v }) })
                                                toast.success('Fase atualizada!')
                                                fetchChips()
                                              } catch { toast.error('Erro ao atualizar fase') }
                                            }}>
                                              <SelectTrigger className="h-7 rounded-md border border-input bg-background px-2 text-xs gap-1 hover:bg-accent"><Pencil className="size-3" /><span className="sr-only">Alterar fase</span></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="nursery">Berçário</SelectItem>
                                                <SelectItem value="prewarm">Pré-aquecido</SelectItem>
                                                <SelectItem value="ready">Aquecido</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                        {/* Day info + edit button */}
                                        {phase !== 'ready' && (
                                          <div className="flex items-center justify-between pl-2">
                                            <div className="flex items-center gap-1.5">
                                              {!chip.warmingStartedAt && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400 gap-1">
                                                  <Clock className="size-2.5" /> Nunca enviou
                                                </Badge>
                                              )}
                                              {chip.warmingStartedAt && info.phaseMaxDays > 0 && (
                                                <span className="text-[11px] text-muted-foreground">
                                                  Dia {info.phaseDay} de {info.phaseMaxDays} — <span className="text-sm font-medium text-foreground">{info.effectiveLimit} msg/dia</span>
                                                </span>
                                              )}
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                                              onClick={() => {
                                                const maxDay = info.phaseMaxDays || 20
                                                const input = prompt(`Definir dia do aquecimento (1-${maxDay}):`, String(info.phaseDay))
                                                if (input === null) return
                                                const day = parseInt(input)
                                                if (isNaN(day) || day < 1 || day > maxDay) {
                                                  toast.error(`Dia inválido. Use 1 a ${maxDay}`)
                                                  return
                                                }
                                                // Calculate the warmingStartedAt date that would result in this day
                                                // warmingStartedAt = now - (day - 1) days
                                                const newStartDate = new Date()
                                                newStartDate.setDate(newStartDate.getDate() - (day - 1))
                                                newStartDate.setHours(0, 0, 0, 0)
                                                fetch(`/api/chips/${chip.id}`, {
                                                  method: 'PATCH',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ warmingStartedAt: newStartDate.toISOString() })
                                                }).then(() => {
                                                  toast.success(`Dia ajustado para ${day} — limite: ${(() => {
                                                    const schedule = phase === 'nursery'
                                                      ? JSON.parse(antiBanSettings?.nurserySchedule || '[]')
                                                      : JSON.parse(antiBanSettings?.prewarmSchedule || '[]')
                                                    const entry = schedule.find((s: any) => day >= s.days[0] && day <= s.days[1])
                                                    return entry?.limit || 10
                                                  })()} msg/dia`)
                                                  fetchChips()
                                                }).catch(() => toast.error('Erro ao ajustar dia'))
                                              }}
                                            >
                                              <Pencil className="size-2.5" /> Ajustar dia
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )
                              })()}
                              <div className="flex justify-between items-center">
                                <span className="text-muted-foreground">Último visto</span>
                                <span className="text-xs">{chip.lastSeen ? new Date(chip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</span>
                              </div>
                            </div>
                            <Separator />
                            <div className="flex gap-1.5">
                              {chip.status === 'connected' ? (
                                <Button variant="outline" size="sm" className="gap-1 text-[11px] h-7 px-2 text-rose-500 hover:text-rose-600 border-rose-200 hover:border-rose-300" onClick={() => setDisconnectConfirm(chip)}>
                                  <X className="size-3" /> Desconectar
                                </Button>
                              ) : (
                                <Button size="sm" className="gap-1 text-[11px] h-7 px-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-md" onClick={() => connectWhatsApp(chip)}>
                                  <QrCode className="size-3" /> WhatsApp
                                </Button>
                              )}
                              <Button variant="outline" size="sm" className="gap-1 text-[11px] h-7 px-2" onClick={() => openProxyDialog(chip)}>
                                <Globe className="size-3" /> Proxy
                              </Button>
                              <div className="flex-1" />
                              <TooltipProvider><Tooltip><TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="size-7 p-0 text-rose-500 hover:text-rose-600" onClick={() => setDeleteConfirm(chip.id)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </TooltipTrigger><TooltipContent>Excluir chip</TooltipContent></Tooltip></TooltipProvider>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Import Instances Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
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
                        <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                          <Smartphone className="size-4 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{inst.profileName || inst.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground/70 truncate">{inst.name}</span>
                            <Badge variant={inst.connectionStatus === 'open' ? 'default' : 'secondary'} className={`text-[10px] px-1.5 py-0 ${inst.connectionStatus === 'open' ? 'bg-emerald-600' : ''}`}>
                              {inst.connectionStatus === 'open' ? 'Conectada' : inst.connectionStatus === 'connecting' ? 'Conectando' : 'Desconectada'}
                            </Badge>
                            {inst.disconnectionReasonCode && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <WifiOff className="size-2.5" />
                                {inst.disconnectionReasonCode === 401 ? 'Removido' :
                                 inst.disconnectionReasonCode === 403 ? 'Banido' :
                                 inst.disconnectionReasonCode === 428 ? 'Substituído' :
                                 inst.disconnectionReasonCode === 440 ? 'Desconectado' :
                                 `Código ${inst.disconnectionReasonCode}`}
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
          <DialogFooter className="shrink-0">
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

      <ConfirmDialog open={!!disconnectConfirm} onOpenChange={() => setDisconnectConfirm(null)}
        title="Desconectar WhatsApp" description="Tem certeza que deseja desconectar o WhatsApp deste chip? As mensagens não poderão ser enviadas até reconectar."
        onConfirm={() => { if (disconnectConfirm) disconnectWhatsApp(disconnectConfirm); setDisconnectConfirm(null) }} confirmLabel="Desconectar" variant="destructive" />

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
                        <li>Confira a <strong>porta</strong> (padrão: 8084)</li>
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
                          {selectedChip?.wireguardIp ? 8084 : (selectedChip?.socksPort || 8084)}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-600 dark:text-blue-400">Proxy completo:</span>
                        <code className="bg-white dark:bg-zinc-800 px-2 py-0.5 rounded font-mono text-blue-800 dark:text-blue-200 border">
                          {selectedChip?.wireguardIp || selectedChipConfig?.chip.wireguardIp || '0.0.0.0'}:{selectedChip?.wireguardIp ? 8084 : (selectedChip?.socksPort || 8084)}
                        </code>
                        {selectedChip?.wireguardIp && (
                          <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => copyToClipboard(`${selectedChip.wireguardIp}:${selectedChip.wireguardIp ? 8084 : (selectedChip.socksPort || 8084)}`)}>
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
                      {selectedChip?.wireguardIp ? `${selectedChip.wireguardIp}:${selectedChip.wireguardIp ? 8084 : (selectedChip.socksPort || 8084)}` : 'Nenhum proxy configurado'}
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
                  <Input type="number" placeholder="8084" value={proxyForm.socks5Port} onChange={e => setProxyForm(p => ({ ...p, socks5Port: parseInt(e.target.value) || 0 }))} />
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

// ===== Sortable Contact Row =====
function SortableContactRow({ contact, isSelected, onToggleSelect, onEdit, onDelete, customData }: {
  contact: ContactItem
  isSelected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onDelete: () => void
  customData: Record<string, string>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: contact.id })
  const style = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <tr ref={setNodeRef} style={style} className={`border-t hover:bg-muted/30 transition-colors ${isDragging ? 'bg-muted shadow-lg' : ''}`}>
      <td className="p-3 w-[40px]">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="size-4 rounded border-gray-300"
        />
      </td>
      <td className="p-3 w-[36px]" {...attributes} {...listeners}>
        <GripVertical className="size-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
      </td>
      {STANDARD_CONTACT_FIELDS.map(f => {
        const value = f.core
          ? (f.key === 'nome' ? contact.name : contact.phone)
          : (customData[f.key] || '-')
        return (
          <td key={f.key} className={`p-3 truncate ${f.core ? 'font-medium' : 'text-muted-foreground text-xs'}`}>
            {value}
          </td>
        )
      })}
      <td className="p-3 text-muted-foreground text-xs truncate">
        {contact.createdAt ? new Date(contact.createdAt).toLocaleString('pt-BR') : '—'}
      </td>
      <td className="p-3">
        <div className="flex gap-1">
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger><TooltipContent>Editar contato</TooltipContent></Tooltip></TooltipProvider>
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger><TooltipContent>Excluir contato</TooltipContent></Tooltip></TooltipProvider>
        </div>
      </td>
    </tr>
  )
}

// ===== Contatos Tab =====
function ContatosTab() {
  const isVisible = useIsVisible()
  const [contactLists, setContactLists] = useState<ContactList[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [contactsPage, setContactsPage] = useState(1)
  const CONTACTS_PER_PAGE = 50
  const [loading, setLoading] = useState(true)
  const [selectedList, setSelectedList] = useState<ContactList | null>(null)
  const [addListDialog, setAddListDialog] = useState(false)
  const [addContactDialog, setAddContactDialog] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newContact, setNewContact] = useState({ name: '', phone: '', customFields: {} as Record<string, string> })
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editContactDialog, setEditContactDialog] = useState(false)
  const [editContact, setEditContact] = useState<ContactItem | null>(null)
  const [editContactForm, setEditContactForm] = useState({ name: '', phone: '', customFields: {} as Record<string, string> })
  const [deleteContactConfirm, setDeleteContactConfirm] = useState<string | null>(null)
  const [quickImportOpen, setQuickImportOpen] = useState(false)
  const [quickImportName, setQuickImportName] = useState('')
  const [quickImportFile, setQuickImportFile] = useState<File | null>(null)
  const [quickImporting, setQuickImporting] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  // DnD sensors for contact reorder
  const contactDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/contact-lists')
      const data = await res.json()
      setContactLists(data)
    } catch { toast.error('Erro ao carregar listas') }
    finally { setLoading(false) }
  }, [])

  const refreshSelectedList = useCallback(async (listId: string) => {
    try {
      const listRes = await fetch(`/api/contact-lists/${listId}`)
      if (listRes.ok) {
        const freshList = await listRes.json()
        setSelectedList(prev => prev?.id === listId ? freshList : prev)
      }
    } catch { /* ignore */ }
  }, [])

  const fetchContacts = useCallback(async (listId: string, page = 1) => {
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('search', searchQuery)
      params.set('page', String(page))
      params.set('limit', String(CONTACTS_PER_PAGE))
      const res = await fetch(`/api/contact-lists/${listId}/contacts?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar contatos')
      const list = Array.isArray(data) ? data : data.contacts || []
      setContacts(list)
      setTotalContacts(data.total ?? list.length)
      setContactsPage(page)
    } catch { toast.error('Erro ao carregar contatos') }
  }, [searchQuery])

  const handleContactDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !selectedList) return

    const oldIndex = contacts.findIndex(c => c.id === active.id)
    const newIndex = contacts.findIndex(c => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    // Optimistically update UI
    const reordered = arrayMove(contacts, oldIndex, newIndex)
    setContacts(reordered)

    // Persist to server
    try {
      await fetch(`/api/contact-lists/${selectedList.id}/contacts/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: reordered.map(c => c.id) }),
      })
    } catch {
      toast.error('Erro ao reordenar')
      fetchContacts(selectedList.id, contactsPage) // Revert on error
    }
  }

  const bulkDeleteContacts = async () => {
    if (selectedContactIds.size === 0 || !selectedList) return
    try {
      const res = await fetch('/api/contacts/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: Array.from(selectedContactIds) }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast.success(`${data.deleted} contatos removidos!`)
      setSelectedContactIds(new Set())
      setBulkDeleteConfirm(false)
      fetchContacts(selectedList.id, contactsPage)
      refreshSelectedList(selectedList.id)
    } catch {
      toast.error('Erro ao excluir contatos')
    }
  }

  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedContactIds.size === contacts.length && contacts.length > 0) {
      setSelectedContactIds(new Set())
    } else {
      setSelectedContactIds(new Set(contacts.map(c => c.id)))
    }
  }

  useEffect(() => {
    fetchLists()
    const interval = setInterval(fetchLists, isVisible ? 30000 : 120000)
    return () => clearInterval(interval)
  }, [fetchLists])
  useEffect(() => { if (selectedList) fetchContacts(selectedList.id, 1) }, [selectedList, fetchContacts])

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
        body: JSON.stringify({
          name: newContact.name,
          phone: newContact.phone,
          customFields: newContact.customFields,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Contato adicionado!')
      setAddContactDialog(false)
      setNewContact({ name: '', phone: '', customFields: {} })
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
      const colInfo = data.columnMapping ? ` | Colunas: ${Object.keys(data.columnMapping).join(', ')}` : ''
      toast.success(`${data.imported} contatos importados!${colInfo}`)
      setImportDialogOpen(false)
      // Refresh the selected list to get updated columns mapping
      await refreshSelectedList(selectedList.id)
      fetchContacts(selectedList.id)
      fetchLists()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar contatos')
    }
  }

  const openEditContact = (contact: ContactItem) => {
    setEditContact(contact)
    let cf: Record<string, string> = {}
    if (contact.customFields) {
      try { cf = JSON.parse(contact.customFields) } catch { /* ignore */ }
    }
    setEditContactForm({ name: contact.name, phone: contact.phone, customFields: cf })
    setEditContactDialog(true)
  }

  const saveEditContact = async () => {
    if (!editContact) return
    try {
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editContactForm.name,
          phone: editContactForm.phone,
          customFields: Object.keys(editContactForm.customFields).length > 0 ? editContactForm.customFields : undefined,
        }),
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

      const colInfo = importData.columnMapping ? ` | Colunas: ${Object.keys(importData.columnMapping).join(', ')}` : ''
      toast.success(`Lista "${quickImportName}" criada com ${importData.imported} contatos!${colInfo}`, { id: 'quick-import', duration: 5000 })
      setQuickImportOpen(false)
      setQuickImportName('')
      setQuickImportFile(null)
      await fetchLists()
      // Re-fetch the list to get updated columns mapping after import
      await refreshSelectedList(listData.id)
      if (!selectedList) setSelectedList(listData)
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
          <h2 className="text-2xl font-bold">Lista de Contatos</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas listas e contatos</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={() => {
            const a = document.createElement('a')
            a.href = '/templates/modelo_contatos.xlsx'
            a.download = 'modelo_contato_octupuszap.xlsx'
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
              a.download = 'modelo_contato_octupuszap.csv'
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
            <h3
              contentEditable={true}
              suppressContentEditableWarning={true}
              onBlur={async (e) => {
                const newName = e.currentTarget.textContent?.trim()
                if (newName && newName !== selectedList!.name) {
                  try {
                    await fetch(`/api/contact-lists/${selectedList!.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: newName }),
                    })
                    setSelectedList({ ...selectedList!, name: newName })
                    fetchLists()
                    toast.success('Nome atualizado!')
                  } catch { toast.error('Erro ao renomear lista') }
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
              className="text-lg font-semibold outline-none border-b border-transparent hover:border-muted-foreground/30 focus:border-primary px-1 rounded cursor-text"
              title="Clique para editar o nome"
            >{selectedList.name}</h3>
            <Badge variant="secondary">{totalContacts} contatos</Badge>
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
            <Button variant="outline" className="gap-1.5" onClick={() => {
              if (!selectedList) return
              const doExport = async () => {
                try {
                  // Fetch ALL contacts for export (paginate through all pages)
                  const allExported: any[] = []
                  let exportPage = 1
                  const exportLimit = 200
                  let hasMore = true
                  while (hasMore) {
                    const res = await fetch(`/api/contact-lists/${selectedList.id}/contacts?page=${exportPage}&limit=${exportLimit}`)
                    const exportContacts = await res.json()
                    const pageList = Array.isArray(exportContacts) ? exportContacts : exportContacts.contacts || []
                    allExported.push(...pageList)
                    hasMore = pageList.length >= exportLimit
                    exportPage++
                  }
                  if (allExported.length === 0) { toast.error('Nenhum contato para exportar'); return }
                  const allCustomKeys = new Set<string>()
                  allExported.forEach((c: any) => {
                    if (c.customFields) {
                      try { Object.keys(JSON.parse(c.customFields)).forEach(k => allCustomKeys.add(k)) } catch {}
                    }
                  })
                  const headers = ['Nome', 'Telefone', ...Array.from(allCustomKeys).sort()]
                  const rows = allExported.map((c: any) => {
                    let cf: Record<string, string> = {}
                    if (c.customFields) { try { cf = JSON.parse(c.customFields) } catch {} }
                    return [c.name || '', c.phone || '', ...Array.from(allCustomKeys).sort().map(k => cf[k] || '')]
                  })
                  const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n')
                  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${selectedList.name}_contatos.csv`
                  a.click()
                  URL.revokeObjectURL(url)
                  toast.success(`${allExported.length} contatos exportados!`)
                } catch { toast.error('Erro ao exportar contatos') }
              }
              doExport()
            }}>
              <Download className="size-4" /> Exportar
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
            <Card className="shadow-lg border-0">
              <CardContent className="p-0 flex flex-col" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                {/* Fixed header */}
                <div className="overflow-hidden bg-muted/50 border-b shrink-0 pr-[17px]">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-[40px]" />
                      <col className="w-[36px]" />
                      {STANDARD_CONTACT_FIELDS.map(f => (
                        <col key={f.key} className={f.core ? 'w-[18%]' : 'w-[12%]'} />
                      ))}
                      <col className="w-[16%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="p-3 w-[40px]">
                          <input type="checkbox" checked={selectedContactIds.size === contacts.length && contacts.length > 0} onChange={toggleSelectAll} className="size-4 rounded border-gray-300" />
                        </th>
                        <th className="p-3 w-[36px]"></th>
                        {STANDARD_CONTACT_FIELDS.map(f => (
                          <th key={f.key} className="text-left p-3 font-medium truncate">{f.header}</th>
                        ))}
                        <th className="text-left p-3 font-medium">Incluído em</th>
                        <th className="text-left p-3 font-medium">Ações</th>
                      </tr>
                    </thead>
                  </table>
                </div>
                {/* Bulk action toolbar */}
                {selectedContactIds.size > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border-b shrink-0">
                    <span className="text-sm font-medium">{selectedContactIds.size} selecionado(s)</span>
                    <Button variant="outline" size="sm" onClick={() => setSelectedContactIds(new Set())}>
                      Desmarcar todos
                    </Button>
                    <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setBulkDeleteConfirm(true)}>
                      <Trash2 className="size-3.5" /> Excluir selecionados
                    </Button>
                  </div>
                )}
                {/* Scrollable body with DnD */}
                <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                  <DndContext sensors={contactDragSensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleContactDragEnd}>
                    <SortableContext items={contacts.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                      <table className="w-full text-sm table-fixed">
                        <colgroup>
                          <col className="w-[40px]" />
                          <col className="w-[36px]" />
                          {STANDARD_CONTACT_FIELDS.map(f => (
                            <col key={f.key} className={f.core ? 'w-[18%]' : 'w-[12%]'} />
                          ))}
                          <col className="w-[16%]" />
                          <col className="w-[8%]" />
                        </colgroup>
                        <tbody>
                          {contacts.map(c => {
                            let customData: Record<string, string> = {}
                            if (c.customFields) {
                              try { customData = JSON.parse(c.customFields) } catch {}
                            }
                            return (
                              <SortableContactRow
                                key={c.id}
                                contact={c}
                                isSelected={selectedContactIds.has(c.id)}
                                onToggleSelect={() => toggleContactSelection(c.id)}
                                onEdit={() => openEditContact(c)}
                                onDelete={() => setDeleteContactConfirm(c.id)}
                                customData={customData}
                              />
                            )
                          })}
                        </tbody>
                      </table>
                    </SortableContext>
                  </DndContext>
                </div>
                {/* Pagination footer */}
                {totalContacts > CONTACTS_PER_PAGE && (
                  <div className="flex items-center justify-between px-4 py-3 border-t bg-background shrink-0">
                    <span className="text-sm text-muted-foreground">
                      {Math.min((contactsPage - 1) * CONTACTS_PER_PAGE + 1, totalContacts)}–{Math.min(contactsPage * CONTACTS_PER_PAGE, totalContacts)} de {totalContacts}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={contactsPage <= 1}
                        onClick={() => selectedList && fetchContacts(selectedList.id, contactsPage - 1)}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={contactsPage * CONTACTS_PER_PAGE >= totalContacts}
                        onClick={() => selectedList && fetchContacts(selectedList.id, contactsPage + 1)}
                      >
                        Próximo
                      </Button>
                    </div>
                  </div>
                )}
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
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
                      <LayoutList className="size-5 text-sky-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate text-base">{list.name}</CardTitle>
                      <CardDescription>{list._count?.contacts || 0} contatos</CardDescription>
                    </div>
                    <TooltipProvider><Tooltip><TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(list.id) }}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger><TooltipContent>Excluir lista</TooltipContent></Tooltip></TooltipProvider>
                  </div>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
          {contactLists.length === 0 && (
            <EmptyState
              icon={Users}
              title="Nenhuma lista criada"
              description="Crie uma lista para organizar seus contatos e facilitar o envio de campanhas."
              action={{ label: 'Criar primeira lista', onClick: () => setAddListDialog(true) }}
              className="col-span-full"
            />
          )}
        </div>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Lista" description="Tem certeza? Todos os contatos serão removidos."
        onConfirm={() => { if (deleteConfirm) deleteList(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      <ConfirmDialog open={!!deleteContactConfirm} onOpenChange={() => setDeleteContactConfirm(null)}
        title="Remover Contato" description="Tem certeza que deseja remover este contato?"
        onConfirm={() => { if (deleteContactConfirm) deleteContact(deleteContactConfirm) }} confirmLabel="Remover" variant="destructive" />

      <ConfirmDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}
        title="Excluir Contatos" description={`Tem certeza que deseja excluir ${selectedContactIds.size} contato(s)? Esta ação não pode ser desfeita.`}
        onConfirm={bulkDeleteContacts} confirmLabel="Excluir" variant="destructive" />

      {/* Edit Contact Dialog */}
      <Dialog open={editContactDialog} onOpenChange={setEditContactDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>Editar Contato</DialogTitle><DialogDescription>Atualize as informações do contato</DialogDescription></DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2"><Label>Nome</Label><Input value={editContactForm.name} onChange={e => setEditContactForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={editContactForm.phone} onChange={e => setEditContactForm(p => ({ ...p, phone: e.target.value }))} /></div>
            {STANDARD_CONTACT_FIELDS.filter(f => !f.core).map(f => (
              <div key={f.key} className="space-y-2">
                <Label>{f.header}</Label>
                <Input value={editContactForm.customFields[f.key] || ''} onChange={e => setEditContactForm(p => ({ ...p, customFields: { ...p.customFields, [f.key]: e.target.value } }))} />
              </div>
            ))}
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveEditContact} disabled={!editContactForm.name || !editContactForm.phone} className="bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Contact Dialog */}
      <Dialog open={addContactDialog} onOpenChange={(open) => { setAddContactDialog(open); if (!open) setNewContact({ name: '', phone: '', customFields: {} }) }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>Adicionar Contato</DialogTitle><DialogDescription>Adicione um contato manualmente à lista{selectedList ? ` "${selectedList.name}"` : ''}</DialogDescription></DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2"><Label>Nome</Label><Input placeholder="Ex: João Silva" value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input placeholder="Ex: 48999990001" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} /></div>
            {STANDARD_CONTACT_FIELDS.filter(f => !f.core).map(f => (
              <div key={f.key} className="space-y-2">
                <Label>{f.header}</Label>
                <Input placeholder={`Ex: valor para ${f.header}`} value={newContact.customFields[f.key] || ''} onChange={e => setNewContact(p => ({ ...p, customFields: { ...p.customFields, [f.key]: e.target.value } }))} />
              </div>
            ))}
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={addContact} disabled={!newContact.name || !newContact.phone} className="bg-emerald-600 hover:bg-emerald-700">Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog (inside a list) */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
              <p className="text-muted-foreground">Uma coluna de <strong>Telefone/WhatsApp</strong> é obrigatória (aceita: Telefone, WhatsApp, Celular, Tel, Phone, Numero). A coluna <strong>Nome</strong> é recomendada. As demais colunas ficam disponíveis automaticamente como variáveis (ex: coluna "Empresa" vira {'{{empresa}}'}, coluna "Vendedora" vira {'{{vendedora}}'}). Adicione quantas colunas quiser!</p>
              <code className="block bg-muted p-2 rounded text-[11px]">Nome,WhatsApp,Empresa,Vendedora{'\n'}Maria,5511999990001,Tech Corp,Ana{'\n'}Julia,5521988880002,Info Ltda,Carla</code>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Import Dialog — create list + import in one step */}
      <Dialog open={quickImportOpen} onOpenChange={(open) => { setQuickImportOpen(open); if (!open) { setQuickImportName(''); setQuickImportFile(null) } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
                  a.download = 'modelo_contato_octupuszap.xlsx'
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
                    a.download = 'modelo_contato_octupuszap.csv'
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
  delayUnit: 'minutes' | 'seconds'
  mediaFile: File | null
  mediaUrl: string
  mediatype: string
  audioMode: 'whatsapp' | 'original'  // 'whatsapp' = convert to OGG, 'original' = keep as-is
  caption: string
  linkUrl: string
  linkPreview: boolean
  contactName: string
  contactPhone: string
  locationLat: string
  locationLng: string
  locationName: string
  variations: { content: string; mediaFile: File | null; mediaUrl: string; mediatype: string; audioMode: 'whatsapp' | 'original'; caption: string; linkUrl: string; linkPreview: boolean; contactName: string; contactPhone: string; locationLat: string; locationLng: string; locationName: string }[]
}

// ===== MessageBuilder Component =====
// Visual message editor with inline KEY blocks, variable chips, and WhatsApp preview

// Emoji list for the picker


// Helper: parse {{KEY: var1 | var2 | var3}} blocks from text


// Helper: generate preview text replacing KEY blocks and contact variables
// Logic: {{anything}} pulls from the linked contact list's first contact data
// If the variable exists in the contact's data, show the real value; if not, leave {{name}} as-is




// ===== Sortable Tab Component for Drag & Drop (Browser Tab Style) =====




// ===== Templates Tab =====
function TemplatesTab() {
  const isVisible = useIsVisible()
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

  useEffect(() => {
    fetchTemplates()
    // PERF FIX: was 10s, now 30s. Templates rarely change.
    const interval = setInterval(fetchTemplates, isVisible ? 60000 : 300000)
    return () => clearInterval(interval)
  }, [fetchTemplates])

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

  const TEMPLATE_VARS = ['{{nome}}', '{{whatsapp}}', '{{telefone}}']

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
    'document': { icon: <FileIcon className="size-3.5" />, color: 'text-violet-500', label: 'Documento' },
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
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>Criar Template</DialogTitle>
              <DialogDescription>Crie um template de mensagem reutilizável</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
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
            <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
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
        <CardListSkeleton count={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum template encontrado"
          description="Crie seu primeiro template de mensagem para reutilizar em campanhas."
          action={{ label: 'Criar primeiro template', onClick: () => setCreateDialogOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t, i) => {
            const vars = t.content.match(/\{\{[^}]+\}\}/g) || []
            const mediaInfo = mediaTypeIcons[t.mediatype || 'text'] || mediaTypeIcons['text']
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0 group">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
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
                  <CardContent className="space-y-4">
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
                        <TooltipProvider><Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-emerald-600 h-7 w-7 p-0" onClick={() => openEditTemplate(t)}>
                            <Pencil className="size-3.5" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Editar template</TooltipContent></Tooltip></TooltipProvider>
                        <TooltipProvider><Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600 h-7 w-7 p-0" onClick={() => setDeleteConfirm(t.id)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Excluir template</TooltipContent></Tooltip></TooltipProvider>
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
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Editar Template</DialogTitle>
            <DialogDescription>Atualize as informações do template</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
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
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveEditTemplate} disabled={!editForm.name || !editForm.content} className="bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// AntiBanTab extracted to components/antiban-tab.tsx
// InboxTab extracted to components/inbox-tab.tsx



// ===== Mensagens Tab =====
function MensagensTab() {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [refreshing, setRefreshing] = useState(false)

  const fetchMessages = useCallback(async (showLoading = false) => {
    if (showLoading) setRefreshing(true)
    const startTime = showLoading ? Date.now() : 0
    try {
      const res = await fetch('/api/messages', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const data = await res.json()
      setMessages(Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
      if (showLoading) {
        // Ensure loading animation is visible for at least 500ms
        const elapsed = Date.now() - startTime
        if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed))
        toast.success('Mensagens atualizadas!')
      }
    } catch { toast.error('Erro ao carregar mensagens') }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => {
    fetchMessages()
    // PERF FIX: was 5s, now 10s.
    const interval = setInterval(() => fetchMessages(), 10000)
    return () => clearInterval(interval)
  }, [fetchMessages])

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
          <Button variant="outline" className="gap-2" onClick={() => fetchMessages(true)} disabled={refreshing}>
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
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
                    <th className="text-left p-3 font-medium">Msg</th>
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
                      <td className="p-3">{m.stepOrder > 1 ? <Badge variant="outline" className="text-xs">Msg {m.stepOrder}</Badge> : <Badge variant="secondary" className="text-xs">Msg 1</Badge>}</td>
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
    socks5Host: '', socks5Port: '8084', socks5User: '', socks5Pass: '',
  })
  const [initialConfig, setInitialConfig] = useState<typeof config | null>(null)
  const isDirty = initialConfig ? JSON.stringify(initialConfig) !== JSON.stringify(config) : false
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
        // Snapshot inicial pra detectar mudancas (dirty state) — dentro do try pra ter acesso a data
        setInitialConfig({
          resetHour: parseInt(data.resetHour) || 0,
          defaultProxyMode: data.defaultProxyMode || 'none',
          globalDailyLimit: parseInt(data.globalDailyLimit) || 1000,
          emailNotifications: data.emailNotifications === 'true',
          timezone: data.timezone || 'America/Sao_Paulo',
          evolutionApiUrl: data.evolution_api_url || '',
          evolutionApiKey: data.evolution_api_key || '',
          socks5Host: data.default_socks5_host || '',
          socks5Port: data.default_socks5_port || '8084',
          socks5User: data.default_socks5_user || '',
          socks5Pass: data.default_socks5_pass || '',
        })
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
      setInitialConfig({ ...config })
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
                <Input placeholder="8084" value={config.socks5Port}
                  onChange={e => setConfig(p => ({ ...p, socks5Port: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Porta SOCKS5 do Every Proxy (padrão: 8084)</p>
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

      <div className="flex items-center justify-end gap-3">
        {isDirty && !saving && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            Não salvo
          </Badge>
        )}
        {saving && (
          <Badge variant="secondary" className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
            <RefreshCw className="size-3 animate-spin" />
            Salvando
          </Badge>
        )}
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
          onClick={saveSettings} disabled={saving || !isDirty}>
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
        <CardContent className="space-y-4">
          <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700 max-h-64 overflow-y-auto">
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
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
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
  const isVisible = useIsVisible()
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

  useEffect(() => {
    fetchUsers()
    const interval = setInterval(fetchUsers, isVisible ? 30000 : 300000)
    return () => clearInterval(interval)
  }, [fetchUsers])

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
          <ScrollArea className="max-h-[500px]">
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
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription>Crie um novo usuário no sistema</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
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
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
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
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>Altere os dados do usuário</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
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
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
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

      {/* Audit Log */}
      <AuditLogSection />
    </div>
  )
}

// ===== Audit Log Section =====
function AuditLogSection() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/audit-logs?limit=50')
      const data = await res.json()
      setLogs(data.logs || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const filtered = filter ? logs.filter(l =>
    l.action?.toLowerCase().includes(filter.toLowerCase()) ||
    l.userName?.toLowerCase().includes(filter.toLowerCase()) ||
    l.targetType?.toLowerCase().includes(filter.toLowerCase())
  ) : logs

  const actionColors: Record<string, string> = {
    CREATE: 'text-emerald-600',
    UPDATE: 'text-sky-600',
    DELETE: 'text-rose-600',
    PAUSE: 'text-amber-600',
    RESUME: 'text-emerald-600',
    CONNECT: 'text-violet-600',
    DISCONNECT: 'text-orange-600',
  }

  const getActionColor = (action: string) => {
    for (const [key, color] of Object.entries(actionColors)) {
      if (action.startsWith(key)) return color
    }
    return 'text-muted-foreground'
  }

  return (
    <Card className="shadow-lg border-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-900/30">
              <Database className="size-4 text-slate-600" />
            </div>
            <CardTitle className="text-lg">Log de Auditoria</CardTitle>
          </div>
          <Input
            placeholder="Filtrar por ação, usuário..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 w-56 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Database className="size-8 mb-2 opacity-50" />
            <p className="text-sm">Nenhum log de auditoria ainda</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-thin">
            {filtered.map((log) => (
              <div key={log.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-sm">
                <span className={cn('font-mono font-semibold shrink-0 w-32', getActionColor(log.action))}>
                  {log.action}
                </span>
                <span className="text-muted-foreground shrink-0 w-32 truncate">
                  {log.userName || 'Sistema'}
                </span>
                <span className="text-foreground/70 truncate flex-1">
                  {log.targetType ? log.targetType : ''}
                  {log.targetId ? ': ' + log.targetId.substring(0, 8) + '...' : ''}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(log.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ===== Standard Contact Fields (always shown) =====
const STANDARD_CONTACT_FIELDS = [
  { header: 'Nome', key: 'nome', core: true },       // maps to contact.name
  { header: 'Telefone', key: 'telefone', core: true }, // maps to contact.phone
  { header: 'Codigo', key: 'codigo', core: false },
  { header: 'Empresa', key: 'empresa', core: false },
  { header: 'Vendedora', key: 'vendedora', core: false },
  { header: 'Whatsapp', key: 'whatsapp', core: false },
  { header: 'Nota', key: 'nota', core: false },
] as const

// ===== Main App =====
// ===== Theme Toggle Component =====
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="h-8 w-8" />
  }

  const isDark = theme === 'dark'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-amber-400 h-8 w-8 p-0"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDark ? 'Modo claro' : 'Modo escuro'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

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

  // Live clock — Brasília time (UTC-3)
  // PERF FIX: Only update seconds every 1s. Date and time (HH:MM) only change
  // once per day / once per minute respectively, so we skip redundant setState
  // calls that would cause unnecessary re-renders of the entire OctupusZapApp.
  const [brasiliaTime, setBrasiliaTime] = useState('')
  const [brasiliaDate, setBrasiliaDate] = useState('')
  const [brasiliaSeconds, setBrasiliaSeconds] = useState('')
  const lastTimeRef = useRef('')
  const lastDateRef = useRef('')
  useEffect(() => {
    const update = () => {
      const now = new Date()
      const fmt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })
      const parts = fmt.formatToParts(now)
      const get = (type: string) => parts.find(p => p.type === type)?.value || ''
      const newDate = `${get('day')}/${get('month')}/${get('year')}`
      const newTime = `${get('hour')}:${get('minute')}`

      // Only update date if it changed (once per day)
      if (newDate !== lastDateRef.current) {
        lastDateRef.current = newDate
        setBrasiliaDate(newDate)
      }
      // Only update time if it changed (once per minute)
      if (newTime !== lastTimeRef.current) {
        lastTimeRef.current = newTime
        setBrasiliaTime(newTime)
      }
      // Always update seconds (once per second)
      setBrasiliaSeconds(get('second'))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(data => {
      if (data.authenticated) {
        setLoggedIn(true)
        setUsername(data.user?.username || '')
        setUserRole(data.user?.role || 'operador')
        // Request browser notification permission for chip disconnect alerts
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {})
        }
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

  // Auto-refresh stats every 15 seconds when logged in
  // PERF FIX: was 5s, now 15s. Stats don't change fast enough to justify 5s polling.
  useEffect(() => {
    if (!loggedIn) return
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    const interval = setInterval(() => {
      fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    }, 15000)
    return () => clearInterval(interval)
  }, [loggedIn])

  // Auto-process campaigns every 120 seconds when logged in
  // This is a BACKUP — the continuous processing loop is the primary driver.
  // We use a longer interval (120s instead of 60s) to reduce the chance of
  // concurrent invocations that could cause race conditions with the sending engine.
  // The atomic campaign slot claim in the sending engine handles concurrent access,
  // but reducing unnecessary concurrent calls is still good practice.
  useEffect(() => {
    if (!loggedIn) return
    const processCampaigns = () => {
      fetch('/api/campaigns/process', { method: 'POST' }).catch(() => {})
    }
    // First process after 15 seconds (give time for page to load)
    const timeout = setTimeout(processCampaigns, 15000)
    // Then every 120 seconds
    const interval = setInterval(processCampaigns, 120000)
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
    const tabFallback = (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
    
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
      case 'aquecimento': return <WarmingTab />
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
                  Crie uma nova senha para acessar o painel. A recuperação é protegida pelo código de segurança do servidor.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Código de Segurança (AUTH_SECRET)</Label>
                  <Input
                    type="password"
                    placeholder="Cole o AUTH_SECRET do arquivo .env do servidor"
                    value={forgotForm.verificationKey}
                    onChange={e => setForgotForm(p => ({ ...p, verificationKey: e.target.value }))}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                  <p className="text-xs text-zinc-500">Encontre no servidor: /opt/octupuszap/.env → AUTH_SECRET</p>
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
                  <p className="text-xs text-amber-400">Por segurança, é necessário informar o AUTH_SECRET (do arquivo .env do servidor) para redefinir a senha. Isso garante que apenas administradores com acesso ao servidor possam alterar a senha.</p>
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
    <div className="h-screen flex overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-zinc-900 dark:bg-zinc-950 border-r border-zinc-800 shrink-0 overflow-hidden">
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

        <ScrollArea className="flex-1 min-h-0 px-3">
          <div className="space-y-1 py-1">
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
          </div>
        </ScrollArea>

        <div className="shrink-0 p-4 m-3 rounded-xl bg-zinc-800/50 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-md">
              <span className="text-sm font-bold text-white">{username ? username.charAt(0).toUpperCase() : 'O'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{username || 'OctupusZap'}</p>
              <p className="text-xs text-zinc-400">{userRole === 'master' ? 'Master' : userRole === 'admin' ? 'Admin' : 'Operador'}</p>
            </div>
            <ThemeToggle />
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
            <span className="text-xs text-zinc-500">Auto-refresh 60s • Auto-deploy</span>
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
              <ScrollArea className="flex-1 min-h-0 px-3">
                <div className="space-y-1 py-1">
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
                </div>
              </ScrollArea>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Bar */}
        <header className="shrink-0 z-30 flex items-center gap-4 px-4 lg:px-6 h-14 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="size-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="size-4 text-emerald-500 lg:hidden" />
            <span className="font-medium text-foreground">{NAV_ITEMS.find(n => n.id === activeTab)?.label || 'Dashboard'}</span>
          </div>

          <div className="flex-1" />

          {/* Relógio Brasília — sempre visível */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <span className="font-medium">{brasiliaDate}</span>
            <span className="text-foreground font-semibold tabular-nums text-sm">{brasiliaTime}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{brasiliaSeconds}</span>
          </div>

        </header>

        {/* Page Content */}
        <main className="flex-1 min-h-0 p-4 lg:p-6 pb-8 overflow-hidden">
          <div className={activeTab === 'inbox' ? 'h-full' : 'h-full overflow-y-auto'}>
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className={activeTab === 'inbox' ? 'h-full' : ''}>
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        {/* Footer */}
        <footer className="shrink-0 px-4 lg:px-6 py-2.5 border-t bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm">
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
