'use client'

import React from 'react'
import { ArrowRightLeft, AlertTriangle, Smartphone } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { type Campaign, type Chip } from '@/lib/types'

type ChipEffectiveInfo = { effectiveLimit: number; phaseDay: number; phaseMaxDays: number }

export function RedistributeDialog({
  redistributeDialogOpen, setRedistributeDialogOpen,
  selectedCampaign, redistributeDistribution, setRedistributeDistribution,
  distMode, setDistMode, getChipEffectiveInfo, fetchCampaigns, setSelectedCampaign,
}: {
  redistributeDialogOpen: boolean
  setRedistributeDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  selectedCampaign: Campaign | null
  redistributeDistribution: Record<string, number>
  setRedistributeDistribution: React.Dispatch<React.SetStateAction<Record<string, number>>>
  distMode: 'absolute' | 'percentage'
  setDistMode: React.Dispatch<React.SetStateAction<'absolute' | 'percentage'>>
  getChipEffectiveInfo: (chip: Chip) => ChipEffectiveInfo
  fetchCampaigns: () => Promise<void>
  setSelectedCampaign: React.Dispatch<React.SetStateAction<Campaign | null>>
}) {
  return (
    <Dialog open={redistributeDialogOpen} onOpenChange={setRedistributeDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="size-5 text-blue-600" />
            Redistribuir Contatos
          </DialogTitle>
          <DialogDescription>
            Ajuste a distribuição de {selectedCampaign?.messageStatusCounts?.pending || 0} mensagens pendentes entre os chips
          </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Button variant="outline" size="sm" className="w-full gap-2 text-xs" onClick={() => {
              const pending = selectedCampaign?.messageStatusCounts?.pending || 0
              const connectedChips = (selectedCampaign?.chips || []).filter((cc: any) => cc.chip?.status === 'connected' && !cc.chip?.paused)
              if (connectedChips.length === 0) return
              const perChip = Math.floor(pending / connectedChips.length)
              const remainder = pending % connectedChips.length
              const newDist: Record<string, number> = {}
              connectedChips.forEach((cc: any, i: number) => {
                newDist[cc.chipId] = perChip + (i < remainder ? 1 : 0)
              })
              setRedistributeDistribution(newDist)
            }}>
              <ArrowRightLeft className="size-3.5" /> Distribuir igualmente entre chips conectados
            </Button>

            {/* Mode toggle + Distribuição automática */}
            <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-md">
              <button type="button" onClick={() => setDistMode('absolute')} className={`flex-1 text-xs py-1 rounded transition-all ${distMode === 'absolute' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                Número absoluto
              </button>
              <button type="button" onClick={() => setDistMode('percentage')} className={`flex-1 text-xs py-1 rounded transition-all ${distMode === 'percentage' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                Porcentagem %
              </button>
            </div>
            {/* #30 Distribuição automática inteligente */}
            <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => {
              if (!selectedCampaign) return
              const pendingCount = selectedCampaign.messageStatusCounts?.pending || 0
              if (pendingCount === 0) return
              const chips = (selectedCampaign.chips || []).map((cc: any) => {
                const chip = cc.chip
                if (!chip) return null
                const chipInfo = getChipEffectiveInfo(chip)
                const capacity = Math.max(0, chipInfo.effectiveLimit - (chip.sentToday || 0))
                return { chipId: cc.chipId, capacity, name: chip.name }
              }).filter((c: any) => c !== null) as { chipId: string; capacity: number; name: string }[]

              const totalCapacity = chips.reduce((sum, c) => sum + c.capacity, 0)
              if (totalCapacity === 0) {
                toast.error('Nenhum chip tem capacidade disponível')
                return
              }

              const newDist: Record<string, number> = {}
              let allocated = 0
              for (let i = 0; i < chips.length; i++) {
                if (i === chips.length - 1) {
                  newDist[chips[i].chipId] = Math.min(pendingCount - allocated, chips[i].capacity)
                } else {
                  const share = Math.floor(pendingCount * chips[i].capacity / totalCapacity)
                  newDist[chips[i].chipId] = Math.min(share, chips[i].capacity)
                  allocated += newDist[chips[i].chipId]
                }
              }
              setRedistributeDistribution(newDist)
              toast.success('Distribuição automática aplicada (proporcional à capacidade)')
            }}>
              <ArrowRightLeft className="size-3.5" /> Distribuir automaticamente (proporcional à capacidade)
            </Button>

            {/* Chip sliders */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {(selectedCampaign?.chips || []).map((cc: any) => {
                const chip = cc.chip
                if (!chip) return null
                const pendingCount = selectedCampaign?.messageStatusCounts?.pending || 0
                const chipEffectiveInfo = getChipEffectiveInfo(chip)
                const chipCapacity = Math.max(0, chipEffectiveInfo.effectiveLimit - (chip.sentToday || 0))
                const maxForChip = pendingCount > 0 ? Math.min(chipCapacity, pendingCount) : chipCapacity
                // Calculate what other chips have already allocated
                const otherChipsTotal = Object.entries(redistributeDistribution)
                  .filter(([id]) => id !== cc.chipId)
                  .reduce((sum, [, v]) => sum + (v || 0), 0)
                const effectiveMaxForChip = pendingCount > 0 ? Math.min(maxForChip, Math.max(0, pendingCount - otherChipsTotal)) : maxForChip
                const distValue = redistributeDistribution[cc.chipId] || 0
                const distPct = pendingCount > 0 && distValue > 0 ? Math.round(distValue / pendingCount * 100) : 0
                const maxPct = pendingCount > 0 ? Math.round(effectiveMaxForChip / pendingCount * 100) : 100
                const sliderValue = distMode === 'percentage' ? distPct : distValue
                const sliderMax = distMode === 'percentage' ? maxPct : effectiveMaxForChip

                return (
                  <div key={cc.chipId} className="space-y-1.5 p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Smartphone className="size-3.5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{chip.name}</p>
                          <p className="text-[10px] text-muted-foreground">{chip.phoneNumber} · Capacidade: {chipCapacity}/dia{chipEffectiveInfo.effectiveLimit < (chip.dailyLimit || 200) ? ` (de ${chip.dailyLimit || 200})` : ''}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-emerald-600">
                          {distValue > 0
                            ? (distMode === 'percentage'
                                ? `${distPct}%`
                                : `${distValue}`)
                            : 'Auto'}
                        </span>
                        {distValue > 0 && distMode === 'absolute' && pendingCount > 0 && (
                          <p className="text-[10px] text-muted-foreground">{distPct}%</p>
                        )}
                        {distValue > 0 && distMode === 'percentage' && (
                          <p className="text-[10px] text-muted-foreground">{distValue} contatos</p>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={sliderMax}
                      value={sliderValue}
                      onChange={e => {
                        const rawVal = parseInt(e.target.value, 10)
                        const absVal = distMode === 'percentage'
                          ? Math.min(Math.round(rawVal / 100 * pendingCount), effectiveMaxForChip)
                          : Math.min(rawVal, effectiveMaxForChip)
                        setRedistributeDistribution(prev => ({ ...prev, [cc.chipId]: absVal }))
                      }}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Auto (igualitário)</span>
                      <span>{distMode === 'percentage' ? `${maxPct}%` : `${effectiveMaxForChip} contatos`}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            {(() => {
              const pendingCount = selectedCampaign?.messageStatusCounts?.pending || 0
              const manualTotal = Object.values(redistributeDistribution).reduce((sum: number, v: number) => sum + (v || 0), 0)
              const autoChips = (selectedCampaign?.chips || []).filter((cc: any) => !redistributeDistribution[cc.chipId] || redistributeDistribution[cc.chipId] === 0)
              const remaining = pendingCount - manualTotal
              const exceedsTotal = manualTotal > pendingCount
              return (
                <div className="p-2.5 bg-muted/30 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mensagens pendentes:</span>
                    <span className="font-medium">{pendingCount}</span>
                  </div>
                  {(() => {
                    const chips = (selectedCampaign?.chips || []).map((cc: any) => {
                      const chip = cc.chip
                      if (!chip) return null
                      const chipInfo = getChipEffectiveInfo(chip)
                      const capacity = Math.max(0, chipInfo.effectiveLimit - (chip.sentToday || 0))
                      const allocated = redistributeDistribution[cc.chipId] || 0
                      return { name: chip.name, capacity, allocated, exceeded: allocated > capacity }
                    }).filter((c: any) => c !== null) as { name: string; capacity: number; allocated: number; exceeded: boolean }[]
                    const exceededChips = chips.filter(c => c.exceeded)
                    if (exceededChips.length > 0) {
                      return (
                        <p className="text-red-500 font-medium flex items-center gap-1">
                          <AlertTriangle className="size-3" /> Capacidade excedida: {exceededChips.map(c => c.name).join(', ')}
                        </p>
                      )
                    }
                    return null
                  })()}
                  {manualTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Alocados manualmente:</span>
                      <span className={`font-medium ${exceedsTotal ? 'text-red-500' : ''}`}>{manualTotal} ({Math.round(manualTotal / pendingCount * 100)}%)</span>
                    </div>
                  )}
                  {autoChips.length > 0 && remaining > 0 && !exceedsTotal && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Auto ({autoChips.length} chip{autoChips.length > 1 ? 's' : ''}, ~{Math.ceil(remaining / autoChips.length)} cada):</span>
                      <span className="font-medium">{remaining}</span>
                    </div>
                  )}
                  {exceedsTotal && (
                    <p className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Total alocado excede mensagens pendentes!</p>
                  )}
                </div>
              )
            })()}
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              className="bg-blue-600 hover:bg-blue-700 gap-1.5"
              disabled={!!(() => {
                const pendingCount = selectedCampaign?.messageStatusCounts?.pending || 0
                const manualTotal = Object.values(redistributeDistribution).reduce((sum: number, v: number) => sum + (v || 0), 0)
                return manualTotal > pendingCount
              })()}
              onClick={async () => {
                if (!selectedCampaign) return
                try {
                  const res = await fetch(`/api/campaigns/${selectedCampaign.id}/redistribute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chipDistribution: redistributeDistribution }),
                  })
                  const data = await res.json()
                  if (res.ok) {
                    toast.success(data.message || 'Mensagens redistribuídas!')
                    setRedistributeDialogOpen(false)
                    // Refresh campaign data
                    const campRes = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' })
                    if (campRes.ok) setSelectedCampaign(await campRes.json())
                    fetchCampaigns()
                  } else {
                    toast.error(data.error || 'Erro ao redistribuir')
                  }
                } catch { toast.error('Erro ao redistribuir mensagens') }
              }}
            >
              <ArrowRightLeft className="size-3.5" /> Redistribuir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}
