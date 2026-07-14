'use client'

import React from 'react'
import {
  Play, Pause, X, Pencil, Loader2, RotateCcw, ArrowRightLeft, RefreshCw,
  MoreVertical, Download, Copy, BookmarkPlus, Trash2, AlertTriangle,
  AlertCircle, Clock, Shield, Snowflake, Flame, User, CheckCircle2, Check,
  XCircle, Search, Shuffle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/shared'
import { toast } from 'sonner'
import { type Campaign, type MessageItem, type Chip } from '@/lib/types'

type ChipEffectiveInfo = { effectiveLimit: number; phaseDay: number; phaseMaxDays: number }

type DetailMessageCounts = {
  pending: number
  sent: number
  delivered: number
  failed: number
  sending: number
  total: number
}

export function CampaignDetailDialog({
  detailDialogOpen, setDetailDialogOpen, setEditing,
  selectedCampaign, setSelectedCampaign,
  detailMessages, setDetailMessages, detailMessageCounts,
  detailSortBy, setDetailSortBy,
  detailSearchQuery, setDetailSearchQuery,
  detailStatusFilter, setDetailStatusFilter,
  startingCampaignIds, startCampaignAction,
  fetchCampaigns, updateCampaignStatus,
  exportCampaign, duplicateCampaign, saveCampaignAsTemplate,
  startEditing, setDeleteConfirm,
  setRedistributeDistribution, setDistMode, setRedistributeDialogOpen,
  refreshingDetail, setRefreshingDetail,
  toggleChipPause, getChipEffectiveInfo,
  continuousProcessing, continuousStats,
}: {
  detailDialogOpen: boolean
  setDetailDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditing: React.Dispatch<React.SetStateAction<boolean>>
  selectedCampaign: Campaign | null
  setSelectedCampaign: React.Dispatch<React.SetStateAction<Campaign | null>>
  detailMessages: MessageItem[]
  setDetailMessages: React.Dispatch<React.SetStateAction<MessageItem[]>>
  detailMessageCounts: DetailMessageCounts
  detailSortBy: 'name' | 'sendOrder'
  setDetailSortBy: React.Dispatch<React.SetStateAction<'name' | 'sendOrder'>>
  detailSearchQuery: string
  setDetailSearchQuery: React.Dispatch<React.SetStateAction<string>>
  detailStatusFilter: string
  setDetailStatusFilter: React.Dispatch<React.SetStateAction<string>>
  startingCampaignIds: Set<string>
  startCampaignAction: (id: string) => Promise<void>
  fetchCampaigns: () => Promise<void>
  updateCampaignStatus: (id: string, status: string) => Promise<void>
  exportCampaign: (id: string, name: string, format?: string) => Promise<void>
  duplicateCampaign: (c: Campaign) => Promise<void>
  saveCampaignAsTemplate: (c: Campaign) => Promise<void>
  startEditing: (campaign: Campaign) => void
  setDeleteConfirm: React.Dispatch<React.SetStateAction<string | null>>
  setRedistributeDistribution: React.Dispatch<React.SetStateAction<Record<string, number>>>
  setDistMode: React.Dispatch<React.SetStateAction<'absolute' | 'percentage'>>
  setRedistributeDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  refreshingDetail: boolean
  setRefreshingDetail: React.Dispatch<React.SetStateAction<boolean>>
  toggleChipPause: (chipId: string, currentlyPaused: boolean, chipName: string) => Promise<void>
  getChipEffectiveInfo: (chip: Chip) => ChipEffectiveInfo
  continuousProcessing: boolean
  continuousStats: { processed: number; remaining: number; elapsed: number }
}) {
  return (
    <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setEditing(false) }}>
      <DialogContent fullWidth className="max-h-[90vh] !p-0">
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="truncate">{selectedCampaign?.name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {selectedCampaign?.status === 'draft' && (
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={startingCampaignIds.has(selectedCampaign.id)} onClick={() => startCampaignAction(selectedCampaign.id)}>
                  {startingCampaignIds.has(selectedCampaign.id) ? <><Loader2 className="size-3.5 animate-spin" /> Iniciando...</> : <><Play className="size-3.5" /> Iniciar</>}
                </Button>
              )}
              {selectedCampaign?.status === 'running' && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { try { await fetch(`/api/campaigns/${selectedCampaign.id}/pause`, { method: 'POST' }); toast.success('Campanha pausada!'); fetchCampaigns(); if (selectedCampaign) { const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' }); if (res.ok) setSelectedCampaign(await res.json()) } } catch { toast.error('Erro ao pausar') } }}>
                  <Pause className="size-3.5" /> Pausar
                </Button>
              )}
              {selectedCampaign?.status === 'paused' && (
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={async () => { try { await fetch(`/api/campaigns/${selectedCampaign.id}/resume`, { method: 'POST' }); toast.success('Campanha retomada!'); fetchCampaigns(); if (selectedCampaign) { const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' }); if (res.ok) setSelectedCampaign(await res.json()) } } catch { toast.error('Erro ao retomar') } }}>
                  <Play className="size-3.5" /> Retomar
                </Button>
              )}
              {selectedCampaign && (selectedCampaign.status === 'running' || selectedCampaign.status === 'paused') && (
                <Button variant="outline" size="sm" className="gap-1.5 text-rose-600 hover:text-rose-700 border-rose-200" onClick={async () => { await updateCampaignStatus(selectedCampaign.id, 'cancelled'); const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' }); if (res.ok) setSelectedCampaign(await res.json()) }}>
                  <X className="size-3.5" /> Cancelar
                </Button>
              )}
              {selectedCampaign && ['draft', 'paused', 'scheduled'].includes(selectedCampaign.status) && (
                <Button variant="outline" size="sm" className="gap-1.5 text-amber-500 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20" onClick={() => startEditing(selectedCampaign)}>
                  <Pencil className="size-3.5" /> Editar
                </Button>
              )}
              {selectedCampaign && (selectedCampaign.messageStatusCounts?.failed || 0) > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  if (!selectedCampaign) return
                  try {
                    const res = await fetch('/api/messages/resend-all-failed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: selectedCampaign.id }) })
                    const data = await res.json()
                    if (res.ok) { toast.success(`${data.resetCount || 0} mensagens reenviadas`); const msgRes = await fetch(`/api/messages?campaignId=${selectedCampaign.id}&limit=5000`, { cache: 'no-store' }); const _r = await msgRes.json(); setDetailMessages(Array.isArray(_r?.data) ? _r.data : Array.isArray(_r) ? _r : []); fetchCampaigns() }
                    else toast.error(data.error || 'Erro ao reenviar')
                  } catch { toast.error('Erro ao reenviar mensagens') }
                }}>
                  <RotateCcw className="size-3.5" /> Reenviar falhadas ({selectedCampaign.messageStatusCounts?.failed})
                </Button>
              )}
              {selectedCampaign?.status === 'paused' && (selectedCampaign.messageStatusCounts?.pending || 0) > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => {
                  if (!selectedCampaign) return
                  // Initialize redistribution state from current campaign chips
                  const currentDist: Record<string, number> = {}
                  for (const cc of (selectedCampaign.chips || [])) {
                    currentDist[cc.chipId] = cc.contactLimit || 0
                  }
                  setRedistributeDistribution(currentDist)
                  setDistMode('absolute')
                  setRedistributeDialogOpen(true)
                }}>
                  <ArrowRightLeft className="size-3.5" /> Redistribuir
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" disabled={refreshingDetail} onClick={async () => {
                if (!selectedCampaign) return
                setRefreshingDetail(true)
                const startTime = Date.now()
                try {
                  const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' })
                  if (!res.ok) throw new Error('Erro ao buscar campanha')
                  const updated = await res.json()
                  setSelectedCampaign(updated)
                  const msgRes = await fetch(`/api/messages?campaignId=${updated.id}`, { cache: 'no-store' })
                  const msgData = await msgRes.json()
                  setDetailMessages(Array.isArray(msgData?.data) ? msgData.data : Array.isArray(msgData) ? msgData : [])
                  fetchCampaigns()
                  const elapsed = Date.now() - startTime
                  if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed))
                  toast.success('Campanha atualizada!')
                } catch { toast.error('Erro ao atualizar campanha') }
                finally { setRefreshingDetail(false) }
              }}>
                <RefreshCw className={`size-3.5 ${refreshingDetail ? 'animate-spin' : ''}`} /> Atualizar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><MoreVertical className="size-3.5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {selectedCampaign && (
                    <DropdownMenuItem onClick={() => exportCampaign(selectedCampaign.id, selectedCampaign.name)}>
                      <Download className="size-3.5 mr-2" /> Exportar relatório
                    </DropdownMenuItem>
                  )}
                  {selectedCampaign && (
                    <DropdownMenuItem onClick={() => duplicateCampaign(selectedCampaign)}>
                      <Copy className="size-3.5 mr-2" /> Duplicar
                    </DropdownMenuItem>
                  )}
                  {selectedCampaign && (
                    <DropdownMenuItem onClick={() => saveCampaignAsTemplate(selectedCampaign)}>
                      <BookmarkPlus className="size-3.5 mr-2" /> Salvar como template
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => { setDeleteConfirm(selectedCampaign?.id || null); setDetailDialogOpen(false) }}>
                    <Trash2 className="size-3.5 mr-2" /> Excluir campanha
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </DialogTitle>
          <DialogDescription>Detalhes da campanha</DialogDescription>
        </DialogHeader>
        {selectedCampaign && (
          <div className="flex gap-6 overflow-hidden p-6">
            {/* Left panel - Stats */}
            <div className="w-64 shrink-0 space-y-3 overflow-y-auto max-h-[65vh]">
              {/* Paused status reason alert */}
              {selectedCampaign.status === 'paused' && selectedCampaign.statusReason && (
                <Alert className="mb-3 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                  <AlertTriangle className="size-4 text-amber-600" />
                  <AlertTitle className="text-amber-800 dark:text-amber-300">Campanha pausada</AlertTitle>
                  <AlertDescription className="text-amber-700 dark:text-amber-400">{selectedCampaign.statusReason}</AlertDescription>
                </Alert>
              )}
              {/* Chip daily limit warning */}
              {detailMessages.some(m => m.status === 'failed' && m.error && (/limite/i.test(m.error) || /daily_limit/i.test(m.error))) && (
                <Alert variant="destructive" className="mb-3">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Chip atingiu o limite diário</AlertTitle>
                  <AlertDescription>Um dos chips atribuídos atingiu o limite de envio do dia. As mensagens pendentes foram reatribuídas a outros chips ou aguardarão até amanhã.</AlertDescription>
                </Alert>
              )}
              {continuousProcessing && continuousStats.remaining === 0 && continuousStats.processed === 0 && (() => {
                // Detect if any campaign chip is in cooldown
                const cooldownChips = (selectedCampaign?.chips || [])
                  .map((cc: any) => cc.chip)
                  .filter((c: any) => c && c.cooldownUntil && new Date(c.cooldownUntil) > new Date())
                if (cooldownChips.length > 0) {
                  const chipNames = cooldownChips.map((c: any) => c.name).join(', ')
                  const minCooldown = Math.min(...cooldownChips.map((c: any) => Math.ceil((new Date(c.cooldownUntil).getTime() - Date.now()) / 60000)))
                  return (
                    <Alert className="mb-3 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                      <Clock className="size-4 text-amber-600" />
                      <AlertTitle className="text-amber-700">Chip em cooldown</AlertTitle>
                      <AlertDescription className="text-amber-600">
                        <span className="font-semibold">{chipNames}</span> está em pausa de segurança (cooldown). Envio retoma automaticamente em <span className="font-bold">{minCooldown}min</span>. Isso protege contra banimento do WhatsApp.
                      </AlertDescription>
                    </Alert>
                  )
                }
                return (
                  <Alert variant="destructive" className="mb-3">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Processamento parado</AlertTitle>
                    <AlertDescription>Nenhuma mensagem está sendo processada. Verifique os chips atribuídos abaixo.</AlertDescription>
                  </Alert>
                )
              })()}
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={selectedCampaign.status} />
                {selectedCampaign.antiBanEnabled && <Badge variant="outline" className="gap-1 text-emerald-600"><Shield className="size-3" /> Anti-Ban</Badge>}
                <Badge variant="outline" className="gap-1">{selectedCampaign.warmingMode === 'stealth' ? <><Snowflake className="size-3" /> Furtivo</> : selectedCampaign.warmingMode === 'agressive' ? <><Flame className="size-3" /> Agressivo</> : <><Shield className="size-3" /> Normal</>}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Pendentes</p><p className="text-lg font-bold">{detailMessageCounts.pending}</p></CardContent></Card>
                <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Enviadas</p><p className="text-lg font-bold text-sky-600">{detailMessageCounts.sent}</p></CardContent></Card>
                <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Entregues</p><p className="text-lg font-bold text-emerald-600">{detailMessageCounts.delivered}</p></CardContent></Card>
                <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Falharam</p><p className="text-lg font-bold text-rose-600">{detailMessageCounts.failed}</p></CardContent></Card>
              </div>
              {/* Chips atribuídos com status de cooldown */}
              {selectedCampaign.chips && selectedCampaign.chips.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Chips Atribuídos</Label>
                  {/* #22 Estatísticas por chip */}
                  {(() => {
                    const chipStats: Record<string, { sent: number; failed: number; pending: number; total: number }> = {}
                    for (const m of detailMessages) {
                      if (!chipStats[m.chipId]) chipStats[m.chipId] = { sent: 0, failed: 0, pending: 0, total: 0 }
                      chipStats[m.chipId].total++
                      if (['sent', 'delivered', 'read'].includes(m.status)) chipStats[m.chipId].sent++
                      else if (m.status === 'failed') chipStats[m.chipId].failed++
                      else if (m.status === 'pending') chipStats[m.chipId].pending++
                    }
                    return null
                  })()}
                  {selectedCampaign.chips.map((cc: any) => {
                    const chip = cc.chip
                    if (!chip) return null
                    const inCooldown = chip.cooldownUntil && new Date(chip.cooldownUntil) > new Date()
                    const cooldownMin = inCooldown ? Math.ceil((new Date(chip.cooldownUntil).getTime() - Date.now()) / 60000) : 0
                    const chipInfo = getChipEffectiveInfo(chip)
                    const isPaused = chip.paused === true
                    return (
                      <div key={chip.id} className={`p-2 rounded-lg text-xs flex items-center gap-2 ${isPaused ? 'bg-zinc-100 dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-700' : inCooldown ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : chip.status === 'connected' ? 'bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'}`}>
                        <div className={`size-2.5 rounded-full shrink-0 ${isPaused ? 'bg-zinc-400' : chip.status === 'connected' ? 'bg-emerald-500' : chip.status === 'disconnected' ? 'bg-zinc-400' : 'bg-rose-500'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{chip.name}</span>
                            <span className="text-muted-foreground">{chip.phoneNumber}</span>
                            {/* #22 Stats por chip */}
                            {(() => {
                              const stats = detailMessages.reduce((acc, m) => {
                                if (m.chipId === chip.id) {
                                  acc.total++
                                  if (['sent', 'delivered', 'read'].includes(m.status)) acc.sent++
                                  else if (m.status === 'failed') acc.failed++
                                }
                                return acc
                              }, { sent: 0, failed: 0, total: 0 })
                              if (stats.total === 0) return null
                              return (
                                <span className="text-[9px] text-muted-foreground">
                                  {stats.sent} enviadas · {stats.failed} falhas · {stats.total} total
                                </span>
                              )
                            })()}
                            {isPaused && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-400">⏸ Pausado</Badge>}
                            {chip.status !== 'connected' && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Desconectado</Badge>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={`text-muted-foreground ${chip.sentToday >= chipInfo.effectiveLimit ? 'text-rose-600 font-semibold' : chip.sentToday >= chipInfo.effectiveLimit * 0.8 ? 'text-amber-600 font-medium' : ''}`}>{chip.sentToday || 0}/{chipInfo.effectiveLimit} enviadas hoje</span>
                            {chip.sentToday >= chipInfo.effectiveLimit && (
                              <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Limite atingido</Badge>
                            )}
                            {chip.sentToday >= chipInfo.effectiveLimit * 0.8 && chip.sentToday < chipInfo.effectiveLimit && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-amber-600 border-amber-300 bg-amber-50">80% limite</Badge>
                            )}
                            {chipInfo.effectiveLimit < (chip.dailyLimit ?? 200) && (
                              <span className="text-[10px] text-muted-foreground">(de {chip.dailyLimit ?? 200})</span>
                            )}
                            {inCooldown && (
                              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 text-[9px] px-1.5 py-0 h-4">
                                <Clock className="size-2.5" /> Cooldown {cooldownMin}min
                              </Badge>
                            )}
                            {chip.warmingPhase && chip.warmingPhase !== 'ready' && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                {chip.warmingPhase === 'nursery' ? '🌿 Aquecendo' : chip.warmingPhase === 'prewarm' ? '🔥 Pré-aquecimento' : chip.warmingPhase}
                              </Badge>
                            )}
                            {isPaused && chip.pauseReason && (
                              <span className="text-[10px] text-muted-foreground italic truncate" title={chip.pauseReason}>— {chip.pauseReason}</span>
                            )}
                          </div>
                        </div>
                        {inCooldown && !isPaused && (
                          <div className="text-right shrink-0">
                            <p className="text-amber-600 font-medium text-[10px]">Retoma em</p>
                            <p className="text-amber-700 font-bold text-xs">{cooldownMin}min</p>
                          </div>
                        )}
                        {/* PROBLEMA 4: Botão de pausa individual — só para chips conectados */}
                        {chip.status === 'connected' && (
                          <button
                            onClick={() => toggleChipPause(chip.id, isPaused, chip.name)}
                            disabled={chip.status !== 'connected'}
                            title={isPaused ? 'Retomar envios deste chip' : 'Pausar envios deste chip (continua conectado ao WhatsApp)'}
                            className={`shrink-0 inline-flex items-center justify-center size-7 rounded-md transition-colors ${isPaused ? 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'}`}
                          >
                            {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {selectedCampaign.contactList && (
                <div className="text-xs text-muted-foreground">
                  <p>Lista: <span className="font-medium text-foreground">{selectedCampaign.contactList.name}</span></p>
                  <p>Intervalo: <span className="font-medium text-foreground">{selectedCampaign.sendIntervalMin}-{selectedCampaign.sendIntervalMax}s</span></p>
                </div>
              )}
            </div>
            {/* Right panel - Messages & Details */}
            <div className="flex-1 min-w-0 space-y-3 overflow-y-auto max-h-[65vh]">
                {detailMessages.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs font-semibold">Mensagens</Label>
                      <span className="text-[10px] text-muted-foreground">
                        {(() => {
                          const filtered = detailMessages.filter(m => {
                            const matchStatus = detailStatusFilter === 'all' || m.status === detailStatusFilter
                            const q = detailSearchQuery.toLowerCase()
                            const matchSearch = !q || m.contact?.name?.toLowerCase().includes(q) || m.contact?.phone?.includes(q)
                            return matchStatus && matchSearch
                          })
                          return `${filtered.length} de ${detailMessages.length}`
                        })()}
                      </span>
                    </div>
                    {/* Search + Sort + Status Filter Bar */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Buscar por nome ou telefone..."
                            className="pl-8 h-8 text-xs"
                            value={detailSearchQuery}
                            onChange={e => setDetailSearchQuery(e.target.value)}
                          />
                        </div>
                        <Select value={detailSortBy} onValueChange={(v: string) => setDetailSortBy(v as 'name' | 'sendOrder')}>
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="name">Ordem alfabética</SelectItem>
                            <SelectItem value="sendOrder">Ordem de envio</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-1 overflow-x-auto pb-0.5">
                        {[
                          { value: 'all', label: 'Todas' },
                          { value: 'pending', label: 'Pendentes' },
                          { value: 'sent', label: 'Enviadas' },
                          { value: 'delivered', label: 'Entregues' },
                          { value: 'failed', label: 'Falharam' },
                        ].map(tab => {
                          const count = tab.value === 'all' ? detailMessageCounts.total : (detailMessageCounts as any)[tab.value] || 0
                          const isActive = detailStatusFilter === tab.value
                          return (
                            <button
                              key={tab.value}
                              onClick={() => setDetailStatusFilter(tab.value)}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${
                                isActive
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                              }`}
                            >
                              {tab.label} {count > 0 && `(${count})`}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {/* Message List — Tree-style grouped by contact */}
                    <div className="space-y-0.5">
                      {(() => {
                        const filtered = detailMessages.filter(m => {
                          const matchStatus = detailStatusFilter === 'all' || m.status === detailStatusFilter
                          const q = detailSearchQuery.toLowerCase()
                          const matchSearch = !q || m.contact?.name?.toLowerCase().includes(q) || m.contact?.phone?.includes(q)
                          return matchStatus && matchSearch
                        })
                        const sorted = [...filtered].sort((a, b) => {
                          if (detailSortBy === 'name') {
                            const nameA = a.contact?.name || '—'
                            const nameB = b.contact?.name || '—'
                            return nameA.localeCompare(nameB, 'pt-BR')
                          }
                          const statusPriority: Record<string, number> = { sent: 0, delivered: 0, read: 0, pending: 1, failed: 2 }
                          const prioA = statusPriority[a.status] ?? 3
                          const prioB = statusPriority[b.status] ?? 3
                          if (prioA !== prioB) return prioA - prioB
                          const timeA = a.sentAt ? new Date(a.sentAt).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0
                          const timeB = b.sentAt ? new Date(b.sentAt).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0
                          return timeA - timeB
                        })

                        // Group messages by contactId, keeping stepOrder order within each group
                        const contactGroups: Map<string, typeof sorted> = new Map()
                        for (const m of sorted) {
                          const key = m.contactId
                          if (!contactGroups.has(key)) contactGroups.set(key, [])
                          contactGroups.get(key)!.push(m)
                        }
                        // Sort each group by stepOrder
                        for (const msgs of contactGroups.values()) {
                          msgs.sort((a, b) => a.stepOrder - b.stepOrder)
                        }

                        let globalIdx = 0
                        const groups = Array.from(contactGroups.entries())
                        return groups.map(([contactId, messages]) => {
                          const contactName = messages[0]?.contact?.name || messages[0]?.contact?.phone || '—'
                          return [
                          <div key={`header-${contactId}`} className="flex items-center gap-2 pt-2 pb-0.5">
                            <User className="size-3 text-muted-foreground" />
                            <span className="text-[10px] font-semibold text-muted-foreground">{contactName}</span>
                            <span className="text-[9px] text-muted-foreground">({messages.length} msg{messages.length > 1 ? 's' : ''})</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>,
                          ...messages.map((m, stepIdx) => {
                            globalIdx++
                            const isFollowUp = stepIdx > 0
                            const isLastInGroup = stepIdx === messages.length - 1
                            const cardBg = m.status === 'failed' ? 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800' : m.status === 'pending' ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/50'

                            if (isFollowUp) {
                              return (
                                <div key={m.id} className="flex">
                                  {/* Tree connector column — horizontal line points right toward the message card */}
                                  <div className="w-8 shrink-0 flex flex-col">
                                    <div className="w-px flex-1 bg-emerald-300 dark:bg-emerald-700 mx-auto" />
                                    <div className="flex h-px">
                                      <div className="w-1/2" />
                                      <div className="w-1/2 h-px bg-emerald-300 dark:bg-emerald-700" />
                                    </div>
                                    {!isLastInGroup && (
                                      <div className="w-px flex-1 bg-emerald-300 dark:bg-emerald-700 mx-auto" />
                                    )}
                                    {isLastInGroup && <div className="flex-1" />}
                                  </div>
                                  {/* Follow-up card */}
                                  <div className={`flex-1 flex items-center gap-2 p-2 rounded-lg text-xs ${cardBg} ml-0.5`}>
                                    <span className="flex items-center justify-center size-4 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[8px] font-bold shrink-0">{m.stepOrder}</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium truncate text-emerald-700 dark:text-emerald-400">Segunda mensagem</span>
                                        <span className="text-muted-foreground truncate">{m.contact?.phone || ''}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <StatusBadge status={m.status} />
                                        {m.chip?.name && <span className="text-muted-foreground">via {m.chip.name}</span>}
                                      </div>
                                      {m.error && <p className="text-rose-600 mt-0.5 font-medium truncate">Erro: {m.error}</p>}
                                    </div>
                                    <div className="text-right shrink-0 text-[10px]">
                                      {m.sentAt && <p className="text-muted-foreground">{new Date(m.sentAt).toLocaleString('pt-BR')}</p>}
                                      {m.deliveredAt && <p className="text-emerald-600">{new Date(m.deliveredAt).toLocaleString('pt-BR')}</p>}
                                      {m.status === 'failed' && !m.sentAt && m.updatedAt && <p className="text-rose-600">{new Date(m.updatedAt).toLocaleString('pt-BR')}</p>}
                                      {m.status === 'failed' && !m.sentAt && !m.updatedAt && m.createdAt && <p className="text-rose-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</p>}
                                      {m.status === 'pending' && !m.sentAt && <p className="text-amber-600 font-medium">Aguardando</p>}
                                    </div>
                                  </div>
                                </div>
                              )
                            }

                            // First step (stepOrder === 1) — normal card
                            return (
                              <div key={m.id} className={`p-2 rounded-lg text-xs flex items-center gap-2 ${cardBg}`}>
                                <span className="font-mono text-muted-foreground w-4 text-center">{globalIdx}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium truncate">{m.contact?.name || '—'}</span>
                                    <span className="text-muted-foreground truncate">{m.contact?.phone || ''}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="flex items-center gap-1 text-[10px] font-medium">
                                      {m.status === 'delivered' || m.status === 'read' ? <CheckCircle2 className="size-3 text-emerald-500" /> :
                                       m.status === 'sent' ? <Check className="size-3 text-sky-500" /> :
                                       m.status === 'failed' ? <XCircle className="size-3 text-rose-500" /> :
                                       m.status === 'pending' ? <Clock className="size-3 text-amber-500" /> : null}
                                      <StatusBadge status={m.status} />
                                    </span>
                                    {m.chip?.name && <span className="text-muted-foreground">via {m.chip.name}</span>}
                                  </div>
                                  {m.error && <p className="text-rose-600 mt-0.5 font-medium truncate">Erro: {m.error}</p>}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="text-right text-[10px]">
                                    {m.sentAt && <p className="text-muted-foreground">{new Date(m.sentAt).toLocaleString('pt-BR')}</p>}
                                    {m.deliveredAt && <p className="text-emerald-600">{new Date(m.deliveredAt).toLocaleString('pt-BR')}</p>}
                                    {m.status === 'failed' && !m.sentAt && m.updatedAt && <p className="text-rose-600">{new Date(m.updatedAt).toLocaleString('pt-BR')}</p>}
                                    {m.status === 'failed' && !m.sentAt && !m.updatedAt && m.createdAt && <p className="text-rose-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</p>}
                                    {m.status === 'pending' && !m.sentAt && <p className="text-amber-600 font-medium">Aguardando</p>}
                                  </div>
                                  {m.status === 'failed' && (
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-500 hover:text-rose-600" title="Reenviar esta mensagem" onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/messages/${m.id}/resend`, { method: 'POST' })
                                        if (res.ok) {
                                          toast.success('Mensagem reenviada!')
                                          if (selectedCampaign) {
                                            const msgRes = await fetch(`/api/messages?campaignId=${selectedCampaign.id}&limit=5000`, { cache: 'no-store' })
                                            const _r = await msgRes.json()
                                            setDetailMessages(Array.isArray(_r?.data) ? _r.data : Array.isArray(_r) ? _r : [])
                                            fetchCampaigns()
                                          }
                                        } else {
                                          const data = await res.json().catch(() => ({}))
                                          toast.error(data.error || 'Erro ao reenviar')
                                        }
                                      } catch { toast.error('Erro ao reenviar mensagem') }
                                    }}>
                                      <RotateCcw className="size-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          })
                          ]
                        })
                      })()}
                    </div>
                  </div>
                )}
                {/* #19 Timeline de eventos */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Timeline de Eventos</Label>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {(() => {
                      const events: Array<{ time: string; text: string; color: string }> = []
                      for (const m of detailMessages) {
                        if (m.sentAt) {
                          events.push({ time: m.sentAt, text: `${m.contact?.name || m.contact?.phone || '—'} enviada via ${m.chip?.name || '—'}`, color: 'text-sky-600' })
                        }
                        if (m.deliveredAt) {
                          events.push({ time: m.deliveredAt, text: `${m.contact?.name || m.contact?.phone || '—'} entregue`, color: 'text-emerald-600' })
                        }
                        if (m.status === 'failed' && m.updatedAt) {
                          events.push({ time: m.updatedAt, text: `${m.contact?.name || m.contact?.phone || '—'} falhou: ${m.error || 'erro'}`, color: 'text-rose-600' })
                        }
                      }
                      if (selectedCampaign.startedAt) events.push({ time: selectedCampaign.startedAt, text: 'Campanha iniciada', color: 'text-emerald-600' })
                      if (selectedCampaign.completedAt) events.push({ time: selectedCampaign.completedAt, text: 'Campanha concluída', color: 'text-sky-600' })
                      if (selectedCampaign.pausedAt) events.push({ time: selectedCampaign.pausedAt, text: 'Campanha pausada', color: 'text-amber-600' })
                      events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
                      if (events.length === 0) return <p className="text-xs text-muted-foreground">Nenhum evento registrado</p>
                      return events.slice(0, 50).map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded bg-muted/30">
                          <div className={`size-2 rounded-full mt-1 shrink-0 ${e.color.includes('emerald') ? 'bg-emerald-500' : e.color.includes('sky') ? 'bg-sky-500' : e.color.includes('amber') ? 'bg-amber-500' : 'bg-rose-500'}`} />
                          <div className="flex-1 min-w-0">
                            <span className={`font-medium ${e.color}`}>{e.text}</span>
                            <span className="text-muted-foreground ml-2">{new Date(e.time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      ))
                    })()}
                  </div>
                </div>

                {selectedCampaign.sequenceSteps?.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Mensagens & Variações</Label>
                    {selectedCampaign.sequenceSteps.sort((a, b) => a.stepOrder - b.stepOrder).map((step, idx) => {
                      let parsedVars: Array<{content: string; mediaUrl?: string; mediatype?: string}> = []
                      try { parsedVars = JSON.parse(step.variations || '[]') } catch { /* ignore */ }
                      return (
                        <div key={step.id} className="p-2.5 rounded-lg bg-muted/50 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">{step.stepOrder}</span>
                            <p className="flex-1 text-xs whitespace-pre-wrap break-words min-w-0">{step.content}</p>
                            {step.delayMinutes > 0 && <Badge variant="secondary" className="text-[10px] gap-1 shrink-0"><Clock className="size-2.5" />{step.delayMinutes}{step.delayUnit === 'seconds' ? 'seg' : 'min'}</Badge>}
                          </div>
                          {parsedVars.length > 0 && (
                            <div className="ml-8 space-y-0.5">
                              <p className="text-[10px] text-muted-foreground font-medium">Variações ({parsedVars.length}):</p>
                              {parsedVars.map((v, vi) => (
                                <div key={vi} className="flex items-start gap-1.5 text-[11px]">
                                  <Shuffle className="size-3 text-emerald-500 shrink-0 mt-0.5" />
                                  <span className="whitespace-pre-wrap break-words min-w-0">{v.content}</span>
                                  {v.mediatype && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{v.mediatype}</Badge>}
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
            </div>
          )}
        </DialogContent>
      </Dialog>
  )
}
