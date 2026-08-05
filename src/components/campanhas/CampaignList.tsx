'use client'

import React from 'react'
import { motion } from 'framer-motion'
import {
  Send, RefreshCw, Search, Pause, Play, X, Trash2,
  AlertTriangle, Shield, Smartphone, Users, CalendarDays,
  ArrowRight, Eye, Download, Copy, BookmarkPlus, Pencil, Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge, ConfirmDialog } from '@/components/shared'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { type Campaign } from '@/lib/types'

type CampaignFilterValue = 'all' | 'running' | 'paused' | 'completed' | 'cancelled' | 'draft'

export function CampaignList({
  loading, campaigns, setCreateDialogOpen,
  campaignFilter, setCampaignFilter,
  campaignSearch, setCampaignSearch,
  selectedCampaignIds, setSelectedCampaignIds,
  fetchCampaigns, openDetail, exportCampaign, exportingId,
  duplicateCampaign, saveCampaignAsTemplate,
  setSelectedCampaign, startEditing,
  startingCampaignIds, startCampaignAction,
  deleteConfirm, setDeleteConfirm, deleteCampaign,
  cancelConfirm, setCancelConfirm, updateCampaignStatus,
}: {
  loading: boolean
  campaigns: Campaign[]
  setCreateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  campaignFilter: CampaignFilterValue
  setCampaignFilter: React.Dispatch<React.SetStateAction<CampaignFilterValue>>
  campaignSearch: string
  setCampaignSearch: React.Dispatch<React.SetStateAction<string>>
  selectedCampaignIds: Set<string>
  setSelectedCampaignIds: React.Dispatch<React.SetStateAction<Set<string>>>
  fetchCampaigns: () => Promise<void>
  openDetail: (campaign: Campaign) => Promise<void>
  exportCampaign: (id: string, name: string, format?: string) => Promise<void>
  exportingId: string | null
  duplicateCampaign: (c: Campaign) => Promise<void>
  saveCampaignAsTemplate: (c: Campaign) => Promise<void>
  setSelectedCampaign: React.Dispatch<React.SetStateAction<Campaign | null>>
  startEditing: (campaign: Campaign) => void
  startingCampaignIds: Set<string>
  startCampaignAction: (id: string) => Promise<void>
  deleteConfirm: string | null
  setDeleteConfirm: React.Dispatch<React.SetStateAction<string | null>>
  deleteCampaign: (id: string) => Promise<void>
  cancelConfirm: string | null
  setCancelConfirm: React.Dispatch<React.SetStateAction<string | null>>
  updateCampaignStatus: (id: string, status: string) => Promise<void>
}) {
  return (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nenhuma campanha criada"
          description="Crie sua primeira campanha para começar a enviar mensagens em massa via WhatsApp."
          action={{ label: 'Criar primeira campanha', onClick: () => setCreateDialogOpen(true) }}
        />
      ) : (
        <>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {[
              { value: 'all', label: 'Todas' },
              { value: 'running', label: 'Executando' },
              { value: 'paused', label: 'Pausadas' },
              { value: 'completed', label: 'Concluídas' },
              { value: 'cancelled', label: 'Canceladas' },
              { value: 'draft', label: 'Rascunhos' },
            ].map(f => {
              const count = f.value === 'all' ? campaigns.length : campaigns.filter(c => c.status === f.value).length
              return (
                <button key={f.value} onClick={() => setCampaignFilter(f.value as any)}
                  className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    campaignFilter === f.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {f.label} ({count})
                </button>
              )
            })}
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Buscar campanha por nome..." value={campaignSearch} onChange={e => setCampaignSearch(e.target.value)} className="h-9 pl-8 text-sm" />
          </div>
        </div>
        {/* #14 Toolbar de ações em lote */}
        {selectedCampaignIds.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border">
            <span className="text-sm font-medium">{selectedCampaignIds.size} selecionada(s)</span>
            <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
              for (const id of selectedCampaignIds) {
                try { await fetch(`/api/campaigns/${id}/pause`, { method: 'POST' }) } catch {}
              }
              toast.success(`${selectedCampaignIds.size} campanha(s) pausada(s)`)
              setSelectedCampaignIds(new Set())
              fetchCampaigns()
            }}><Pause className="size-3.5" /> Pausar</Button>
            <Button variant="outline" size="sm" className="gap-1 text-amber-600" onClick={async () => {
              for (const id of selectedCampaignIds) {
                try { await fetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }) } catch {}
              }
              toast.success(`${selectedCampaignIds.size} campanha(s) cancelada(s)`)
              setSelectedCampaignIds(new Set())
              fetchCampaigns()
            }}><X className="size-3.5" /> Cancelar</Button>
            <Button variant="outline" size="sm" className="gap-1 text-rose-600" onClick={async () => {
              for (const id of selectedCampaignIds) {
                try { await fetch(`/api/campaigns/${id}`, { method: 'DELETE' }) } catch {}
              }
              toast.success(`${selectedCampaignIds.size} campanha(s) excluída(s)`)
              setSelectedCampaignIds(new Set())
              fetchCampaigns()
            }}><Trash2 className="size-3.5" /> Excluir</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedCampaignIds(new Set())}>Desmarcar</Button>
          </div>
        )}
        <div className="space-y-4">
          {(() => {
            const filtered = campaigns.filter(c => {
              const matchFilter = campaignFilter === 'all' || c.status === campaignFilter
              const matchSearch = !campaignSearch || c.name.toLowerCase().includes(campaignSearch.toLowerCase())
              return matchFilter && matchSearch
            })
            // Agrupar por data (cada dia = um grupo)
            const groups: { label: string; items: typeof filtered }[] = []
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const yesterday = new Date(today.getTime() - 86400000)
            const addToGroup = (label: string, item: typeof filtered[0]) => {
              let g = groups.find(g => g.label === label)
              if (!g) { g = { label, items: [] }; groups.push(g) }
              g.items.push(item)
            }
            for (const c of filtered) {
              const d = new Date(c.createdAt)
              const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
              if (dayStart >= today) {
                addToGroup('Hoje', c)
              } else if (dayStart >= yesterday) {
                addToGroup('Ontem', c)
              } else {
                // Formatar data: "10/07 (sex)"
                const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
                addToGroup(`${dateStr} (${weekday})`, c)
              }
            }
            return groups.map(group => (
              <div key={group.label}>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4 first:mt-0">{group.label} ({group.items.length})</h4>
                <div className="space-y-3">
                {group.items.map((c, i) => (

            <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className={cn('shadow-lg hover:shadow-xl transition-all duration-200 border-l-4',
                c.status === 'running' ? 'border-l-emerald-500' :
                c.status === 'paused' ? 'border-l-amber-500' :
                c.status === 'completed' ? 'border-l-sky-500' :
                c.status === 'cancelled' ? 'border-l-rose-500' :
                'border-l-zinc-300 dark:border-l-zinc-700')}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <input type="checkbox" checked={selectedCampaignIds.has(c.id)} onChange={() => {
                      setSelectedCampaignIds(prev => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }} className="size-4 rounded border-gray-300 shrink-0" />
                    <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
                      <Send className="size-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{c.name}</h3>
                        <StatusBadge status={c.status} />
                        {c.status === 'paused' && c.statusReason && (
                          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-3 shrink-0" />
                            <span className="truncate">{c.statusReason}</span>
                          </div>
                        )}
                        {c.antiBanEnabled && (
                          <Badge variant="outline" className="gap-1 text-xs text-emerald-600 border-emerald-300">
                            <Shield className="size-3" /> Anti-Ban
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Smartphone className="size-3" /> {c.chips?.length || 0} chips</span>
                        {c.chips && c.chips.length > 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground/70">
                            {c.chips.slice(0, 2).map((cc, idx) => (
                              <span key={cc.chipId} className="flex items-center gap-0.5">
                                {idx > 0 && <span>·</span>}
                                <span className="truncate max-w-[80px]">{cc.chip?.name || cc.chip?.phoneNumber}</span>
                              </span>
                            ))}
                            {c.chips.length > 2 && <span>+{c.chips.length - 2}</span>}
                          </span>
                        )}
                        {(() => {
                          const msc = c.messageStatusCounts || {}
                          const total = (msc.pending || 0) + (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0) + (msc.failed || 0)
                          const done = (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0)
                          const failed = msc.failed || 0
                          if (total > 0 && done + failed > 0) {
                            const successRate = Math.round((done / (done + failed)) * 100)
                            return <span className={cn('flex items-center gap-1 font-medium', successRate >= 80 ? 'text-emerald-600' : successRate >= 50 ? 'text-amber-600' : 'text-rose-600')}>{successRate}% sucesso</span>
                          }
                          return null
                        })()}
                        {c.contactList && <span className="flex items-center gap-1"><Users className="size-3" /> {c.contactList.name}</span>}
                        {c.scheduledAt && <span className="flex items-center gap-1"><CalendarDays className="size-3" /> {new Date(c.scheduledAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                        {c.sequenceSteps?.length > 0 && <span className="flex items-center gap-1"><ArrowRight className="size-3" /> {c.sequenceSteps.length} mensagens</span>}
                      </div>
                      {/* Live message progress bar */}
                      {(() => {
                        const msc = c.messageStatusCounts || {}
                        const total = (msc.pending || 0) + (msc.sending || 0) + (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0) + (msc.failed || 0)
                        const done = (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0)
                        const failed = msc.failed || 0
                        const pending = (msc.pending || 0) + (msc.sending || 0)
                        if (total === 0) return null
                        const pct = Math.round((done / total) * 100)
                        const isRunning = c.status === 'running'
                        const barColor = pct === 100 ? 'bg-emerald-500' : failed > 0 ? 'bg-amber-500' : 'bg-sky-500'
                        return (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-2">
                                {done > 0 && <span className="text-emerald-600 font-medium">{done} enviada{done !== 1 ? 's' : ''}</span>}
                                {failed > 0 && <span className="text-rose-500 font-medium">{failed} falha{failed !== 1 ? 's' : ''}</span>}
                                {pending > 0 && <span className="text-muted-foreground">{pending} pendente{pending !== 1 ? 's' : ''}</span>}
                              </span>
                              <span className="flex items-center gap-2">
                                {isRunning && pending > 0 && (() => {
                                  const avgInterval = (c.sendIntervalMin + c.sendIntervalMax) / 2
                                  const chipsCount = c.chips?.length || 1
                                  const totalSecs = (pending * avgInterval) / chipsCount
                                  const hrs = Math.floor(totalSecs / 3600)
                                  const mins = Math.ceil((totalSecs % 3600) / 60)
                                  return <span className="text-amber-600 dark:text-amber-400 font-medium">~{hrs > 0 ? `${hrs}h ` : ''}{mins}min restante</span>
                                })()}
                                <span className="font-semibold text-muted-foreground">{pct}%</span>
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
                              {done > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />}
                              {failed > 0 && <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${(failed / total) * 100}%` }} />}
                              {pending > 0 && <div className="h-full bg-muted-foreground/30 transition-all duration-500" style={{ width: `${(pending / total) * 100}%` }} />}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                    <div className="flex gap-2">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => openDetail(c)}><Eye className="size-4" /></Button>
                      </TooltipTrigger><TooltipContent>Detalhes</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400 border-sky-500/30" onClick={() => exportCampaign(c.id, c.name)} disabled={exportingId === c.id}>
                          {exportingId === c.id ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                        </Button>
                      </TooltipTrigger><TooltipContent>Exportar relatório</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => duplicateCampaign(c)}><Copy className="size-3.5" /> Duplicar</Button>
                      </TooltipTrigger><TooltipContent>Criar cópia desta campanha</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => saveCampaignAsTemplate(c)}><BookmarkPlus className="size-3.5" /> Template</Button>
                      </TooltipTrigger><TooltipContent>Salvar como template</TooltipContent></Tooltip></TooltipProvider>
                      {['draft', 'paused', 'scheduled'].includes(c.status) && <Button variant="outline" size="sm" className="gap-1" onClick={() => { setSelectedCampaign(c); startEditing(c); setCreateDialogOpen(true) }}><Pencil className="size-3.5" /> Editar</Button>}
                      {c.status === 'draft' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={startingCampaignIds.has(c.id)} onClick={() => startCampaignAction(c.id)}>{startingCampaignIds.has(c.id) ? <><Loader2 className="size-3.5 animate-spin" /> Iniciando...</> : <><Play className="size-3.5" /> Iniciar</>}</Button>}
                      {c.status === 'running' && <Button variant="outline" size="sm" className="gap-1 text-amber-600 hover:text-amber-700 border-amber-200" onClick={async () => { try { await fetch(`/api/campaigns/${c.id}/pause`, { method: 'POST' }); toast.success('Campanha pausada!'); fetchCampaigns() } catch { toast.error('Erro ao pausar') } }}><Pause className="size-3.5" /> Pausar</Button>}
                      {c.status === 'paused' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={async () => { try { await fetch(`/api/campaigns/${c.id}/resume`, { method: 'POST' }); toast.success('Campanha retomada!'); fetchCampaigns() } catch { toast.error('Erro ao retomar') } }}><Play className="size-3.5" /> Retomar</Button>}
                      {(c.status === 'running' || c.status === 'paused') && <Button variant="outline" size="sm" className="gap-1 text-rose-600 hover:text-rose-700 border-rose-200" onClick={() => setCancelConfirm(c.id)}><X className="size-3.5" /> Cancelar</Button>}
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className="text-rose-500 hover:text-rose-600" onClick={() => setDeleteConfirm(c.id)}><Trash2 className="size-3.5" /></Button></TooltipTrigger><TooltipContent>Excluir campanha</TooltipContent></Tooltip></TooltipProvider>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
                ))}
                </div>
              </div>
            ))
          })()}
        </div>
        </>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Campanha" description="Tem certeza? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) deleteCampaign(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      <ConfirmDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}
        title="Cancelar Campanha" description="Tem certeza que deseja cancelar esta campanha? As mensagens já enviadas não serão desfeitas, mas o envio será interrompido."
        onConfirm={() => { if (cancelConfirm) updateCampaignStatus(cancelConfirm, 'cancelled'); setCancelConfirm(null) }} confirmLabel="Sim, cancelar" variant="destructive" />
    </>
  )
}
