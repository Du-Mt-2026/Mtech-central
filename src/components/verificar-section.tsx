'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Upload, Search, Copy, Check, X,
  Phone, UserPlus, RefreshCw, Loader2, FileSpreadsheet,
  TrendingUp, TrendingDown, CheckCircle2, XCircle, AlertTriangle,
  QrCode, Wifi, WifiOff, Trash2, Clock, Zap, Shuffle, Settings2,
  Pause, Play, Plus,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { normalizePhone, formatPhoneDisplay as formatPhoneDisplayUtil } from '@/lib/phone-utils'

// ===== Types =====
interface ChipQuota {
  id: string
  name: string
  phoneNumber: string
  status: string
  evolutionInstance: string | null
  verifiedToday: number
  isConnected: boolean
  dailyLimit: number
  quotaRemaining: number
  quotaPercentage: number
  quotaExhausted: boolean
  proxyMode: string
  socks5Host: string
  socks5Port: number
  socks5User: string
  socks5Pass: string
  wireguardIp: string
  socksPort: number
}

interface VerificationResult {
  phone: string
  originalInput: string
  exists: boolean
  name?: string
  jid?: string
  chipName?: string
}

interface ContactList {
  id: string
  name: string
  _count?: { contacts: number }
}

interface ChipProgress {
  chipId: string
  chipName: string
  verified: number
  inCooldown: boolean
  cooldownUntil: number
}

// ===== Helpers =====
function formatPhoneDisplay(phone: string): string {
  return formatPhoneDisplayUtil(phone)
}

