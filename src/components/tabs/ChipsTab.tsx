'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: ChipsTab (single function, ~1,880 lines — not sub-split because the entire
// component shares one set of closures; splitting would require prop drilling that
// would change the logic, which the task forbids).

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownToLine, Baby, Check,
  CheckCircle2, ChevronDown, Clock, Copy, Database, Flame, Globe, Info,
  Key, Lock, Menu, Pencil, Plus, QrCode, RefreshCw, Search, Settings,
  ShieldBan, Smartphone, Trash2, Type, WifiOff, X,
} from 'lucide-react'
import { type Chip, type Stats } from '@/lib/types'
import { type AntiBanSettings } from '@/lib/constants'
import { logAction } from '@/lib/audit-log'
import { StatusBadge, ConfirmDialog } from '@/components/shared'
import { useIsVisible } from '@/components/shared/use-is-visible'
import { calcChipEffectiveInfo } from '@/components/campanhas'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { ChipsGridSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import QRCode from 'qrcode'
import { toast } from 'sonner'

// ===== Chips Tab =====
export function ChipsTab() {
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

