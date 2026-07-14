'use client'

import React from 'react'
import {
  Plus, Type, Users, CalendarDays, Smartphone, Shield, Flame, Snowflake,
  Check, AlertTriangle, Clock, Copy, Paperclip, X, Film, Music,
  File as FileIcon, ImageIcon, MapPin, Link2, Globe, Phone, Video,
  MoreVertical, User, Shuffle, Eye, ArrowRight, Save, RefreshCw,
  Play, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { type Chip, type ContactList, type MessageTemplate } from '@/lib/types'
import { type CampaignFormData, type ContactVariable, type MessageKey, type PreviewContact, CONTACT_VARIABLES } from './shared'
import { MessageBuilder } from './MessageBuilder'
import { SortableTab } from './SortableTab'

type ChipEffectiveInfo = { effectiveLimit: number; phaseDay: number; phaseMaxDays: number }

type UpdateStepField = 'content' | 'delayMinutes' | 'delayUnit' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'audioMode' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName'
type UpdateVariationField = 'content' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName'

export function CreateCampaignDialog({
  createDialogOpen, setCreateDialogOpen, setEditing, setSaving, resetNewCampaign, setActiveStep,
  editing, newCampaign, setNewCampaign,
  availableLists, availableChips, getChipEffectiveInfo,
  distMode, setDistMode, toggleChip,
  contactVariables, previewContact, messageKeys, templates,
  activeStep, dndSensors, handleDragEnd,
  removeStep, duplicateStep, addStep, updateStep,
  addVariation, removeVariation, updateVariation,
  saving, createCampaign,
}: {
  createDialogOpen: boolean
  setCreateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditing: React.Dispatch<React.SetStateAction<boolean>>
  setSaving: React.Dispatch<React.SetStateAction<boolean>>
  resetNewCampaign: () => void
  setActiveStep: React.Dispatch<React.SetStateAction<number>>
  editing: boolean
  newCampaign: CampaignFormData
  setNewCampaign: React.Dispatch<React.SetStateAction<CampaignFormData>>
  availableLists: ContactList[]
  availableChips: Chip[]
  getChipEffectiveInfo: (chip: Chip) => ChipEffectiveInfo
  distMode: 'absolute' | 'percentage'
  setDistMode: React.Dispatch<React.SetStateAction<'absolute' | 'percentage'>>
  toggleChip: (chipId: string) => void
  contactVariables: ContactVariable[]
  previewContact: PreviewContact | null
  messageKeys: MessageKey[]
  templates: MessageTemplate[]
  activeStep: number
  dndSensors: any
  handleDragEnd: (event: DragEndEvent) => void
  removeStep: (idx: number) => void
  duplicateStep: (idx: number) => void
  addStep: () => void
  updateStep: (idx: number, field: UpdateStepField, value: string | number | File | boolean | null) => void
  addVariation: (stepIdx: number) => void
  removeVariation: (stepIdx: number, varIdx: number) => void
  updateVariation: (stepIdx: number, varIdx: number, field: UpdateVariationField, value: string | File | boolean | null) => void
  saving: boolean
  createCampaign: (asDraft?: boolean) => Promise<void>
}) {
  const canCreate = newCampaign.name.trim() && newCampaign.chipIds.length > 0 &&
    newCampaign.steps.some(s =>
      s.content.trim() ||
      s.mediaFile ||
      s.mediaUrl ||
      s.mediatype ||
      s.variations.some(v => v.content.trim() || v.mediaFile || v.mediaUrl || v.mediatype)
    )

  return (
    <Dialog open={createDialogOpen} onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) { setEditing(false); setSaving(false); resetNewCampaign(); setActiveStep(0) } }}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
          <Plus className="size-4" /> Nova Campanha
        </Button>
      </DialogTrigger>
      <DialogContent fullWidth className="h-[90vh]" showCloseButton>
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle>{editing ? 'Editar Campanha' : 'Criar Campanha'}</DialogTitle>
          <DialogDescription>{editing ? 'Modifique os dados da campanha' : 'Configure uma nova campanha de envio'}</DialogDescription>
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
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Smartphone className="size-3" /> Chips para envio</Label>
                  {/* Distribution mode toggle — show when multiple chips selected */}
                  {newCampaign.chipIds.length > 1 && (
                    <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-md">
                      <button type="button" onClick={() => setDistMode('absolute')} className={`flex-1 text-[10px] py-0.5 rounded transition-all ${distMode === 'absolute' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                        Número
                      </button>
                      <button type="button" onClick={() => setDistMode('percentage')} className={`flex-1 text-[10px] py-0.5 rounded transition-all ${distMode === 'percentage' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                        Porcentagem %
                      </button>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                    {/* Disconnected chips warning */}
                    {availableChips.filter(c => c.status !== 'connected').length > 0 && newCampaign.chipIds.some(id => availableChips.find(c => c.id === id && c.status !== 'connected')) && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[10px] text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span>Chips desconectados selecionados não enviarão mensagens!</span>
                      </div>
                    )}
                    {/* Connected chips first, then disconnected */}
                    {[...availableChips.filter(c => c.status === 'connected'), ...availableChips.filter(c => c.status !== 'connected')].map(chip => {
                      const isSelected = newCampaign.chipIds.includes(chip.id)
                      const isDisconnected = chip.status !== 'connected'
                      // Calculate chip capacity: use effective warming limit instead of raw dailyLimit
                      const effectiveInfo = getChipEffectiveInfo(chip)
                      const chipCapacity = Math.max(0, effectiveInfo.effectiveLimit - (chip.sentToday || 0))
                      // Get total contacts in selected list
                      const totalContacts = (() => {
                        const list = availableLists.find((l: any) => l.id === newCampaign.contactListId)
                        return list?._count?.contacts || 0
                      })()
                      // Current distribution value for this chip (absolute number)
                      const distValue = newCampaign.chipDistribution[chip.id] || 0
                      // Max for this chip = min(chipCapacity, totalContacts or chipCapacity)
                      const maxForChip = totalContacts > 0 ? Math.min(chipCapacity, totalContacts) : chipCapacity
                      // Calculate what other chips have already allocated
                      const otherChipsTotal = Object.entries(newCampaign.chipDistribution)
                        .filter(([id]) => id !== chip.id && newCampaign.chipIds.includes(id))
                        .reduce((sum, [, v]) => sum + (v || 0), 0)
                      // Effective max for this chip: can't exceed totalContacts minus what others already have
                      const effectiveMaxForChip = totalContacts > 0 ? Math.min(maxForChip, Math.max(0, totalContacts - otherChipsTotal)) : maxForChip
                      // Percentage representation
                      const distPct = totalContacts > 0 && distValue > 0 ? Math.round(distValue / totalContacts * 100) : 0
                      const maxPct = totalContacts > 0 ? Math.round(effectiveMaxForChip / totalContacts * 100) : 100
                      // Slider value and max depend on mode
                      const sliderValue = distMode === 'percentage' ? distPct : distValue
                      const sliderMax = distMode === 'percentage' ? maxPct : effectiveMaxForChip

                      return (
                        <div key={chip.id}>
                          <div onClick={() => toggleChip(chip.id)} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all text-sm ${isDisconnected ? 'opacity-60' : ''} ${isSelected ? (isDisconnected ? 'border-rose-400/60 bg-rose-50 dark:bg-rose-900/20' : 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-900/20 shadow-sm') : 'hover:bg-muted/50 border-transparent'}`}>
                            <div className={`size-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? (isDisconnected ? 'bg-rose-400 border-rose-400' : 'bg-emerald-500 border-emerald-500') : 'border-muted-foreground/40'}`}>
                              {isSelected && <Check className="size-3.5 text-white" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className={`text-xs font-medium truncate ${isSelected ? (isDisconnected ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300') : ''}`}>{chip.name}</p>
                                {isDisconnected && <span className="text-[9px] px-1 py-0.5 rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 whitespace-nowrap shrink-0">Desconectado</span>}
                              </div>
                              <p className="text-[10px] text-muted-foreground">{chip.phoneNumber} · <span className={`${isDisconnected ? 'text-rose-500' : 'text-emerald-600'} font-medium`}>{chipCapacity}</span> restantes/dia{effectiveInfo.effectiveLimit < (chip.dailyLimit || 200) ? ` (de ${chip.dailyLimit || 200})` : ''}</p>
                            </div>
                            {!isDisconnected && isSelected && chip.warmingPhase && chip.warmingPhase !== 'ready' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 whitespace-nowrap">
                                {chip.warmingPhase === 'nursery' ? 'Berçário' : 'Pré-aquec.'}
                              </span>
                            )}
                          </div>
                          {/* Distribution slider — shown when chip is selected AND there are multiple chips selected */}
                          {isSelected && newCampaign.chipIds.length > 1 && (
                            <div className="ml-7 mt-1 mb-2 px-3 py-2 bg-muted/30 rounded-lg space-y-1.5 border border-muted/50" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground font-medium">Distribuição</span>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    max={distMode === 'percentage' ? maxPct : effectiveMaxForChip}
                                    value={distMode === 'percentage' ? distPct || '' : distValue || ''}
                                    onChange={e => {
                                      const rawVal = parseInt(e.target.value, 10) || 0
                                      // Convert back to absolute number if in percentage mode
                                      // Clamp to effectiveMaxForChip to prevent exceeding total contacts
                                      const absVal = distMode === 'percentage'
                                        ? Math.min(Math.round(rawVal / 100 * totalContacts), effectiveMaxForChip)
                                        : Math.min(rawVal, effectiveMaxForChip)
                                      setNewCampaign(prev => ({
                                        ...prev,
                                        chipDistribution: { ...prev.chipDistribution, [chip.id]: absVal },
                                      }))
                                    }}
                                    className="w-14 h-5 text-[10px] text-center bg-background border border-muted rounded px-1 focus:border-emerald-500 focus:outline-none"
                                    placeholder="0"
                                  />
                                  <span className="text-[10px] text-muted-foreground">{distMode === 'percentage' ? '%' : 'contatos'}</span>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={sliderMax}
                                value={sliderValue}
                                onChange={e => {
                                  const rawVal = parseInt(e.target.value, 10)
                                  // Convert back to absolute number if in percentage mode
                                  // Clamp to effectiveMaxForChip to prevent exceeding total contacts
                                  const absVal = distMode === 'percentage'
                                    ? Math.min(Math.round(rawVal / 100 * totalContacts), effectiveMaxForChip)
                                    : Math.min(rawVal, effectiveMaxForChip)
                                  setNewCampaign(prev => ({
                                    ...prev,
                                    chipDistribution: { ...prev.chipDistribution, [chip.id]: absVal },
                                  }))
                                }}
                                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-500"
                              />
                              <div className="flex justify-between text-[9px] text-muted-foreground">
                                <span>Auto (igualitário)</span>
                                <span>Máx: {distMode === 'percentage' ? `${maxPct}%` : effectiveMaxForChip}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Distribution summary */}
                  {newCampaign.chipIds.length > 1 && (() => {
                    const totalContacts = (() => {
                      const list = availableLists.find((l: any) => l.id === newCampaign.contactListId)
                      return list?._count?.contacts || 0
                    })()
                    const manualTotal = Object.values(newCampaign.chipDistribution).reduce((sum: number, v: any) => sum + (v || 0), 0)
                    const autoChips = newCampaign.chipIds.filter(id => !newCampaign.chipDistribution[id] || newCampaign.chipDistribution[id] === 0)
                    const remaining = totalContacts - manualTotal
                    const exceedsTotal = totalContacts > 0 && manualTotal > totalContacts
                    // Also check if any chip's distribution exceeds its effective capacity (warming-aware)
                    const exceedsCapacity = newCampaign.chipIds.some(chipId => {
                      const chip = availableChips.find((c: any) => c.id === chipId)
                      if (!chip) return false
                      const effectiveInfo = getChipEffectiveInfo(chip)
                      const chipCap = Math.max(0, effectiveInfo.effectiveLimit - (chip.sentToday || 0))
                      const dist = newCampaign.chipDistribution[chipId] || 0
                      return dist > chipCap
                    })
                    // Check if any selected chip is disconnected
                    const hasDisconnectedChip = newCampaign.chipIds.some(chipId => {
                      const chip = availableChips.find((c: any) => c.id === chipId)
                      return chip && chip.status !== 'connected'
                    })
                    return (
                      <div className={`p-2 rounded-lg text-[10px] space-y-1 border ${exceedsTotal || exceedsCapacity ? 'bg-red-500/10 border-red-500/30' : 'bg-muted/30 border-muted/50'}`}>
                        {totalContacts > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Total de contatos:</span>
                            <span className="font-medium text-foreground">{totalContacts}</span>
                          </div>
                        )}
                        {manualTotal > 0 && totalContacts > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Alocados manualmente:</span>
                            <span className={`font-medium ${exceedsTotal ? 'text-red-500' : 'text-emerald-600'}`}>{manualTotal} ({Math.round(manualTotal / totalContacts * 100)}%)</span>
                          </div>
                        )}
                        {manualTotal > 0 && totalContacts === 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Alocados manualmente:</span>
                            <span className="font-medium text-emerald-600">{manualTotal}</span>
                          </div>
                        )}
                        {autoChips.length > 0 && remaining > 0 && totalContacts > 0 && !exceedsTotal && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Auto ({autoChips.length} chip{autoChips.length > 1 ? 's' : ''}, ~{Math.ceil(remaining / autoChips.length)} cada):</span>
                            <span className="font-medium text-foreground">{remaining}</span>
                          </div>
                        )}
                        {exceedsTotal && (
                          <p className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Total alocado excede contatos!</p>
                        )}
                        {exceedsCapacity && (
                          <p className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Um ou mais chips excedem a capacidade real (limite de aquecimento)!</p>
                        )}
                        {hasDisconnectedChip && !exceedsTotal && !exceedsCapacity && (
                          <p className="text-amber-600 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Chips desconectados não enviarão mensagens</p>
                        )}
                      </div>
                    )
                  })()}
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
                  {/* Message Tabs with Drag & Drop */}
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={handleDragEnd}>
                    <SortableContext items={newCampaign.steps.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
                      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b shrink-0 bg-muted/20 overflow-x-auto">
                        {newCampaign.steps.map((step, idx) => {
                          const delayLabel = idx > 0 && step.delayMinutes > 0
                            ? `+${step.delayMinutes}${step.delayUnit === 'seconds' ? 'seg' : 'min'}`
                            : undefined
                          return (
                            <SortableTab
                              key={idx}
                              id={String(idx)}
                              idx={idx}
                              isActive={activeStep === idx}
                              canClose={newCampaign.steps.length > 1}
                              onClick={() => setActiveStep(idx)}
                              onClose={() => { removeStep(idx); setActiveStep(Math.max(0, idx > 0 ? idx - 1 : 0)) }}
                              isFollowUp={idx > 0}
                              delayLabel={delayLabel}
                              
                            />
                          )
                        })}
                        <div className="flex items-center gap-1 shrink-0">
                          {newCampaign.steps.length > 1 && (
                            <TooltipProvider><Tooltip><TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="gap-1 text-sky-600 h-7 px-2" onClick={() => duplicateStep(activeStep)}>
                                <Copy className="size-3.5" />
                                <span className="text-xs">Duplicar</span>
                              </Button>
                            </TooltipTrigger><TooltipContent>Duplicar mensagem atual</TooltipContent></Tooltip></TooltipProvider>
                          )}
                          <Button variant="ghost" size="sm" className="gap-1 text-emerald-600 h-7 px-2" onClick={addStep}>
                            <Plus className="size-3.5" />
                            <span className="text-xs">Adicionar mensagem</span>
                          </Button>
                        </div>
                      </div>
                    </SortableContext>
                  </DndContext>

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
                            <Select value={step.delayUnit} onValueChange={v => updateStep(idx, 'delayUnit', v)}>
                              <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="minutes">Minutos</SelectItem>
                                <SelectItem value="seconds">Segundos</SelectItem>
                              </SelectContent>
                            </Select>
                            <span>{step.delayUnit === 'minutes' ? 'min' : 'seg'} após mensagem anterior</span>
                          </div>
                        )}

                        <MessageBuilder value={step.content} onChange={v => updateStep(idx, 'content', v)} messageKeys={messageKeys} templates={templates} contactVariables={contactVariables} previewContactData={previewContact} rows={14} />

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
                          {step.mediatype === 'audio' && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Modo do Áudio</Label>
                              <div className="flex gap-2">
                                <button type="button" className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-all ${step.audioMode === 'whatsapp' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'border-border hover:bg-muted/50'}`} onClick={() => updateStep(idx, 'audioMode', 'whatsapp')}>
                                  <span className="font-medium">WhatsApp</span>
                                  <span className="block text-[10px] text-muted-foreground">Converte para OGG (nativo)</span>
                                </button>
                                <button type="button" className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-all ${step.audioMode === 'original' ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400' : 'border-border hover:bg-muted/50'}`} onClick={() => updateStep(idx, 'audioMode', 'original')}>
                                  <span className="font-medium">Personalizado</span>
                                  <span className="block text-[10px] text-muted-foreground">Mantém formato original</span>
                                </button>
                              </div>
                            </div>
                          )}
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
                          {step.mediaFile ? (
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg text-xs">
                              {step.mediatype === 'image' ? (
                                <img src={URL.createObjectURL(step.mediaFile)} alt="Preview" className="size-12 rounded object-cover border shrink-0" />
                              ) : step.mediatype === 'video' ? <Film className="size-3.5 text-sky-500" /> : step.mediatype === 'audio' ? <Music className="size-3.5 text-amber-500" /> : <FileIcon className="size-3.5 text-zinc-500" />}
                              <span className="truncate">{step.mediaFile.name}</span>
                              <span className="text-muted-foreground">({(step.mediaFile.size / 1024).toFixed(1)}KB)</span>
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => updateStep(idx, 'mediaFile', null)}><X className="size-3" /></Button>
                            </div>
                          ) : step.mediaUrl ? (
                            <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                              {step.mediatype === 'image' ? (
                                <img src={step.mediaUrl} alt="Preview" className="size-12 rounded object-cover border shrink-0" />
                              ) : step.mediatype === 'video' ? <Film className="size-3.5 text-sky-500" /> : step.mediatype === 'audio' ? <Music className="size-3.5 text-amber-500" /> : <FileIcon className="size-3.5 text-zinc-500" />}
                              <span className="truncate text-emerald-600 dark:text-emerald-400">Mídia salva</span>
                              <a href={step.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground underline truncate max-w-[120px]">abrir</a>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto text-red-500 hover:text-red-400" onClick={() => { updateStep(idx, 'mediaUrl', ''); updateStep(idx, 'mediatype', ''); }}><X className="size-3" /></Button></TooltipTrigger><TooltipContent>Remover mídia</TooltipContent></Tooltip></TooltipProvider>
                            </div>
                          ) : null}
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
                                  {v.mediaFile ? (
                                    <div className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg text-xs">
                                      {v.mediatype === 'image' ? (
                                        <img src={URL.createObjectURL(v.mediaFile)} alt="Preview" className="size-10 rounded object-cover border shrink-0" />
                                      ) : v.mediatype === 'video' ? <Film className="size-3 text-sky-500" /> : v.mediatype === 'audio' ? <Music className="size-3 text-amber-500" /> : <FileIcon className="size-3 text-zinc-500" />}
                                      <span className="truncate">{v.mediaFile.name}</span>
                                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 ml-auto" onClick={() => updateVariation(idx, vIdx, 'mediaFile', null)}><X className="size-2.5" /></Button>
                                    </div>
                                  ) : v.mediaUrl ? (
                                    <div className="flex items-center gap-2 p-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                                      {v.mediatype === 'image' ? (
                                        <img src={v.mediaUrl} alt="Preview" className="size-10 rounded object-cover border shrink-0" />
                                      ) : v.mediatype === 'video' ? <Film className="size-3 text-sky-500" /> : v.mediatype === 'audio' ? <Music className="size-3 text-amber-500" /> : <FileIcon className="size-3 text-zinc-500" />}
                                      <span className="truncate text-emerald-600 dark:text-emerald-400">Mídia salva</span>
                                      <a href={v.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground underline truncate max-w-[80px]">abrir</a>
                                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-4 w-4 p-0 ml-auto text-red-500 hover:text-red-400" onClick={() => { updateVariation(idx, vIdx, 'mediaUrl', ''); updateVariation(idx, vIdx, 'mediatype', ''); }}><X className="size-2.5" /></Button></TooltipTrigger><TooltipContent>Remover mídia</TooltipContent></Tooltip></TooltipProvider>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WhatsApp Preview Panel - 6.7" phone simulation */}
                <div className="w-[380px] shrink-0 flex flex-col bg-muted/10 overflow-hidden">
                  <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Eye className="size-3" /> Pré-visualização</p>
                    <span className="text-[10px] text-muted-foreground">6.7"</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-start p-3 overflow-y-auto min-h-0">
                    {/* Phone frame - 6.7" aspect ratio (~19.5:9) */}
                    <div className="w-full max-w-[340px] rounded-2xl border-4 border-zinc-800 dark:border-zinc-600 shadow-2xl bg-[#0b141a] flex flex-col" style={{ height: '90%', maxHeight: 'calc(90vh - 140px)' }}>
                      {/* WhatsApp status bar */}
                      <div className="flex items-center justify-between px-3 py-1 bg-[#1f2c34] text-white/60 text-[9px]">
                        <span>{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="flex items-center gap-1">
                          <span>5G</span>
                          <span>🔋</span>
                        </div>
                      </div>
                      {/* Chat header */}
                      <div className="flex items-center gap-2.5 px-3 py-2 bg-[#1f2c34]">
                        <div className="size-9 rounded-full bg-emerald-600/60 flex items-center justify-center text-white text-xs font-bold">C</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-white">Cliente</p>
                          <p className="text-[10px] text-emerald-200/60">online</p>
                        </div>
                        <div className="flex items-center gap-3 text-white/50">
                          <Video className="size-4" />
                          <Phone className="size-4" />
                          <MoreVertical className="size-4" />
                        </div>
                      </div>
                      {/* Chat body - scrollable */}
                      <div className="flex-1 bg-[#0b141a] p-3 space-y-2 overflow-y-auto min-h-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}>
                        {newCampaign.steps.map((step, idx) => {
                          // Resolve variables using real contact data from the linked list
                          const resolveVars = (text: string) => {
                            const replaceData: Record<string, string> = {}
                            if (previewContact?.customFields) {
                              try {
                                const customData = JSON.parse(previewContact.customFields)
                                for (const [key, value] of Object.entries(customData)) {
                                  replaceData[key.toLowerCase()] = String(value)
                                }
                              } catch { /* ignore */ }
                            }
                            if (!replaceData['nome'] && previewContact) replaceData['nome'] = previewContact.name
                            if (!replaceData['telefone'] && previewContact) replaceData['telefone'] = previewContact.phone
                            return text
                              .replace(/\{\{KEY:\s*([^}]+)\}\}/g, (_: string, vars: string) => {
                                const options = vars.split('|').map((s: string) => s.trim())
                                return options[0] || 'variação'
                              })
                              .replace(/\{\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}\}/g, (match: string, varName: string) => {
                                const key = varName.toLowerCase()
                                return replaceData[key] || match
                              })
                          }
                          const previewContent = resolveVars(step.content)
                          // Convert WhatsApp formatting to HTML for preview
                          const formatWhatsApp = (text: string) => {
                            return text
                              .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
                              .replace(/_([^_]+)_/g, '<em>$1</em>')
                              .replace(/~([^~]+)~/g, '<s>$1</s>')
                          }
                          if (!step.content && !step.mediaFile && !step.mediatype && !step.mediaUrl) return null
                          return (
                            <div key={idx} className="flex justify-end">
                              <div className="bg-[#005c4b] rounded-lg rounded-tr-none max-w-[280px] shadow-sm overflow-hidden">
                                {idx > 0 && step.delayMinutes > 0 && (
                                  <div className="text-[9px] text-white/40 px-2.5 pt-2 flex items-center gap-0.5">
                                    <Clock className="size-2" /> +{step.delayMinutes}{step.delayUnit === 'seconds' ? 'seg' : 'min'}
                                  </div>
                                )}
                                {/* Media attachment preview */}
                                {step.mediatype === 'image' && (step.mediaFile ? (
                                  <div className="relative">
                                    <img src={URL.createObjectURL(step.mediaFile)} alt="Preview" className="w-full max-h-[200px] object-cover" />
                                    {step.caption && <p className="text-[12px] text-white/90 px-2.5 pt-1.5 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: formatWhatsApp(resolveVars(step.caption)) }} />}
                                  </div>
                                ) : step.mediaUrl ? (
                                  <div className="relative">
                                    <img src={step.mediaUrl} alt="Preview" className="w-full max-h-[200px] object-cover" />
                                    {step.caption && <p className="text-[12px] text-white/90 px-2.5 pt-1.5 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: formatWhatsApp(resolveVars(step.caption)) }} />}
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center bg-[#1a3a2a] h-[140px] w-full">
                                    <div className="text-center">
                                      <ImageIcon className="size-8 text-white/30 mx-auto mb-1" />
                                      <p className="text-[10px] text-white/40">Imagem</p>
                                    </div>
                                  </div>
                                ))}
                                {step.mediatype === 'video' && (
                                  <div className="flex items-center justify-center bg-[#1a3a2a] h-[140px] w-full">
                                    <div className="text-center">
                                      <Film className="size-8 text-white/30 mx-auto mb-1" />
                                      <p className="text-[10px] text-white/40">Vídeo</p>
                                      <div className="size-10 rounded-full bg-white/20 flex items-center justify-center mx-auto mt-1">
                                        <div className="size-0 border-t-[6px] border-b-[6px] border-l-[10px] border-transparent border-l-white/70 ml-1" />
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'audio' && (
                                  <div className="flex items-center gap-2 px-3 py-3">
                                    <div className="size-8 rounded-full bg-white/10 flex items-center justify-center">
                                      <Play className="size-4 text-white/70 ml-0.5" />
                                    </div>
                                    <div className="flex-1 flex items-center gap-0.5">
                                      {Array.from({ length: 30 }).map((_, i) => (
                                        <div key={i} className="w-[2px] bg-white/40 rounded-full" style={{ height: `${Math.random() * 16 + 4}px` }} />
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'document' && (
                                  <div className="flex items-center gap-2.5 px-3 py-3 bg-[#1a3a2a]">
                                    <div className="size-10 rounded bg-blue-500/20 flex items-center justify-center">
                                      <FileIcon className="size-5 text-blue-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] text-white/80 truncate">{step.mediaFile?.name || 'Documento.pdf'}</p>
                                      <p className="text-[9px] text-white/40">{step.mediaFile ? `${(step.mediaFile.size / 1024).toFixed(0)} KB` : 'PDF'}</p>
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'contact' && (
                                  <div className="flex items-center gap-2.5 px-3 py-3 bg-[#1a3a2a]">
                                    <div className="size-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                      <User className="size-5 text-emerald-400" />
                                    </div>
                                    <div>
                                      <p className="text-[11px] text-white/80">{step.contactName || 'Nome do contato'}</p>
                                      <p className="text-[9px] text-white/40">{step.contactPhone || 'Telefone'}</p>
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'location' && (
                                  <div className="bg-[#1a3a2a] p-2">
                                    <div className="h-[100px] rounded bg-emerald-900/30 flex items-center justify-center">
                                      <MapPin className="size-6 text-emerald-400/60" />
                                    </div>
                                    {step.locationName && <p className="text-[11px] text-white/70 mt-1.5 px-1">{step.locationName}</p>}
                                  </div>
                                )}
                                {step.mediatype === 'link' && step.linkPreview && (
                                  <div className="bg-[#1a3a2a] overflow-hidden">
                                    <div className="h-[80px] bg-gradient-to-br from-sky-900/40 to-blue-900/40 flex items-center justify-center">
                                      <Globe className="size-6 text-sky-400/60" />
                                    </div>
                                    <div className="px-2.5 py-1.5">
                                      <p className="text-[9px] text-white/40 truncate">{step.linkUrl || 'https://...'}</p>
                                      <p className="text-[10px] text-white/60">Preview do link</p>
                                    </div>
                                  </div>
                                )}
                                {/* Text content */}
                                {previewContent && (
                                  <p className="text-[13px] text-white/90 whitespace-pre-wrap break-words leading-[1.5] px-2.5 py-1" dangerouslySetInnerHTML={{ __html: formatWhatsApp(previewContent) }} />
                                )}
                                {/* Timestamp */}
                                <div className="flex items-center justify-end gap-0.5 px-2.5 pb-1.5">
                                  <span className="text-[9px] text-white/40">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <svg className="size-3.5 text-blue-400" viewBox="0 0 16 16" fill="currentColor"><path d="M12.354 4.354a.5.5 0 00-.708-.708L5.5 9.793 3.354 7.646a.5.5 0 10-.708.708l2.5 2.5a.5.5 0 00.708 0l6.5-6.5z"/><path d="M15 8A7 7 0 111 8a7 7 0 0114 0zm-1 0A6 6 0 102 8a6 6 0 0012 0z"/></svg>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        {newCampaign.steps.every(s => !s.content && !s.mediaFile && !s.mediatype && !s.mediaUrl) && (
                          <div className="flex items-center justify-center h-[320px]">
                            <p className="text-xs text-white/30 text-center">Comece a digitar sua mensagem<br/>para ver a pré-visualização</p>
                          </div>
                        )}
                      </div>
                      {/* Input bar - simulated label */}
                      <div className="shrink-0 flex items-center justify-center px-3 py-1.5 bg-[#1f2c34]">
                        <span className="text-[9px] text-white/25 italic">Visualização de mensagem simulada</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="px-6 py-3 border-t shrink-0 flex-col items-stretch sm:flex-row sm:items-center">
              {!canCreate && !saving && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1 sm:mb-0 sm:mr-auto">
                  <AlertCircle className="size-3" />
                  {!newCampaign.name.trim() ? 'Informe o nome da campanha' : newCampaign.chipIds.length === 0 ? 'Selecione pelo menos 1 chip para envio' : 'Preencha pelo menos 1 mensagem (texto ou mídia)'}
                </p>
              )}
              {canCreate && !saving && !editing && (
                <div className="flex items-center gap-3 mb-1 sm:mb-0 sm:mr-auto text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Smartphone className="size-3" /> {newCampaign.chipIds.length} chip{newCampaign.chipIds.length !== 1 ? 's' : ''}</span>
                  <span className="flex items-center gap-1"><ArrowRight className="size-3" /> {newCampaign.steps.length} mensagem{newCampaign.steps.length !== 1 ? 'ns' : ''}</span>
                  <span className="flex items-center gap-1"><Clock className="size-3" /> {newCampaign.sendIntervalMin}-{newCampaign.sendIntervalMax}s entre envios</span>
                </div>
              )}
              <div className="flex gap-2 sm:ml-auto">
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                {!editing && (
                  <Button variant="outline" onClick={() => createCampaign(true)} disabled={!newCampaign.name.trim() || saving} className="gap-1">
                    {saving ? <><RefreshCw className="size-4 animate-spin" /> Salvando...</> : <><Save className="size-4" /> Salvar Rascunho</>}
                  </Button>
                )}
                <Button onClick={() => createCampaign(false)} disabled={!canCreate || saving} className="bg-emerald-600 hover:bg-emerald-700">
                  {saving ? <><RefreshCw className="size-4 animate-spin" /> Salvando...</> : editing ? 'Salvar Alterações' : 'Criar Campanha'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
  )
}