function formatPhoneForApi(phone: string): string {
  return normalizePhone(phone)
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ===== Component =====
export function VerificarSection() {
  // Chips & connection state
  const [chipQuotas, setChipQuotas] = useState<ChipQuota[]>([])
  const [selectedChipIds, setSelectedChipIds] = useState<string[]>([])
  const [serviceAvailable, setServiceAvailable] = useState(false)
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)

  // QR Code dialog
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrConnected, setQrConnected] = useState(false)
  const [qrChipId, setQrChipId] = useState<string>('')

  // Input state
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneNumbers, setPhoneNumbers] = useState<string[]>([])

  // Rotation & anti-ban settings
  const [rotationEnabled, setRotationEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [delayMin, setDelayMin] = useState(8)    // seconds between batches
  const [delayMax, setDelayMax] = useState(15)
  const [batchSize, setBatchSize] = useState(5)   // numbers per chip per round
  const [cooldownAfter, setCooldownAfter] = useState(50) // verifications per chip before cooldown
  const [cooldownMinutes, setCooldownMinutes] = useState(5) // cooldown duration

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [results, setResults] = useState<VerificationResult[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [chipProgress, setChipProgress] = useState<ChipProgress[]>([])
  const [currentChipName, setCurrentChipName] = useState<string>('')
  const [estimatedTimeLeft, setEstimatedTimeLeft] = useState<string>('')

  // Filter state
  const [activeFilter, setActiveFilter] = useState<'all' | 'valid' | 'invalid'>('all')

  // Add chip dialog
  const [addChipDialogOpen, setAddChipDialogOpen] = useState(false)
  const [newChipName, setNewChipName] = useState('')
  const [newChipPhone, setNewChipPhone] = useState('')
  const [addingChip, setAddingChip] = useState(false)

  // Contact lists dialog
  const [contactLists, setContactLists] = useState<ContactList[]>([])
  const [addToListDialogOpen, setAddToListDialogOpen] = useState(false)
  const [selectedListId, setSelectedListId] = useState<string>('')
  const [addingToList, setAddingToList] = useState(false)

  // Refs
  const abortRef = useRef<AbortController | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pauseRef = useRef<boolean>(false)

  // ===== Fetch Chip Quotas =====
  const fetchChipQuotas = useCallback(async () => {
    try {
      const res = await fetch('/api/verifier/chip-status')
      if (res.ok) {
        const data = await res.json()
        setChipQuotas(data.chips || [])
        return data.chips || []
      } else {
        toast.error('Erro ao carregar status dos chips')
      }
    } catch {
      // silent
    }
    return []
  }, [])

  // ===== Check Evolution API Status =====
  const checkServiceStatus = useCallback(async () => {
    setCheckingConnection(true)
    try {
      const res = await fetch('/api/verifier/status')
      if (res.ok) {
        const data = await res.json()
        setServiceAvailable(data.serviceAvailable)
        setWhatsappConnected(data.connection?.connected || false)
      } else {
        setServiceAvailable(false)
        setWhatsappConnected(false)
      }
    } catch {
      setServiceAvailable(false)
      setWhatsappConnected(false)
    } finally {
      setCheckingConnection(false)
    }
  }, [])

  useEffect(() => {
    fetchChipQuotas()
    checkServiceStatus()
  }, [fetchChipQuotas, checkServiceStatus])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // Check if any selected chip is connected
  const hasConnectedChip = selectedChipIds.some(id => {
    const chip = chipQuotas.find(c => c.id === id)
    return chip?.isConnected
  })

  const connectedSelectedChips = selectedChipIds.filter(id => {
    const chip = chipQuotas.find(c => c.id === id)
    return chip?.isConnected
  })

  // ===== Toggle Chip Selection =====
  const toggleChipSelection = (chipId: string) => {
    setSelectedChipIds(prev => {
      if (prev.includes(chipId)) {
        return prev.filter(id => id !== chipId)
      }
      return [...prev, chipId]
    })
  }

  const selectAllConnected = () => {
    const connectedIds = chipQuotas.filter(c => c.isConnected && !c.quotaExhausted).map(c => c.id)
    setSelectedChipIds(connectedIds)
  }

  const deselectAll = () => {
    setSelectedChipIds([])
  }

  // ===== Disconnect WhatsApp for a chip =====
  const disconnectWhatsApp = async (chipId?: string) => {
    try {
      const res = await fetch('/api/verifier/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: chipId || undefined }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao desconectar')
      }
      setWhatsappConnected(false)
      toast.success('WhatsApp desconectado')
      fetchChipQuotas()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao desconectar')
    }
  }

  // ===== Add New Chip =====
  const addNewChip = async () => {
    if (!newChipName.trim() || !newChipPhone.trim()) {
      toast.error('Preencha o nome e o número do chip')
      return
    }

    setAddingChip(true)
    try {
      const res = await fetch('/api/chips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newChipName.trim(),
          phoneNumber: newChipPhone.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao criar chip')
      }

      toast.success(`Chip "${newChipName.trim()}" criado com sucesso!`)
      setNewChipName('')
      setNewChipPhone('')
      setAddChipDialogOpen(false)
      await fetchChipQuotas()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao criar chip')
    } finally {
      setAddingChip(false)
    }
  }

  // ===== Connect WhatsApp for a specific chip =====
  const connectWhatsApp = async (chipId: string) => {
    setQrChipId(chipId)
    setQrLoading(true)
    setQrCode(null)
    setQrConnected(false)
    setQrDialogOpen(true)

    try {
      const res = await fetch('/api/verifier/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao conectar WhatsApp')
      }

      if (data.connected || data.status === 'connected') {
        setQrConnected(true)
        setWhatsappConnected(true)
        toast.success('WhatsApp conectado com sucesso!')
        fetchChipQuotas()
        return
      }

      if (data.qrcode) {
        const qrSrc = data.qrcode.startsWith('data:')
          ? data.qrcode
          : `data:image/png;base64,${data.qrcode}`
        setQrCode(qrSrc)
      } else {
        const qrRes = await fetch(`/api/verifier/qr?chipId=${chipId}`)
        if (qrRes.ok) {
          const qrData = await qrRes.json()
          if (qrData.qrCode) {
            const qrSrc = qrData.qrCode.startsWith('data:')
              ? qrData.qrCode
              : `data:image/png;base64,${qrData.qrCode}`
            setQrCode(qrSrc)
          }
        }
      }

      // Start polling
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = setInterval(async () => {
        try {
          const qrRefresh = await fetch(`/api/verifier/qr?chipId=${chipId}`)
          if (qrRefresh.ok) {
            const qrRefreshData = await qrRefresh.json()
            if (qrRefreshData.connected) {
              setQrConnected(true)
              setWhatsappConnected(true)
              if (pollingRef.current) clearInterval(pollingRef.current)
              toast.success('WhatsApp conectado com sucesso!')
              fetchChipQuotas()
              return
            }
            if (qrRefreshData.qrCode) {
              const qrSrc = qrRefreshData.qrCode.startsWith('data:')
                ? qrRefreshData.qrCode
                : `data:image/png;base64,${qrRefreshData.qrCode}`
              setQrCode(qrSrc)
            }
          }
        } catch {
          // continue polling
        }
      }, 3000)
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro ao conectar WhatsApp'
      toast.error(msg)
    } finally {
      setQrLoading(false)
    }
  }

  const closeQrDialog = (open: boolean) => {
    setQrDialogOpen(open)
    if (!open) {
      if (pollingRef.current) clearInterval(pollingRef.current)
      setQrCode(null)
      setQrLoading(false)
      setQrConnected(false)
    }
  }

  // ===== Parse Phone Input =====
  const parsePhoneNumbers = () => {
    const lines = phoneInput
      .split(/[\n,;]+/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && /\d/.test(l))

    if (lines.length === 0) {
      toast.error('Insira pelo menos um número de telefone')
      return
    }

    // Deduplicate
    const unique = [...new Set(lines)]
    setPhoneNumbers(unique)
    setResults([])
    setProgress({ current: 0, total: unique.length })
    toast.success(`${unique.length} número(s) carregado(s) para verificação`)
  }

  // ===== File Upload =====
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    const acceptedExtensions = ['.csv', '.xlsx', '.xls', '.ods']

    if (!acceptedExtensions.includes(ext)) {
      toast.error(`Formato não suportado. Aceitos: ${acceptedExtensions.join(', ')}`)
      return
    }

    if (ext === '.csv') {
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        const lines = text.split(/\r?\n/).filter(l => l.trim())

        if (lines.length === 0) {
          toast.error('Arquivo vazio')
          return
        }

        const header = lines[0].toLowerCase().split(/[,;\t]/).map(h => h.trim().replace(/"/g, ''))
        const phoneIdx = header.findIndex(h =>
          h === 'telefone' || h === 'phone' || h === 'tel' || h === 'numero' || h === 'número' || h === 'celular' || h === 'whatsapp'
        )

        const phones: string[] = []
        const startLine = phoneIdx >= 0 ? 1 : 0

        for (let i = startLine; i < lines.length; i++) {
          if (phoneIdx >= 0) {
            const cols = lines[i].split(/[,;\t]/).map(c => c.trim().replace(/"/g, ''))
            if (cols[phoneIdx]) phones.push(cols[phoneIdx])
          } else {
            const trimmed = lines[i].trim().replace(/"/g, '')
            if (trimmed && /\d/.test(trimmed)) phones.push(trimmed)
          }
        }

        if (phones.length === 0) {
          toast.error('Nenhum telefone encontrado no arquivo')
          return
        }

        const unique = [...new Set(phones)]
        setPhoneInput(unique.join('\n'))
        setPhoneNumbers(unique)
        setResults([])
        setProgress({ current: 0, total: unique.length })
        toast.success(`${unique.length} número(s) importado(s) do CSV`)
      }
      reader.readAsText(file)
    } else {
      import('xlsx').then(XLSX => {
        const reader = new FileReader()
        reader.onload = (event) => {
          try {
            const data = new Uint8Array(event.target?.result as ArrayBuffer)
            const workbook = XLSX.read(data, { type: 'array' })
            const sheetName = workbook.SheetNames[0]
            const sheet = workbook.Sheets[sheetName]

            if (!sheet) {
              toast.error('Arquivo vazio ou sem planilha válida')
              return
            }

            const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

            if (rows.length === 0) {
              toast.error('Nenhum dado encontrado no arquivo')
              return
            }

            const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim())
            const phoneIdx = headers.findIndex(h =>
              h === 'telefone' || h === 'phone' || h === 'tel' || h === 'numero' || h === 'número' || h === 'celular' || h === 'whatsapp'
            )

            const phones: string[] = []

            if (phoneIdx >= 0) {
              const phoneHeader = Object.keys(rows[0])[phoneIdx]
              for (const row of rows) {
                const phone = String(row[phoneHeader] || '').trim()
                if (phone && /\d/.test(phone)) phones.push(phone)
              }
            } else {
              const firstHeader = Object.keys(rows[0])[0]
              for (const row of rows) {
                const val = String(row[firstHeader] || '').trim()
                if (val && /\d/.test(val)) phones.push(val)
              }
            }

            if (phones.length === 0) {
              toast.error('Nenhum telefone encontrado no arquivo')
              return
            }

            const unique = [...new Set(phones)]
            setPhoneInput(unique.join('\n'))
            setPhoneNumbers(unique)
            setResults([])
            setProgress({ current: 0, total: unique.length })
            toast.success(`${unique.length} número(s) importado(s) da planilha`)
          } catch {
            toast.error('Erro ao ler a planilha')
          }
        }
        reader.readAsArrayBuffer(file)
      }).catch(() => {
        toast.error('Erro ao carregar o processador de planilha')
      })
    }

    e.target.value = ''
  }

  // ===== Start Verification with Multi-Chip Rotation =====
  const startVerification = async () => {
    if (connectedSelectedChips.length === 0) {
      toast.error('Selecione pelo menos um chip conectado')
      return
    }

    if (phoneNumbers.length === 0) {
      toast.error('Carregue os números antes de verificar')
      return
    }

    setIsVerifying(true)
    setIsPaused(false)
    pauseRef.current = false
    setResults([])
    setProgress({ current: 0, total: phoneNumbers.length })

    // Initialize chip progress tracking
    const initChipProgress: ChipProgress[] = connectedSelectedChips.map(chipId => {
      const chip = chipQuotas.find(c => c.id === chipId)
      return {
        chipId,
        chipName: chip?.name || 'Desconhecido',
        verified: 0,
        inCooldown: false,
        cooldownUntil: 0,
      }
    })
    setChipProgress(initChipProgress)

    const abortController = new AbortController()
    abortRef.current = abortController

    let allResults: VerificationResult[] = []
    let checkedCount = 0
    const remainingPhones = [...phoneNumbers]

    // Chip rotation state
    let chipRotationIndex = 0
    const chipVerificationCount: Record<string, number> = {}
    const chipCooldownUntil: Record<string, number> = {}
    for (const cp of initChipProgress) {
      chipVerificationCount[cp.chipId] = 0
      chipCooldownUntil[cp.chipId] = 0
    }

    // Available chips (not in cooldown, not exhausted)
    const getAvailableChips = (): string[] => {
      const now = Date.now()
      return connectedSelectedChips.filter(chipId => {
        if (chipCooldownUntil[chipId] && chipCooldownUntil[chipId] > now) return false
        const chip = chipQuotas.find(c => c.id === chipId)
        if (!chip) return false
        if (chip.quotaExhausted) return false
        // Also check if this chip's remaining quota can fit at least 1 number
        if (chip.quotaRemaining - (chipVerificationCount[chipId] || 0) <= 0) return false
        return true
      })
    }

    const totalToCheck = phoneNumbers.length
    const startTime = Date.now()

    while (remainingPhones.length > 0) {
      if (abortController.signal.aborted) break

      // Check pause
      while (pauseRef.current && !abortController.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (abortController.signal.aborted) break

      const availableChips = getAvailableChips()

      if (availableChips.length === 0) {
        // All chips are in cooldown or exhausted — wait for shortest cooldown
        const now = Date.now()
        const activeCooldowns = connectedSelectedChips
          .filter(id => chipCooldownUntil[id] && chipCooldownUntil[id] > now)
          .map(id => chipCooldownUntil[id] - now)

        if (activeCooldowns.length > 0) {
          const waitMs = Math.min(...activeCooldowns) + 1000
          setCurrentChipName('Aguardando cooldown...')
          await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60000)))
          continue
        } else {
          // All chips exhausted daily quota
          toast.error('Todos os chips atingiram o limite diário de verificações')
          break
        }
      }

      // Pick next chip (round-robin)
      let currentChipId: string | undefined
      if (rotationEnabled) {
        // Find next available chip in rotation order
        let attempts = 0
        while (attempts < connectedSelectedChips.length) {
          const candidateChipId = connectedSelectedChips[chipRotationIndex % connectedSelectedChips.length]
          chipRotationIndex++
          attempts++
          if (availableChips.includes(candidateChipId)) {
            currentChipId = candidateChipId
            break
          }
        }
        if (!currentChipId) {
          currentChipId = availableChips[0]
        }
      } else {
        // Single chip mode — use first selected connected chip
        currentChipId = availableChips[0]
      }

      const currentChip = chipQuotas.find(c => c.id === currentChipId)!

      // Determine batch size for this chip
      const chipQuotaLeft = currentChip.quotaRemaining - (chipVerificationCount[currentChipId] || 0)
      const actualBatchSize = rotationEnabled ? Math.min(batchSize, chipQuotaLeft, remainingPhones.length) : Math.min(50, chipQuotaLeft, remainingPhones.length)

      if (actualBatchSize <= 0) {
        // Skip this chip, it has no quota left
        chipCooldownUntil[currentChipId] = Date.now() + 86400000 // 24h cooldown
        continue
      }

      const batch = remainingPhones.splice(0, actualBatchSize)
      setCurrentChipName(currentChip.name)

      try {
        const res = await fetch('/api/verifier/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones: batch, chipId: currentChipId }),
          signal: abortController.signal,
        })

        if (res.status === 429) {
          // Daily limit reached for this chip — put it in long cooldown
          const errData = await res.json()
          chipCooldownUntil[currentChipId] = Date.now() + 86400000
          // Put numbers back in queue
          remainingPhones.unshift(...batch)
          toast.warning(`${currentChip.name}: ${errData.error}`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }

        if (!res.ok) {
          const errData = await res.json()
          throw new Error(errData.error || 'Erro na verificação')
        }

        const data = await res.json()

        // Process results
        const rawResults = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : []
        const batchResults: VerificationResult[] = rawResults.map(
          (r: any, idx: number) => ({
            phone: r.number || r.phone || formatPhoneForApi(batch[idx] || ''),
            originalInput: batch[idx] || '',
            exists: r.exists || false,
            name: r.name || '',
            jid: r.jid || '',
            chipName: currentChip.name,
          })
        )

        allResults = [...allResults, ...batchResults]
        setResults([...allResults])

        checkedCount += batch.length
        chipVerificationCount[currentChipId] = (chipVerificationCount[currentChipId] || 0) + batch.length
        setProgress({ current: checkedCount, total: totalToCheck })

        // Update chip progress
        setChipProgress(prev => prev.map(cp =>
          cp.chipId === currentChipId
            ? { ...cp, verified: (chipVerificationCount[currentChipId] || 0) }
            : cp
        ))

        // Update quota info from server response
        if (data.verifiedToday !== undefined) {
          setChipQuotas(prev => prev.map(cq =>
            cq.id === currentChipId
              ? { ...cq, verifiedToday: data.verifiedToday, quotaRemaining: data.quotaRemaining || 0, quotaExhausted: (data.quotaRemaining || 0) <= 0 }
              : cq
          ))
        }

        // Check cooldown for this chip
        if (rotationEnabled && cooldownAfter > 0 && chipVerificationCount[currentChipId] % cooldownAfter === 0) {
          const cooldownMs = cooldownMinutes * 60 * 1000
          chipCooldownUntil[currentChipId] = Date.now() + cooldownMs
          setChipProgress(prev => prev.map(cp =>
            cp.chipId === currentChipId
              ? { ...cp, inCooldown: true, cooldownUntil: chipCooldownUntil[currentChipId] }
              : cp
          ))
          toast.info(`${currentChip.name}: cooldown de ${cooldownMinutes}min após ${cooldownAfter} verificações`)
        }
      } catch (err: unknown) {
        if (abortController.signal.aborted) break
        const msg = (err as Error).message || 'Erro na verificação'
        toast.error(msg)
        const unknownResults: VerificationResult[] = batch.map(phone => ({
          phone: formatPhoneForApi(phone),
          originalInput: phone,
          exists: false,
          name: '',
          jid: '',
          chipName: currentChip.name,
        }))
        allResults = [...allResults, ...unknownResults]
        setResults([...allResults])
        checkedCount += batch.length
        setProgress({ current: checkedCount, total: totalToCheck })
      }

      // Estimate time remaining
      if (checkedCount > 0 && checkedCount < totalToCheck) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = checkedCount / elapsed
        const remaining = (totalToCheck - checkedCount) / rate
        if (remaining > 60) {
          setEstimatedTimeLeft(`~${Math.ceil(remaining / 60)} min restante(s)`)
        } else {
          setEstimatedTimeLeft(`~${Math.ceil(remaining)}s restante(s)`)
        }
      }

      // Delay between batches (with jitter for anti-ban)
      if (remainingPhones.length > 0 && !abortController.signal.aborted) {
        const delaySec = rotationEnabled
          ? randomBetween(delayMin, delayMax)
          : 2 // Fixed 2s for single-chip mode
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000))
      }
    }

    setIsVerifying(false)
    setIsPaused(false)
    setEstimatedTimeLeft('')
    setCurrentChipName('')
    fetchChipQuotas() // Refresh quotas

    if (!abortController.signal.aborted) {
      toast.success(`Verificação concluída! ${allResults.length} número(s) verificado(s)`)
    }
  }

  // ===== Pause/Resume =====
  const togglePause = () => {
    const newPaused = !isPaused
    setIsPaused(newPaused)
    pauseRef.current = newPaused
    toast.info(newPaused ? 'Verificação pausada' : 'Verificação retomada')
  }

  // ===== Cancel Verification =====
  const cancelVerification = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    setIsVerifying(false)
    setIsPaused(false)
    pauseRef.current = false
    toast.info('Verificação cancelada')
  }

  // ===== Export CSV =====
  const exportCsv = () => {
    const filteredResults = getFilteredResults()
    if (filteredResults.length === 0) {
      toast.error('Nenhum resultado para exportar')
      return
    }

    const header = 'Telefone,Telefone Original,Nome,Status,Chip\n'
    const rows = filteredResults.map(r =>
      `"${r.phone}","${r.originalInput}","${r.name || ''}","${r.exists ? 'Com WhatsApp' : 'Sem WhatsApp'}","${r.chipName || ''}"`
    ).join('\n')

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `verificacao_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exportado com sucesso!')
  }

  // ===== Copy Valid Numbers =====
  const copyValidNumbers = async () => {
    const validNumbers = results.filter(r => r.exists)
    if (validNumbers.length === 0) {
      toast.error('Nenhum número válido para copiar')
      return
    }

    const text = validNumbers.map(r => r.originalInput || r.phone).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${validNumbers.length} número(s) válido(s) copiado(s)!`)
    } catch {
      toast.error('Erro ao copiar números')
    }
  }

  // ===== Add to Contact List =====
  const openAddToListDialog = async () => {
    const validResults = results.filter(r => r.exists)
    if (validResults.length === 0) {
      toast.error('Nenhum número válido para adicionar')
      return
    }

    try {
      const res = await fetch('/api/contact-lists')
      if (res.ok) {
        const data = await res.json()
        setContactLists(data)
      } else {
        toast.error('Erro ao carregar listas de contatos')
      }
    } catch {
      toast.error('Erro ao carregar listas de contatos')
    }

    setAddToListDialogOpen(true)
  }

  const addValidContactsToList = async () => {
    if (!selectedListId) {
      toast.error('Selecione uma lista de contatos')
      return
    }

    setAddingToList(true)
    try {
      const validResults = results.filter(r => r.exists)
      let added = 0
      let failed = 0

      for (const r of validResults) {
        try {
          const res = await fetch(`/api/contact-lists/${selectedListId}/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: r.name || r.originalInput || r.phone,
              phone: r.originalInput || r.phone,
            }),
          })
          if (res.ok) added++
          else failed++
        } catch {
          failed++
        }
      }

      if (added > 0) {
        toast.success(`${added} contato(s) adicionado(s) à lista!${failed > 0 ? ` — ${failed} falha(s)` : ''}`)
      } else {
        toast.error('Falha ao adicionar contatos à lista')
      }
      setAddToListDialogOpen(false)
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao adicionar contatos')
    } finally {
      setAddingToList(false)
    }
  }

  // ===== Filtered Results =====
  const getFilteredResults = useCallback(() => {
    switch (activeFilter) {
      case 'valid': return results.filter(r => r.exists)
      case 'invalid': return results.filter(r => !r.exists)
      default: return results
    }
  }, [results, activeFilter])

  // ===== Stats =====
  const totalVerified = results.length
  const validCount = results.filter(r => r.exists).length
  const invalidCount = results.filter(r => !r.exists).length
  const validationRate = totalVerified > 0 ? Math.round((validCount / totalVerified) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <ShieldCheck className="size-5 text-emerald-600" />
            </div>
            Verificar Números
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Verifique quais números estão ativos no WhatsApp com rotação de chips
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Service Status */}
          <div className="flex items-center gap-2">
            {checkingConnection ? (
              <Badge variant="outline" className="gap-1.5 animate-pulse">
                <Loader2 className="size-3 animate-spin" />
                Verificando...
              </Badge>
            ) : serviceAvailable ? (
              whatsappConnected ? (
                <Badge variant="default" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  <Wifi className="size-3" />
                  WhatsApp Conectado
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 border-amber-500/30 text-amber-600">
                  <WifiOff className="size-3" />
                  Desconectado
                </Badge>
              )
            ) : (
              <Badge variant="destructive" className="gap-1.5">
                <AlertTriangle className="size-3" />
                Serviço Indisponível
              </Badge>
            )}
          </div>

          {serviceAvailable && !whatsappConnected && (
            <Button
              variant="outline"
              className="gap-2 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-500"
              onClick={() => {
                if (selectedChipIds.length > 0) {
                  connectWhatsApp(selectedChipIds[0])
                } else {
                  toast.error('Selecione um chip para conectar')
                }
              }}
              disabled={selectedChipIds.length === 0}
            >
              <QrCode className="size-4" />
              Conectar WhatsApp
            </Button>
          )}

          {whatsappConnected && (
            <Button
              variant="outline"
              className="gap-2 text-rose-500 hover:bg-rose-500/10 border-rose-500/30"
              onClick={() => disconnectWhatsApp()}
            >
              <WifiOff className="size-4" />
              Desconectar
            </Button>
          )}

          <Button
            variant="outline"
            className="gap-2"
            onClick={() => { fetchChipQuotas(); checkServiceStatus() }}
            disabled={checkingConnection}
          >
            <RefreshCw className={`size-4 ${checkingConnection ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            title: 'Total Verificados',
            value: totalVerified,
            sub: `de ${phoneNumbers.length || 0} números`,
            icon: Phone,
            gradient: 'from-cyan-500 to-sky-600',
            trendUp: true,
            trend: isVerifying ? estimatedTimeLeft : totalVerified > 0 ? 'concluído' : 'aguardando',
          },
          {
            title: 'Com WhatsApp',
            value: validCount,
            sub: 'números válidos',
            icon: CheckCircle2,
            gradient: 'from-emerald-500 to-teal-600',
            trendUp: validCount > 0,
            trend: validCount > 0 ? `${validationRate}% do total` : 'nenhum encontrado',
          },
          {
            title: 'Sem WhatsApp',
            value: invalidCount,
            sub: 'não registrados',
            icon: XCircle,
            gradient: 'from-rose-500 to-pink-600',
            trendUp: invalidCount === 0,
            trend: invalidCount > 0 ? 'não estão no WhatsApp' : 'nenhum inválido',
          },
          {
            title: 'Taxa de Validação',
            value: totalVerified > 0 ? `${validationRate}%` : '—',
            sub: 'validade dos números',
            icon: TrendingUp,
            gradient: 'from-amber-500 to-orange-600',
            trendUp: validationRate >= 50,
            trend: validationRate >= 70 ? 'boa taxa' : validationRate >= 40 ? 'taxa média' : 'taxa baixa',
          },
        ].map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
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

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Area */}
        <Card className="shadow-lg border-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                  <Phone className="size-4 text-cyan-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">Números para Verificação</CardTitle>
                  <CardDescription>Cole os números ou importe de um arquivo</CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="size-3.5" />
                Config
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Multi-Chip Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Chips para Verificação</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs h-7 px-2 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                    onClick={() => setAddChipDialogOpen(true)}
                    disabled={isVerifying}
                  >
                    <Plus className="size-3" />
                    Adicionar Chip
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={selectAllConnected}>
                    Selecionar conectados
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={deselectAll}>
                    Limpar
                  </Button>
                </div>
              </div>

              {/* Rotation Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Shuffle className="size-4 text-violet-600" />
                  <div>
                    <p className="text-sm font-medium">Rotação de Chips</p>
                    <p className="text-xs text-muted-foreground">Alternar chips automaticamente</p>
                  </div>
                </div>
                <Switch
                  checked={rotationEnabled}
                  onCheckedChange={setRotationEnabled}
                />
              </div>

              {/* Chip List */}
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {chipQuotas.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">Nenhum chip cadastrado</p>
                ) : (
                  chipQuotas.map(chip => {
                    const isSelected = selectedChipIds.includes(chip.id)
                    return (
                      <div
                        key={chip.id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-900/10'
                            : 'border-transparent hover:bg-muted/50'
                        } ${chip.quotaExhausted ? 'opacity-50' : ''}`}
                        onClick={() => toggleChipSelection(chip.id)}
                      >
                        <div className={`size-4 rounded border-2 flex items-center justify-center ${
                          isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-300'
                        }`}>
                          {isSelected && <Check className="size-3 text-white" />}
                        </div>
                        <span className={`size-2.5 rounded-full ${chip.isConnected ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{chip.name}</p>
                          <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>
                          <p className="text-[10px] text-muted-foreground/70">
                            Proxy: {chip.proxyMode === 'socks5' && chip.socks5Host ? `SOCKS5 ${chip.socks5Host}:${chip.socks5Port}` : chip.wireguardIp ? `SOCKS5 ${chip.wireguardIp}:8084 (auto)` : 'Nenhum'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium">{chip.verifiedToday}/{chip.dailyLimit}</p>
                          <div className="w-16 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 mt-0.5">
                            <div
                              className={`h-full rounded-full transition-all ${
                                chip.quotaPercentage > 80 ? 'bg-rose-500' : chip.quotaPercentage > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(chip.quotaPercentage, 100)}%` }}
                            />
                          </div>
                        </div>
                        {!chip.isConnected ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs h-7 px-2 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                            onClick={(e) => { e.stopPropagation(); connectWhatsApp(chip.id) }}
                          >
                            <QrCode className="size-3" />
                            Conectar
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs h-7 px-2 text-rose-500 hover:bg-rose-500/10 border-rose-500/30"
                            onClick={(e) => { e.stopPropagation(); disconnectWhatsApp(chip.id) }}
                          >
                            <WifiOff className="size-3" />
                          </Button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {selectedChipIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {connectedSelectedChips.length} chip(s) conectado(s) selecionado(s)
                  {rotationEnabled && connectedSelectedChips.length > 1 && ` — rotação ativa`}
                </p>
              )}
            </div>

            <Separator />

            {/* Action Buttons Row — ABOVE textarea */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                className="gap-2"
                onClick={parsePhoneNumbers}
                disabled={!phoneInput.trim() || isVerifying}
              >
                <Search className="size-4" />
                Carregar Números
              </Button>

              <label className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors">
                <Upload className="size-4" />
                Importar Planilha
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,.ods"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isVerifying}
                />
              </label>

              {phoneNumbers.length > 0 && !isVerifying && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-rose-500 hover:bg-rose-500/10 border-rose-500/30"
                  onClick={() => {
                    setPhoneInput('')
                    setPhoneNumbers([])
                    setResults([])
                    setProgress({ current: 0, total: 0 })
                  }}
                >
                  <Trash2 className="size-3" />
                  Limpar
                </Button>
              )}
            </div>

            {/* Verification Controls — ABOVE textarea */}
            <div className="space-y-3">
              {/* Progress */}
              {(isVerifying || progress.current > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {isVerifying
                        ? currentChipName
                          ? `Verificando via ${currentChipName}...`
                          : 'Verificando...'
                        : 'Verificação concluída'}
                    </span>
                    <span className="font-medium">
                      {progress.current}/{progress.total}
                    </span>
                  </div>
                  <Progress
                    value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0}
                    className="h-2"
                  />
                  {isVerifying && estimatedTimeLeft && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" />
                      {estimatedTimeLeft}
                    </p>
                  )}
                </div>
              )}

              {/* Chip Progress during verification */}
              {isVerifying && chipProgress.length > 1 && (
                <div className="space-y-1.5 p-3 rounded-lg bg-muted/50">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Progresso por Chip</p>
                  {chipProgress.map(cp => (
                    <div key={cp.chipId} className="flex items-center gap-2 text-xs">
                      <span className={`size-2 rounded-full ${cp.inCooldown ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      <span className="flex-1 truncate">{cp.chipName}</span>
                      <span className="text-muted-foreground">{cp.verified} verific.</span>
                      {cp.inCooldown && (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
                          Cooldown
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Verify / Pause / Cancel Buttons */}
              <div className="flex items-center gap-2">
                {isVerifying ? (
                  <>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={togglePause}
                    >
                      {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
                      {isPaused ? 'Retomar' : 'Pausar'}
                    </Button>
                    <Button
                      variant="destructive"
                      className="gap-2"
                      onClick={cancelVerification}
                    >
                      <X className="size-4" />
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
                    onClick={startVerification}
                    disabled={phoneNumbers.length === 0 || connectedSelectedChips.length === 0}
                  >
                    <ShieldCheck className="size-4" />
                    Verificar {phoneNumbers.length > 0 ? `(${phoneNumbers.length})` : ''}
                  </Button>
                )}
              </div>

              {!hasConnectedChip && selectedChipIds.length > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Nenhum chip selecionado está conectado. Conecte ao WhatsApp primeiro.
                </p>
              )}

              {!whatsappConnected && serviceAvailable && selectedChipIds.length === 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Conecte ao WhatsApp antes de verificar números
                </p>
              )}

              {!serviceAvailable && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Evolution API indisponível. Verifique se a Evolution API está rodando e as credenciais estão configuradas.
                </p>
              )}

              {connectedSelectedChips.length === 0 && !isVerifying && serviceAvailable && selectedChipIds.length > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Selecione pelo menos um chip conectado para verificar
                </p>
              )}
            </div>

            <Separator />

            {/* Textarea — BELOW controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Números de Telefone</Label>
                <span className="text-xs text-muted-foreground">
                  {phoneNumbers.length > 0 ? `${phoneNumbers.length} número(s) carregado(s)` : 'Um por linha'}
                </span>
              </div>
              <Textarea
                placeholder="Cole os números aqui, um por linha...&#10;Ex:&#10;5511999999999&#10;5511888888888&#10;11977777777"
                value={phoneInput}
                onChange={e => {
                  setPhoneInput(e.target.value)
                  setPhoneNumbers([])
                  setResults([])
                }}
                rows={6}
                className="font-mono text-sm resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* Results Area */}
        <Card className="shadow-lg border-0">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="size-4 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Resultados</CardTitle>
                <CardDescription>
                  {totalVerified > 0
                    ? `${validCount} válido(s), ${invalidCount} inválido(s)`
                    : 'Aguardando verificação'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter Tabs */}
            {results.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Tabs value={activeFilter} onValueChange={(v) => setActiveFilter(v as 'all' | 'valid' | 'invalid')}>
                  <TabsList className="h-8">
                    <TabsTrigger value="all" className="text-xs px-3">
                      Todos ({results.length})
                    </TabsTrigger>
                    <TabsTrigger value="valid" className="text-xs px-3">
                      Com WhatsApp ({validCount})
                    </TabsTrigger>
                    <TabsTrigger value="invalid" className="text-xs px-3">
                      Sem WhatsApp ({invalidCount})
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs h-8"
                    onClick={exportCsv}
                    disabled={results.length === 0}
                  >
                    <FileSpreadsheet className="size-3" />
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs h-8"
                    onClick={copyValidNumbers}
                    disabled={validCount === 0}
                  >
                    <Copy className="size-3" />
                    Copiar Com WhatsApp
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs h-8 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                    onClick={openAddToListDialog}
                    disabled={validCount === 0}
                  >
                    <UserPlus className="size-3" />
                    Adicionar à Lista
                  </Button>
                </div>
              </div>
            )}

            {/* Results Table */}
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ShieldCheck className="size-12 mb-3 opacity-20" />
                <p className="text-sm font-medium">Nenhum resultado ainda</p>
                <p className="text-xs mt-1">Carregue números e inicie a verificação</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[28rem]">
                <div className="space-y-1.5">
                  <AnimatePresence>
                    {getFilteredResults().map((result, idx) => (
                      <motion.div
                        key={result.phone + idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                        className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                          result.exists
                            ? 'bg-emerald-50 dark:bg-emerald-900/10 hover:bg-emerald-100 dark:hover:bg-emerald-900/20'
                            : 'bg-rose-50/50 dark:bg-rose-900/5 hover:bg-rose-100/50 dark:hover:bg-rose-900/10'
                        }`}
                      >
                        <div className={`flex size-7 items-center justify-center rounded-full shrink-0 ${
                          result.exists ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-rose-100 dark:bg-rose-900/30'
                        }`}>
                          {result.exists ? (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          ) : (
                            <XCircle className="size-4 text-rose-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {formatPhoneDisplay(result.phone)}
                          </p>
                          {result.name && (
                            <p className="text-xs text-muted-foreground truncate">{result.name}</p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 shrink-0 ${
                            result.exists
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                          }`}
                        >
                          {result.exists ? 'Com WhatsApp' : 'Sem WhatsApp'}
                        </Badge>
                        {result.chipName && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            {result.chipName}
                          </Badge>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Chip Dialog */}
      <Dialog open={addChipDialogOpen} onOpenChange={setAddChipDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-5" />
              Adicionar Novo Chip
            </DialogTitle>
            <DialogDescription>
              Cadastre um novo chip para verificação de números
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome do Chip</Label>
              <input
                type="text"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Ex: Chip VIVO 1"
                value={newChipName}
                onChange={e => setNewChipName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNewChip() }}
              />
            </div>
            <div className="space-y-2">
              <Label>Número do WhatsApp</Label>
              <input
                type="text"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Ex: 5511999999999"
                value={newChipPhone}
                onChange={e => setNewChipPhone(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNewChip() }}
              />
              <p className="text-xs text-muted-foreground">
                Inclua o DDI + DDD. Ex: 5511999999999
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddChipDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={addNewChip}
              disabled={!newChipName.trim() || !newChipPhone.trim() || addingChip}
              className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
            >
              {addingChip && <Loader2 className="size-4 animate-spin" />}
              <Plus className="size-4" />
              Criar Chip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="size-5" />
              Configurações de Verificação
            </DialogTitle>
            <DialogDescription>
              Ajuste os parâmetros para evitar bloqueio da Meta
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Delay between batches */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Delay entre lotes (segundos)</Label>
                <span className="text-sm font-mono text-muted-foreground">{delayMin}-{delayMax}s</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Mínimo: {delayMin}s</Label>
                  <Slider
                    value={[delayMin]}
                    onValueChange={([v]) => setDelayMin(Math.min(v, delayMax - 1))}
                    min={3}
                    max={30}
                    step={1}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Máximo: {delayMax}s</Label>
                  <Slider
                    value={[delayMax]}
                    onValueChange={([v]) => setDelayMax(Math.max(v, delayMin + 1))}
                    min={5}
                    max={60}
                    step={1}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                O sistema escolhe um delay aleatório entre min e max para cada lote (jitter anti-detecção)
              </p>
            </div>

            <Separator />

            {/* Batch size */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Números por chip por rodada</Label>
                <span className="text-sm font-mono text-muted-foreground">{batchSize}</span>
              </div>
              <Slider
                value={[batchSize]}
                onValueChange={([v]) => setBatchSize(v)}
                min={1}
                max={20}
                step={1}
              />
              <p className="text-xs text-muted-foreground">
                Quantos números cada chip verifica antes de trocar para o próximo. Menor = mais seguro
              </p>
            </div>

            <Separator />

            {/* Cooldown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Cooldown após N verificações</Label>
                <span className="text-sm font-mono text-muted-foreground">{cooldownAfter}</span>
              </div>
              <Slider
                value={[cooldownAfter]}
                onValueChange={([v]) => setCooldownAfter(v)}
                min={10}
                max={200}
                step={5}
              />

              <div className="flex items-center justify-between mt-2">
                <Label className="text-sm font-medium">Duração do cooldown (minutos)</Label>
                <span className="text-sm font-mono text-muted-foreground">{cooldownMinutes}min</span>
              </div>
              <Slider
                value={[cooldownMinutes]}
                onValueChange={([v]) => setCooldownMinutes(v)}
                min={1}
                max={30}
                step={1}
              />
              <p className="text-xs text-muted-foreground">
                Após {cooldownAfter} verificações, o chip faz uma pausa de {cooldownMinutes} minutos
              </p>
            </div>

            <Separator />

            {/* Daily limit info */}
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Limite diário: 300 verificações/chip</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Cada chip pode verificar no máximo 300 números por dia. O contador reseta à meia-noite.
                    Com 5 chips, você pode verificar até 1.500 números/dia.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={closeQrDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-5" />
              Conectar WhatsApp
            </DialogTitle>
            <DialogDescription>
              Escaneie o QR Code com o WhatsApp do chip
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center py-4 space-y-4">
            {qrLoading ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="size-8 animate-spin text-emerald-600" />
                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
              </div>
            ) : qrConnected ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <CheckCircle2 className="size-12 text-emerald-600" />
                <p className="text-sm font-medium text-emerald-600">WhatsApp Conectado!</p>
              </div>
            ) : qrCode ? (
              <>
                <img
                  src={qrCode}
                  alt="QR Code WhatsApp"
                  className="max-w-[256px] rounded-lg border shadow-md"
                />
                <p className="text-xs text-center text-muted-foreground">
                  Abra o WhatsApp &gt; Menu &gt; Aparelhos conectados &gt; Conectar
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <AlertTriangle className="size-8 text-amber-500" />
                <p className="text-sm text-muted-foreground">Não foi possível gerar o QR Code</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {!qrConnected && qrCode && !qrLoading && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => connectWhatsApp(qrChipId)}
              >
                <RefreshCw className="size-4" />
                Atualizar QR Code
              </Button>
            )}
            <Button variant="outline" onClick={() => closeQrDialog(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Contact List Dialog */}
      <Dialog open={addToListDialogOpen} onOpenChange={setAddToListDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adicionar à Lista de Contatos</DialogTitle>
            <DialogDescription>
              Adicione os números válidos a uma lista de contatos existente
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Lista de Contatos</Label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma lista..." />
                </SelectTrigger>
                <SelectContent>
                  {contactLists.map(list => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} ({list._count?.contacts || 0} contatos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {results.filter(r => r.exists).length} números válidos serão adicionados
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToListDialogOpen(false)}>Cancelar</Button>
            <Button onClick={addValidContactsToList} disabled={!selectedListId || addingToList} className="gap-2">
              {addingToList && <Loader2 className="size-4 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
