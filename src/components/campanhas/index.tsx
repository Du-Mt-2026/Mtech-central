'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  RefreshCw, Zap, FileSpreadsheet, ChevronDown, Play, CheckCircle, Pause, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { type Chip, type Campaign, type ContactList, type MessageItem, type MessageTemplate, type SequenceStep, type StepForm } from '@/lib/types'
import { logAction } from '@/lib/audit-log'
import { useIsVisible } from '@/hooks/use-is-visible'
import { type AntiBanSettings } from '@/lib/constants'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import {
  uploadMediaFile, calcChipEffectiveInfo, convertAudioToOgg,
  type CampaignFormData, type ContactVariable, type MessageKey, type PreviewContact,
} from './shared'
import { CreateCampaignDialog } from './CreateCampaignDialog'
import { CampaignList } from './CampaignList'
import { CampaignDetailDialog } from './CampaignDetailDialog'
import { RedistributeDialog } from './RedistributeDialog'

// Re-export the utility functions so existing imports
// (`import { convertAudioToOgg, calcChipEffectiveInfo, uploadMediaFile } from '@/components/campanhas'`)
// keep working after the split.
export { uploadMediaFile, calcChipEffectiveInfo, convertAudioToOgg }

export function CampanhasTab() {
  const isVisible = useIsVisible()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([])

  // PERF FIX: Memoize status counts to avoid 4+ .filter() calls on every render.
  // Previously, each of the 4 status cards called detailMessages.filter() separately,
  // plus 2 more in the tab buttons. Now computed once per detailMessages change.
  const detailMessageCounts = useMemo(() => {
    let pending = 0, sent = 0, delivered = 0, failed = 0, sending = 0
    for (const m of detailMessages) {
      switch (m.status) {
        case 'pending': pending++; break
        case 'sent': sent++; break
        case 'delivered':
        case 'read': delivered++; break
        case 'failed': failed++; break
        case 'sending': sending++; break
      }
    }
    return { pending, sent, delivered, failed, sending, total: detailMessages.length }
  }, [detailMessages])
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [availableLists, setAvailableLists] = useState<ContactList[]>([])
  const [messageKeys, setMessageKeys] = useState<Array<{ id: string; name: string; label: string; category: string; variations: string; resolutionType?: string; timeSlots?: string | null }>>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [contactVariables, setContactVariables] = useState<Array<{ tag: string; label: string; source: string }>>([])
  const [previewContact, setPreviewContact] = useState<{ name: string; phone: string; customFields?: string } | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [continuousProcessing, setContinuousProcessing] = useState(false)
  const [continuousStats, setContinuousStats] = useState({ processed: 0, remaining: 0, elapsed: 0 })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [distMode, setDistMode] = useState<'absolute' | 'percentage'>('absolute')
  const [redistributeDialogOpen, setRedistributeDialogOpen] = useState(false)
  const [redistributeDistribution, setRedistributeDistribution] = useState<Record<string, number>>({})
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportingAll, setExportingAll] = useState(false)
  const [refreshingDetail, setRefreshingDetail] = useState(false)
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set())
  const [batchAction, setBatchAction] = useState<'pause' | 'cancel' | 'delete' | null>(null)
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'running' | 'paused' | 'completed' | 'cancelled' | 'draft'>('all')
  const [campaignSearch, setCampaignSearch] = useState('')
  // BUGFIX: Default é 'sendOrder' (ordem de envio) em vez de 'name' (alfabética).
  // Persiste a escolha do usuário em localStorage para não re-selecionar toda vez.
  const [detailSortBy, setDetailSortBy] = useState<'name' | 'sendOrder'>(() => {
    if (typeof window === 'undefined') return 'sendOrder'
    const saved = window.localStorage.getItem('campaignDetail_sortBy')
    return saved === 'name' ? 'name' : 'sendOrder'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('campaignDetail_sortBy', detailSortBy)
    }
  }, [detailSortBy])
  const [detailSearchQuery, setDetailSearchQuery] = useState('')
  const [detailStatusFilter, setDetailStatusFilter] = useState('all')
  const [antiBanSettings, setAntiBanSettings] = useState<AntiBanSettings | null>(null)
  const [editForm, setEditForm] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
    chipDistribution: {} as Record<string, number>, // chipId → contactLimit (0 = auto)
  })

  const [newCampaign, setNewCampaign] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
    chipDistribution: {} as Record<string, number>, // chipId → contactLimit (0 = auto)
  })

  const resetNewCampaign = () => setNewCampaign({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
    chipDistribution: {} as Record<string, number>,
  })

  const prevStatusRef = useRef<Record<string, string>>({})
  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' })
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : [])
    }
    catch { toast.error('Erro ao carregar campanhas') } finally { setLoading(false) }
  }, [])
  const fetchChips = useCallback(async () => {
    try { const res = await fetch('/api/chips'); setAvailableChips(await res.json()) } catch { /* empty */ }
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
      // Atualiza o estado local dos availableChips
      setAvailableChips(prev => prev.map(c => c.id === chipId ? { ...c, paused: data.chip?.paused ?? !currentlyPaused, pausedAt: data.chip?.pausedAt ?? null, pauseReason: data.chip?.pauseReason ?? null } : c))
      // Atualiza também o chip dentro da campanha selecionada (se for o caso)
      setSelectedCampaign(prev => {
        if (!prev || !prev.chips) return prev
        return {
          ...prev,
          chips: prev.chips.map((cc: any) => cc.chip?.id === chipId ? { ...cc, chip: { ...cc.chip, paused: data.chip?.paused ?? !currentlyPaused, pausedAt: data.chip?.pausedAt ?? null, pauseReason: data.chip?.pauseReason ?? null } } : cc)
        }
      })
      toast.success(data.message || `Chip ${chipName} ${currentlyPaused ? 'retomado' : 'pausado'}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao alterar pausa do chip'
      toast.error(msg)
    }
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
  const fetchAntiBanSettings = useCallback(async () => {
    try { const res = await fetch('/api/antiban'); if (res.ok) setAntiBanSettings(await res.json()) } catch { /* empty */ }
  }, [])

  // Wrapper for calcChipEffectiveInfo using local antiBanSettings
  const getChipEffectiveInfo = useCallback((chip: Chip) => calcChipEffectiveInfo(chip, antiBanSettings), [antiBanSettings])

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
      // Also store first contact data for realistic preview
      if (data.firstContact) {
        setPreviewContact(data.firstContact)
        // #16: Fetch more contacts for preview selector
        try {
          const contactsRes = await fetch(`/api/contact-lists/${data.firstContact.contactListId || ''}/contacts?page=1&limit=10`)
          const contactsData = await contactsRes.json()
          const contacts = Array.isArray(contactsData) ? contactsData : (contactsData.contacts || contactsData.data || [])
          if (contacts.length > 0) {
            setPreviewContact(contacts[0])
          }
        } catch {}
      } else {
        setPreviewContact(null)
      }
    } catch {
      setContactVariables([])
      setPreviewContact(null)
    }
  }, [])

  useEffect(() => { fetchCampaigns(); fetchChips(); fetchLists(); fetchKeys(); fetchTemplates(); fetchAntiBanSettings() }, [fetchCampaigns, fetchChips, fetchLists, fetchKeys, fetchTemplates, fetchAntiBanSettings])

  // Auto-refresh campaigns every 10 seconds when any campaign is running (for live progress)
  // PERF FIX: was 5s, now 10s. Detail dialog polling handles real-time updates.
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === 'running')
    if (!hasRunning) return
    const interval = setInterval(fetchCampaigns, isVisible ? 20000 : 120000)
    return () => clearInterval(interval)
  }, [campaigns, fetchCampaigns])

  // Auto-refresh campaign detail dialog every 3 seconds when open and campaign is active
  // Uses refs to avoid re-creating interval on every data update
  const detailPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const detailCampaignIdRef = useRef<string | null>(null)
  const detailHasActiveMessagesRef = useRef(false)

  useEffect(() => {
    // Clear previous polling
    if (detailPollingRef.current) {
      clearInterval(detailPollingRef.current)
      detailPollingRef.current = null
    }

    if (!detailDialogOpen || !selectedCampaign) return

    // Track the campaign ID for polling
    detailCampaignIdRef.current = selectedCampaign.id

    // Check if campaign is in an active state
    const isActive = ['running', 'scheduled'].includes(selectedCampaign.status) ||
      detailMessages.some(m => m.status === 'pending' || m.status === 'sending')
    detailHasActiveMessagesRef.current = detailMessages.some(m => m.status === 'pending' || m.status === 'sending')

    if (!isActive) return

    // PERF FIX: was 3s, now 5s. Also removed redundant fetchCampaigns() call
    // (the 10s campaign list polling already keeps cards in sync).
    // Reduced message limit from 5000 to 500 — most users only see recent messages.
    detailPollingRef.current = setInterval(async () => {
      const campaignId = detailCampaignIdRef.current
      if (!campaignId) return
      try {
        // Refresh campaign data
        const res = await fetch(`/api/campaigns/${campaignId}`, { cache: 'no-store' })
        if (!res.ok) return
        const updated = await res.json()
        setSelectedCampaign(updated)
        // Refresh messages (limit 500 — enough for real-time view)
        const msgRes = await fetch(`/api/messages?campaignId=${campaignId}&limit=500`, { cache: 'no-store' })
        const msgData = await msgRes.json()
        const messages = Array.isArray(msgData?.data) ? msgData.data : Array.isArray(msgData) ? msgData : []
        setDetailMessages(messages)
        // Stop polling if campaign is no longer active and no messages are pending/sending
        const stillActive = ['running', 'scheduled'].includes(updated.status) ||
          messages.some((m: MessageItem) => m.status === 'pending' || m.status === 'sending')
        if (!stillActive && detailPollingRef.current) {
          clearInterval(detailPollingRef.current)
          detailPollingRef.current = null
        }
      } catch { /* silent — will retry next interval */ }
    }, 5000)

    return () => {
      if (detailPollingRef.current) {
        clearInterval(detailPollingRef.current)
        detailPollingRef.current = null
      }
    }
  }, [detailDialogOpen, selectedCampaign?.id, selectedCampaign?.status, fetchCampaigns])

  // When contact list changes, fetch available variables
  useEffect(() => {
    if (newCampaign.contactListId) {
      fetchContactVariables(newCampaign.contactListId)
    } else {
      setContactVariables([])
      setPreviewContact(null)
    }
  }, [newCampaign.contactListId, fetchContactVariables])

  const createCampaign = async (asDraft: boolean = false) => {
    if (saving) return // prevent double-click
    setSaving(true)
    try {
      // Upload media and build steps payload
      const stepsPayload: Array<{ stepOrder: number; content: string; delayMinutes: number; delayUnit?: string; mediaUrl?: string; mediatype?: string; variations: string }> = []

      for (let i = 0; i < newCampaign.steps.length; i++) {
        const s = newCampaign.steps[i]
        let mediaUrl = s.mediaUrl || ''
        let mediatype = s.mediatype || ''

        // Upload step media if present
        if (s.mediaFile && mediatype) {
          try {
            const uploadData = await uploadMediaFile(s.mediaFile, mediatype, s.audioMode)
            mediaUrl = uploadData.mediaUrl
            mediatype = uploadData.mediatype
          } catch (uploadErr: any) {
            console.error(`[createCampaign] Upload failed for step ${i + 1}:`, uploadErr?.message)
            toast.error(`Erro no upload da mídia da mensagem ${i + 1}: ${uploadErr?.message || 'erro desconhecido'}`, { duration: 6000 })
            throw uploadErr
          }
        }

        // Upload media for each variation
        const variationsWithMedia: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        for (const v of s.variations) {
          if (!v.content.trim() && !v.mediaFile && !v.mediaUrl && !v.mediatype) continue
          let vMediaUrl = v.mediaUrl || ''
          let vMediatype = v.mediatype || ''

          if (v.mediaFile && vMediatype) {
            try {
              const uploadData = await uploadMediaFile(v.mediaFile, vMediatype, v.audioMode)
              vMediaUrl = uploadData.mediaUrl
              vMediatype = uploadData.mediatype
            } catch (uploadErr: any) {
              console.error(`[createCampaign] Upload failed for variation in step ${i + 1}:`, uploadErr?.message)
              throw uploadErr
            }
          }

          variationsWithMedia.push({ content: v.content, mediaUrl: vMediaUrl || undefined, mediatype: vMediatype || undefined })
        }

        stepsPayload.push({
          stepOrder: i + 1,
          content: s.content,
          delayMinutes: s.delayMinutes,
          delayUnit: s.delayUnit,
          mediaUrl: mediaUrl || undefined,
          mediatype: mediatype || undefined,
          variations: JSON.stringify(variationsWithMedia),
        })
      }

      const payload = {
        name: newCampaign.name, sendIntervalMin: newCampaign.sendIntervalMin, sendIntervalMax: newCampaign.sendIntervalMax,
        chipIds: newCampaign.chipIds, contactListId: newCampaign.contactListId || null,
        chipDistribution: newCampaign.chipDistribution,
        scheduledAt: newCampaign.scheduledAt ? (() => {
          // datetime-local value is in Brasília time (UTC-3)
          // Append timezone offset so Date() converts correctly to UTC for the database
          const localVal = newCampaign.scheduledAt // e.g. "2026-05-21T15:00"
          const brasiliaOffset = '-03:00'
          return new Date(localVal + brasiliaOffset).toISOString()
        })() : null,
        steps: stepsPayload, antiBanEnabled: newCampaign.antiBanEnabled, warmingMode: newCampaign.warmingMode,
        status: asDraft ? 'draft' : undefined,
      }

      console.log('[createCampaign] Saving campaign:', { name: payload.name, stepsCount: stepsPayload.length, editing, campaignId: selectedCampaign?.id })

      if (editing && selectedCampaign) {
        // Edit mode: PATCH the existing campaign
        const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Erro ${res.status} ao atualizar campanha`) }
        // Auto-redistribute if campaign is paused/draft and has chipDistribution changes
        if (['paused', 'draft'].includes(selectedCampaign.status) && Object.values(newCampaign.chipDistribution).some(v => (v || 0) > 0)) {
          try {
            const redistRes = await fetch(`/api/campaigns/${selectedCampaign.id}/redistribute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chipDistribution: newCampaign.chipDistribution }),
            })
            const redistData = await redistRes.json()
            if (redistRes.ok && redistData.redistributed > 0) {
              toast.success(`Campanha atualizada! ${redistData.redistributed} mensagens redistribuídas.`)
            } else {
              toast.success('Campanha atualizada com sucesso!')
            logAction({ action: 'UPDATE_CAMPAIGN', category: 'campaign', targetType: 'Campaign' })
            }
          } catch {
            toast.success('Campanha atualizada com sucesso! (redistribuição automática falhou)')
          }
        } else {
          toast.success('Campanha atualizada com sucesso!')
        }
      } else {
        // Create mode: POST new campaign
        const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Erro ${res.status} ao criar campanha`) }
        toast.success(asDraft ? 'Rascunho salvo com sucesso!' : 'Campanha criada com sucesso!')
        logAction({ action: 'CREATE_CAMPAIGN', category: 'campaign', targetType: 'Campaign' })
      }
      setCreateDialogOpen(false); setEditing(false); resetNewCampaign(); setActiveStep(0); fetchCampaigns()
    } catch (err: unknown) {
      console.error('[createCampaign] Error:', err)
      const errMsg = (err as Error).message || 'Erro ao salvar campanha'
      toast.error(errMsg, { duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  // Track which campaigns are currently starting (prevents double-click)
  const [startingCampaignIds, setStartingCampaignIds] = React.useState<Set<string>>(new Set())

  const startCampaignAction = async (id: string) => {
    // Prevent double-click: if this campaign is already starting, ignore
    if (startingCampaignIds.has(id)) return
    setStartingCampaignIds(prev => new Set(prev).add(id))

    try {
      const res = await fetch(`/api/campaigns/${id}/start`, { method: 'POST' })
      let data
      try { data = await res.json() } catch { data = {} }
      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar campanha')
      toast.success(`Campanha iniciada! ${data.messageCount || 0} mensagens criadas. Processando...`)
      fetchCampaigns()
      // Start continuous processing loop
      startContinuousProcessing()
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro ao iniciar campanha'
      toast.error(msg)
      console.error('Campaign start error:', err)
    } finally {
      // Remove from starting set after a delay to prevent rapid re-clicks
      setTimeout(() => {
        setStartingCampaignIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 3000)
    }
  }

  // Continuous processing loop — keeps calling /api/campaigns/process
  // until no more running campaigns or user stops it
  const startContinuousProcessing = () => {
    setContinuousProcessing(true)
    setContinuousStats({ processed: 0, remaining: 0, elapsed: 0 })
  }

  const stopContinuousProcessing = () => {
    setContinuousProcessing(false)
  }

  // Effect that runs the continuous processing loop
  useEffect(() => {
    if (!continuousProcessing) return

    let cancelled = false

    const processLoop = async () => {
      while (!cancelled) {
        try {
          const res = await fetch('/api/campaigns/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          const data = await res.json()

          if (!res.ok) {
            console.error('[ContinuousProcess] Error:', data.error)
            break
          }

          setContinuousStats(prev => ({
            processed: prev.processed + (data.processed || 0),
            remaining: data.remaining || 0,
            elapsed: data.elapsedMs || 0,
          }))

          // Show toasts for chip ban/disconnect/auto-pause events
          if (data.events?.length) {
            for (const event of data.events) {
              if (event.type === 'chip_banned') {
                toast.error(`Chip ${event.chipName} foi banido durante a campanha "${event.campaignName}"`, { duration: 8000 })
              } else if (event.type === 'chip_disconnected') {
                toast.warning(`Chip ${event.chipName} desconectou durante a campanha "${event.campaignName}"`, { duration: 8000 })
              } else if (event.type === 'campaign_auto_paused') {
                toast.error(`Campanha "${event.campaignName}" foi pausada automaticamente: ${event.reason}`, { duration: 8000 })
              }
            }
          }

          // If no messages were processed and no running campaigns, stop
          if (data.processed === 0 && data.campaigns === 0) {
            console.log('[ContinuousProcess] No more running campaigns, stopping.')
            break
          }

          // If outside sending window, stop (will resume via cron)
          if (data.lastReason?.includes('outside_sending_window')) {
            console.log('[ContinuousProcess] Outside sending window, stopping.')
            break
          }

          // If campaign paused by warning, stop
          if (data.lastReason?.includes('whatsapp_warning_detected')) {
            toast.error('Campanha pausada — aviso do WhatsApp detectado!')
            break
          }

          // Notify when a chip hits daily limit
          if (data.lastReason?.includes('daily_limit_')) {
            const chipMatch = data.lastReason.match(/daily_limit_(?:reassigned_)?(.+)/)
            const chipName = chipMatch ? chipMatch[1] : 'desconhecido'
            if (data.lastReason.includes('reassigned')) {
              toast.warning(`Chip "${chipName}" atingiu o limite diário — mensagens reatribuídas a outros chips`, { duration: 6000 })
            } else {
              toast.error(`Chip "${chipName}" atingiu o limite diário e não há outros chips disponíveis`, { duration: 6000 })
              break
            }
          }

          // Refresh campaign list to show progress
          fetchCampaigns()

          // ADAPTIVE DELAY between loop iterations
          // The /api/campaigns/process endpoint already waits internally for the anti-ban delay,
          // but we still add a minimum gap to prevent hammering the server when the endpoint
          // returns quickly (e.g., when the campaign slot is already claimed by another invocation).
          // If the endpoint took a long time (meaning it was processing + waiting), we use a short delay.
          // If it was quick (meaning nothing was processed or slot was claimed), we wait longer.
          const responseTimeMs = data.elapsedMs || 0
          if (data.processed === 0) {
            // No messages processed — another invocation has the slot or campaign is blocked.
            // Wait 30 seconds before trying again (no point in hammering the server).
            await new Promise(r => setTimeout(r, 30000))
          } else if (responseTimeMs < 10000) {
            // Processed quickly (< 10s) — the delay was short, wait a bit more
            await new Promise(r => setTimeout(r, 5000))
          } else {
            // Normal processing — the endpoint already waited for the anti-ban delay
            // Short 2-second gap before next iteration is fine
            await new Promise(r => setTimeout(r, 2000))
          }

        } catch (err) {
          console.error('[ContinuousProcess] Fetch error:', err)
          // Wait a bit and retry
          await new Promise(r => setTimeout(r, 5000))
        }
      }

      if (!cancelled) {
        setContinuousProcessing(false)
      }
    }

    processLoop()

    return () => { cancelled = true }
  }, [continuousProcessing])

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

  const exportCampaign = async (id: string, name: string, format: string = 'csv') => {
    setExportingId(id)
    try {
      const res = await fetch(`/api/campaigns/${id}/export?format=${format}`)
      if (!res.ok) throw new Error('Erro ao exportar')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/)
      a.download = filenameMatch ? filenameMatch[1] : `relatorio_${name}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Relatório exportado!')
    } catch { toast.error('Erro ao exportar relatório') }
    finally { setExportingId(null) }
  }

  const exportAllCampaigns = async (filter?: string) => {
    setExportingAll(true)
    try {
      const query = filter && filter !== 'all' ? `?status=${filter}` : ''
      const res = await fetch(`/api/campaigns/export-all${query}`)
      if (!res.ok) throw new Error('Erro ao exportar')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/)
      a.download = filenameMatch ? filenameMatch[1] : 'relatorio_geral_campanhas.csv'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Relatório geral exportado!')
    } catch { toast.error('Erro ao exportar relatório geral') }
    finally { setExportingAll(false) }
  }

  const duplicateCampaign = async (c: Campaign) => {
    try {
      const steps = (c.sequenceSteps || []).map((s: SequenceStep) => ({
        stepOrder: s.stepOrder,
        content: s.content,
        delayMinutes: s.delayMinutes,
        mediaUrl: s.mediaUrl || '',
        mediatype: s.mediatype || 'text',
        variations: s.variations || '[]',
      }))
      const chipIds = (c.chips || []).map((cc: { chipId: string }) => cc.chipId)
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.name} (Cópia)`,
          contactListId: c.contactListId,
          sendIntervalMin: c.sendIntervalMin,
          sendIntervalMax: c.sendIntervalMax,
          antiBanEnabled: c.antiBanEnabled,
          warmingMode: c.warmingMode,
          chipIds,
          steps,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Campanha duplicada!')
      fetchCampaigns()
    } catch { toast.error('Erro ao duplicar campanha') }
  }

  const saveCampaignAsTemplate = async (c: Campaign) => {
    try {
      const steps = (c.sequenceSteps || []).map((s: SequenceStep) => ({
        stepOrder: s.stepOrder,
        content: s.content,
        delayMinutes: s.delayMinutes,
        mediaUrl: s.mediaUrl || '',
        mediatype: s.mediatype || 'text',
        variations: s.variations || '[]',
      }))
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          category: 'campanha',
          content: steps.length === 1 ? steps[0].content : '',
          mediatype: steps.length === 1 ? steps[0].mediatype : 'text',
          steps: JSON.stringify(steps),
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Template salvo com sucesso!')
    } catch { toast.error('Erro ao salvar template') }
  }

  const processAllCampaigns = async () => {
    setProcessing(true)
    try {
      const res = await fetch('/api/campaigns/process', { method: 'POST' })
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
    // PROBLEMA 2: Não resetar detailSortBy para 'name' — respeitar o default
    // 'sendOrder' (ou a preferência salva no localStorage do usuário).
    // Apenas resetar search e status filter.
    setDetailSearchQuery(''); setDetailStatusFilter('all')
    try {
      // Fetch fresh campaign data with latest chip info
      const [campRes, msgRes] = await Promise.all([
        fetch(`/api/campaigns/${campaign.id}`, { cache: 'no-store' }),
        fetch(`/api/messages?campaignId=${campaign.id}&limit=5000`, { cache: 'no-store' })
      ])
      if (campRes.ok) setSelectedCampaign(await campRes.json())
      const msgData = await msgRes.json()
      setDetailMessages(Array.isArray(msgData?.data) ? msgData.data : Array.isArray(msgData) ? msgData : [])
    }
    catch { setDetailMessages([]) }
  }

  const toggleChip = (chipId: string) => {
    setNewCampaign(prev => {
      const isRemoving = prev.chipIds.includes(chipId)
      const newChipIds = isRemoving ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId]
      // If removing a chip, also remove its distribution entry
      const newDistribution = { ...prev.chipDistribution }
      if (isRemoving) {
        delete newDistribution[chipId]
      }
      return { ...prev, chipIds: newChipIds, chipDistribution: newDistribution }
    })
  }

  const addStep = () => {
    const newLength = newCampaign.steps.length + 1
    setNewCampaign(prev => ({ ...prev, steps: [...prev.steps, { content: '', delayMinutes: 60, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] }))
    setActiveStep(newLength - 1) // auto-switch to the new step (0-indexed)
  }
  const removeStep = (idx: number) => setNewCampaign(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  const duplicateStep = (idx: number) => {
    setNewCampaign(prev => {
      const stepToCopy = prev.steps[idx]
      if (!stepToCopy) return prev
      const newStep = { ...stepToCopy, mediaFile: null, mediaUrl: stepToCopy.mediaUrl, variations: stepToCopy.variations?.map(v => ({ ...v, mediaFile: null })) || [] }
      const newSteps = [...prev.steps]
      newSteps.splice(idx + 1, 0, newStep)
      return { ...prev, steps: newSteps }
    })
    setActiveStep(idx + 1)
  }
  const moveStep = (fromIdx: number, toIdx: number) => {
    setNewCampaign(prev => {
      const steps = arrayMove(prev.steps, fromIdx, toIdx)
      return { ...prev, steps }
    })
    setActiveStep(toIdx)
  }
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = Number(active.id)
      const newIndex = Number(over.id)
      moveStep(oldIndex, newIndex)
    }
  }
  const updateStep = (idx: number, field: 'content' | 'delayMinutes' | 'delayUnit' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'audioMode' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | number | File | boolean | null) => {
    setNewCampaign(prev => { const steps = [...prev.steps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, steps } })
  }

  // Variation helpers (within a step)
  const addVariation = (stepIdx: number) => setNewCampaign(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: [...steps[stepIdx].variations, { content: '', mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }
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

  // ─── Edit Campaign Helpers ──────────────────────────────────
  const startEditing = (campaign: Campaign) => {
    const emptyVariation = { content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }
    const steps: StepForm[] = (campaign.sequenceSteps || [])
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map(s => {
        let parsedVars: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        try { parsedVars = JSON.parse(s.variations || '[]') } catch { /* ignore */ }
        return {
          content: s.content || '',
          delayMinutes: s.delayMinutes || 0,
          delayUnit: (s.delayUnit || 'minutes') as 'minutes' | 'seconds',
          mediaFile: null as File | null,
          mediaUrl: s.mediaUrl || '',
          mediatype: s.mediatype || '',
          audioMode: 'whatsapp' as const,
          caption: '',
          linkUrl: '',
          linkPreview: true,
          contactName: '',
          contactPhone: '',
          locationLat: '',
          locationLng: '',
          locationName: '',
          variations: parsedVars.length > 0
            ? parsedVars.map(v => ({ content: v.content, mediaFile: null as File | null, mediaUrl: v.mediaUrl || '', mediatype: v.mediatype || '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }))
            : [{ ...emptyVariation }],
        }
      })
    if (steps.length === 0) {
      steps.push({ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ ...emptyVariation }] })
    }
    // Pre-fill newCampaign and open create dialog instead of editing inside detail dialog
    setNewCampaign({
      name: campaign.name,
      sendIntervalMin: campaign.sendIntervalMin || 30,
      sendIntervalMax: campaign.sendIntervalMax || 90,
      chipIds: (campaign.chips || []).map(cc => cc.chipId),
      contactListId: campaign.contactList?.id || '',
      scheduledAt: campaign.scheduledAt ? (() => {
        // Convert UTC to Brasília time for the datetime-local input
        const d = new Date(campaign.scheduledAt)
        const brasilia = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
        const offset = brasilia.getTimezoneOffset()
        const local = new Date(brasilia.getTime() - offset * 60000)
        return local.toISOString().slice(0, 16)
      })() : '',
      steps,
      antiBanEnabled: campaign.antiBanEnabled ?? true,
      warmingMode: campaign.warmingMode || 'normal',
      chipDistribution: (campaign.chips || []).reduce((acc: Record<string, number>, cc: any) => {
        if (cc.contactLimit && cc.contactLimit > 0) acc[cc.chipId] = cc.contactLimit
        return acc
      }, {}),
    })
    setDetailDialogOpen(false)
    setCreateDialogOpen(true)
    setEditing(true) // keep editing flag so createCampaign knows to PATCH instead of POST
  }

  const cancelEditing = () => {
    setEditing(false)
    setCreateDialogOpen(false)
    resetNewCampaign()
  }

  const saveEdit = async () => {
    if (!selectedCampaign) return
    setSaving(true)
    try {
      const stepsPayload: Array<{ stepOrder: number; content: string; delayMinutes: number; delayUnit?: string; mediaUrl?: string; mediatype?: string; variations: string }> = []
      for (let i = 0; i < editForm.steps.length; i++) {
        const s = editForm.steps[i]
        let mediaUrl = s.mediaUrl || ''
        let mediatype = s.mediatype || ''
        if (s.mediaFile && mediatype) {
          try {
            const uploadData = await uploadMediaFile(s.mediaFile, mediatype, s.audioMode)
            mediaUrl = uploadData.mediaUrl
            mediatype = uploadData.mediatype
          } catch (uploadErr: any) {
            console.error(`[saveEdit] Upload failed for step ${i + 1}:`, uploadErr?.message)
            toast.error(`Erro no upload da mídia da mensagem ${i + 1}: ${uploadErr?.message || 'erro desconhecido'}`, { duration: 6000 })
            throw uploadErr
          }
        }
        const variationsWithMedia: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        for (const v of s.variations) {
          if (!v.content.trim() && !v.mediaFile && !v.mediaUrl && !v.mediatype) continue
          let vMediaUrl = v.mediaUrl || ''
          let vMediatype = v.mediatype || ''
          if (v.mediaFile && vMediatype) {
            try {
              const uploadData = await uploadMediaFile(v.mediaFile, vMediatype, v.audioMode)
              vMediaUrl = uploadData.mediaUrl
              vMediatype = uploadData.mediatype
            } catch (uploadErr: any) {
              console.error(`[saveEdit] Upload failed for variation in step ${i + 1}:`, uploadErr?.message)
              throw uploadErr
            }
          }
          variationsWithMedia.push({ content: v.content, mediaUrl: vMediaUrl || undefined, mediatype: vMediatype || undefined })
        }
        stepsPayload.push({
          stepOrder: i + 1,
          content: s.content,
          delayMinutes: s.delayMinutes,
          delayUnit: s.delayUnit,
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
        scheduledAt: editForm.scheduledAt ? new Date(editForm.scheduledAt + '-03:00').toISOString() : null,
        steps: stepsPayload,
        antiBanEnabled: editForm.antiBanEnabled,
        warmingMode: editForm.warmingMode,
        chipDistribution: editForm.chipDistribution,
      }
      console.log('[saveEdit] Saving campaign:', { name: payload.name, stepsCount: stepsPayload.length, campaignId: selectedCampaign.id })
      const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Erro ao atualizar campanha') }
      // Auto-redistribute if campaign is paused/draft and has chipDistribution changes
      if (['paused', 'draft'].includes(selectedCampaign.status) && Object.values(editForm.chipDistribution).some(v => (v || 0) > 0)) {
        try {
          const redistRes = await fetch(`/api/campaigns/${selectedCampaign.id}/redistribute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chipDistribution: editForm.chipDistribution }),
          })
          const redistData = await redistRes.json()
          if (redistRes.ok && redistData.redistributed > 0) {
            toast.success(`Campanha atualizada! ${redistData.redistributed} mensagens redistribuídas.`)
          } else {
            toast.success('Campanha atualizada com sucesso!')
          }
        } catch {
          toast.success('Campanha atualizada com sucesso! (redistribuição automática falhou)')
        }
      } else {
        toast.success('Campanha atualizada com sucesso!')
      }
      setEditing(false)
      fetchCampaigns()
      // Refresh selected campaign
      const updated = await fetch(`/api/campaigns/${selectedCampaign.id}`).then(r => r.json())
      setSelectedCampaign(updated)
    } catch (err: unknown) {
      console.error('[saveEdit] Error:', err)
      const errMsg = (err as Error).message || 'Erro ao atualizar campanha'
      toast.error(errMsg, { duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  const editToggleChip = (chipId: string) => {
    setEditForm(prev => {
      const isRemoving = prev.chipIds.includes(chipId)
      const newChipIds = isRemoving ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId]
      const newDistribution = { ...prev.chipDistribution }
      if (isRemoving) {
        delete newDistribution[chipId]
      }
      return { ...prev, chipIds: newChipIds, chipDistribution: newDistribution }
    })
  }
  const editAddStep = () => setEditForm(prev => ({ ...prev, steps: [...prev.steps, { content: '', delayMinutes: 60, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] }))
  const editRemoveStep = (idx: number) => setEditForm(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  const editUpdateStep = (idx: number, field: 'content' | 'delayMinutes' | 'delayUnit' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | number | File | boolean | null) => {
    setEditForm(prev => { const steps = [...prev.steps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, steps } })
  }
  const editAddVariation = (stepIdx: number) => setEditForm(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: [...steps[stepIdx].variations, { content: '', mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }
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
    editForm.steps.some(s =>
      s.content.trim() ||
      s.mediaFile ||
      s.mediaUrl ||
      s.mediatype ||
      s.variations.some(v => v.content.trim() || v.mediaFile || v.mediaUrl || v.mediatype)
    )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas campanhas de envio em massa</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {continuousProcessing && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Enviando...</span>
              </div>
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {continuousStats.processed} enviadas | {continuousStats.remaining} restantes
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50" onClick={stopContinuousProcessing}>
                Parar
              </Button>
            </div>
          )}
          {!continuousProcessing && (
            <Button variant="outline" className="gap-2" onClick={() => { processAllCampaigns(); startContinuousProcessing() }} disabled={processing}>
              {processing ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
              {processing ? 'Processando...' : 'Processar Campanhas'}
            </Button>
          )}
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 border-sky-500/30 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400" disabled={exportingAll || campaigns.length === 0}>
                  {exportingAll ? <RefreshCw className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  Exportar
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAllCampaigns()} className="gap-2">
                  <FileSpreadsheet className="size-4" /> Todas as campanhas (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('running')} className="gap-2">
                  <Play className="size-4" /> Só em execução (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('completed')} className="gap-2">
                  <CheckCircle className="size-4" /> Só concluídas (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('paused')} className="gap-2">
                  <Pause className="size-4" /> Só pausadas (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('cancelled')} className="gap-2">
                  <X className="size-4" /> Só canceladas (CSV)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger><TooltipContent>Exportar relatório de campanhas com filtros</TooltipContent></Tooltip></TooltipProvider>
          <CreateCampaignDialog
            createDialogOpen={createDialogOpen}
            setCreateDialogOpen={setCreateDialogOpen}
            setEditing={setEditing}
            setSaving={setSaving}
            resetNewCampaign={resetNewCampaign}
            setActiveStep={setActiveStep}
            editing={editing}
            newCampaign={newCampaign}
            setNewCampaign={setNewCampaign}
            availableLists={availableLists}
            availableChips={availableChips}
            getChipEffectiveInfo={getChipEffectiveInfo}
            distMode={distMode}
            setDistMode={setDistMode}
            toggleChip={toggleChip}
            contactVariables={contactVariables}
            previewContact={previewContact}
            messageKeys={messageKeys}
            templates={templates}
            activeStep={activeStep}
            dndSensors={dndSensors}
            handleDragEnd={handleDragEnd}
            removeStep={removeStep}
            duplicateStep={duplicateStep}
            addStep={addStep}
            updateStep={updateStep}
            addVariation={addVariation}
            removeVariation={removeVariation}
            updateVariation={updateVariation}
            saving={saving}
            createCampaign={createCampaign}
          />
        </div>
      </div>

      <CampaignList
        loading={loading}
        campaigns={campaigns}
        setCreateDialogOpen={setCreateDialogOpen}
        campaignFilter={campaignFilter}
        setCampaignFilter={setCampaignFilter}
        campaignSearch={campaignSearch}
        setCampaignSearch={setCampaignSearch}
        selectedCampaignIds={selectedCampaignIds}
        setSelectedCampaignIds={setSelectedCampaignIds}
        fetchCampaigns={fetchCampaigns}
        openDetail={openDetail}
        exportCampaign={exportCampaign}
        exportingId={exportingId}
        duplicateCampaign={duplicateCampaign}
        saveCampaignAsTemplate={saveCampaignAsTemplate}
        setSelectedCampaign={setSelectedCampaign}
        startEditing={startEditing}
        startingCampaignIds={startingCampaignIds}
        startCampaignAction={startCampaignAction}
        deleteConfirm={deleteConfirm}
        setDeleteConfirm={setDeleteConfirm}
        deleteCampaign={deleteCampaign}
        cancelConfirm={cancelConfirm}
        setCancelConfirm={setCancelConfirm}
        updateCampaignStatus={updateCampaignStatus}
      />

      <CampaignDetailDialog
        detailDialogOpen={detailDialogOpen}
        setDetailDialogOpen={setDetailDialogOpen}
        setEditing={setEditing}
        selectedCampaign={selectedCampaign}
        setSelectedCampaign={setSelectedCampaign}
        detailMessages={detailMessages}
        setDetailMessages={setDetailMessages}
        detailMessageCounts={detailMessageCounts}
        detailSortBy={detailSortBy}
        setDetailSortBy={setDetailSortBy}
        detailSearchQuery={detailSearchQuery}
        setDetailSearchQuery={setDetailSearchQuery}
        detailStatusFilter={detailStatusFilter}
        setDetailStatusFilter={setDetailStatusFilter}
        startingCampaignIds={startingCampaignIds}
        startCampaignAction={startCampaignAction}
        fetchCampaigns={fetchCampaigns}
        updateCampaignStatus={updateCampaignStatus}
        exportCampaign={exportCampaign}
        duplicateCampaign={duplicateCampaign}
        saveCampaignAsTemplate={saveCampaignAsTemplate}
        startEditing={startEditing}
        setDeleteConfirm={setDeleteConfirm}
        setRedistributeDistribution={setRedistributeDistribution}
        setDistMode={setDistMode}
        setRedistributeDialogOpen={setRedistributeDialogOpen}
        refreshingDetail={refreshingDetail}
        setRefreshingDetail={setRefreshingDetail}
        toggleChipPause={toggleChipPause}
        getChipEffectiveInfo={getChipEffectiveInfo}
        continuousProcessing={continuousProcessing}
        continuousStats={continuousStats}
      />

      <RedistributeDialog
        redistributeDialogOpen={redistributeDialogOpen}
        setRedistributeDialogOpen={setRedistributeDialogOpen}
        selectedCampaign={selectedCampaign}
        redistributeDistribution={redistributeDistribution}
        setRedistributeDistribution={setRedistributeDistribution}
        distMode={distMode}
        setDistMode={setDistMode}
        getChipEffectiveInfo={getChipEffectiveInfo}
        fetchCampaigns={fetchCampaigns}
        setSelectedCampaign={setSelectedCampaign}
      />
    </div>
  )
}

export default CampanhasTab
