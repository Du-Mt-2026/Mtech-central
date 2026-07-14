'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: DashboardTab, DonutChart, MiniBarChart (charts are inline helpers used only by DashboardTab).

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, ChevronRight, Clock, MessageSquare, RefreshCw, Send,
  Smartphone, TrendingDown, TrendingUp, Users, Zap,
} from 'lucide-react'
import { type Stats } from '@/lib/types'
import { statusColor } from '@/components/shared'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatsSkeleton } from '@/components/ui/skeleton'

// ===== Dashboard Tab =====
export function DashboardTab({ stats, onRefresh, setActiveTab }: { stats: Stats | null; onRefresh: () => void; setActiveTab: (tab: string) => void }) {
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
