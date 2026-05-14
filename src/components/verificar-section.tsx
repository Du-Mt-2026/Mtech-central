'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Upload, Search, Download, Copy, Check, X,
  Phone, UserPlus, RefreshCw, Loader2, FileSpreadsheet,
  TrendingUp, TrendingDown, CheckCircle2, XCircle, AlertTriangle,
  QrCode, Wifi, WifiOff, Plus, Trash2, ChevronDown,
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

// ===== Types =====
interface Chip {
  id: string
  name: string
  phoneNumber: string
  status: string
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
}

interface ContactList {
  id: string
  name: string
  _count?: { contacts: number }
}

// ===== Helpers =====
function formatPhoneDisplay(phone: string): string {
  if (phone.startsWith('55') && phone.length >= 12) {
    const ddi = phone.slice(0, 2)
    const ddd = phone.slice(2, 4)
    const rest = phone.slice(4)
    if (rest.length <= 9) {
      return `+${ddi} (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
    }
  }
  return phone
}

function formatPhoneForApi(phone: string): string {
  let p = phone.replace(/[\s\-\+\.\(\)]/g, '')
  if (p.startsWith('0')) p = p.substring(1)
  if (!p.startsWith('55')) p = '55' + p
  return p
}

// ===== Component =====
export function VerificarSection() {
  // Chips & connection state
  const [chips, setChips] = useState<Chip[]>([])
  const [selectedChipId, setSelectedChipId] = useState<string>('')
  const [serviceAvailable, setServiceAvailable] = useState(false)
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)

  // QR Code dialog
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrConnected, setQrConnected] = useState(false)

  // Input state
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneNumbers, setPhoneNumbers] = useState<string[]>([])

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false)
  const [results, setResults] = useState<VerificationResult[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [currentBatch, setCurrentBatch] = useState(0)
  const [totalBatches, setTotalBatches] = useState(0)

  // Filter state
  const [activeFilter, setActiveFilter] = useState<'all' | 'valid' | 'invalid'>('all')

  // Contact lists dialog
  const [contactLists, setContactLists] = useState<ContactList[]>([])
  const [addToListDialogOpen, setAddToListDialogOpen] = useState(false)
  const [selectedListId, setSelectedListId] = useState<string>('')
  const [addingToList, setAddingToList] = useState(false)

  // Abort controller ref for cancellation
  const abortRef = useRef<AbortController | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ===== Fetch Chips =====
  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      if (res.ok) {
        const data = await res.json()
        setChips(data)
      }
    } catch {
      // silent
    }
  }, [])

  // ===== Check Evolution API & WhatsApp Connection =====
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
    fetchChips()
    checkServiceStatus()
  }, [fetchChips, checkServiceStatus])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // ===== Connect WhatsApp via Go Service =====
  const connectWhatsApp = async () => {
    if (!selectedChipId) {
      toast.error('Selecione um chip para conectar')
      return
    }

    setQrLoading(true)
    setQrCode(null)
    setQrConnected(false)
    setQrDialogOpen(true)

    try {
      const res = await fetch('/api/verifier/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: selectedChipId }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao conectar WhatsApp')
      }

      // If already connected
      if (data.connected || data.status === 'connected') {
        setQrConnected(true)
        setWhatsappConnected(true)
        toast.success('WhatsApp conectado com sucesso!')
        return
      }

      // If connect already returned a QR code, use it directly
      if (data.qrcode) {
        const qrSrc = data.qrcode.startsWith('data:')
          ? data.qrcode
          : `data:image/png;base64,${data.qrcode}`
        setQrCode(qrSrc)
      } else {
        // Otherwise fetch QR code from the verifier endpoint
        const qrRes = await fetch(`/api/verifier/qr?chipId=${selectedChipId}`)
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

      // Start polling for connection status and QR code refresh
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/verifier/status')
          const statusData = await statusRes.json()
          if (statusData.connection?.connected) {
            setQrConnected(true)
            setWhatsappConnected(true)
            if (pollingRef.current) clearInterval(pollingRef.current)
            toast.success('WhatsApp conectado com sucesso!')
            return
          }
          // Refresh QR code periodically (QR codes expire after ~20s)
          if (!qrConnected && selectedChipId) {
            const qrRefresh = await fetch(`/api/verifier/qr?chipId=${selectedChipId}`)
            if (qrRefresh.ok) {
              const qrRefreshData = await qrRefresh.json()
              if (qrRefreshData.qrCode) {
                const qrSrc = qrRefreshData.qrCode.startsWith('data:')
                  ? qrRefreshData.qrCode
                  : `data:image/png;base64,${qrRefreshData.qrCode}`
                setQrCode(qrSrc)
              }
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

  // ===== Disconnect WhatsApp =====
  const disconnectWhatsApp = async () => {
    try {
      const res = await fetch('/api/verifier/disconnect', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao desconectar')
      }
      setWhatsappConnected(false)
      toast.success('WhatsApp desconectado')
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao desconectar')
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

    setPhoneNumbers(lines)
    setResults([])
    setProgress({ current: 0, total: lines.length })
    toast.success(`${lines.length} número(s) carregado(s) para verificação`)
  }

  // ===== File Upload (CSV, XLSX, XLS, ODS) =====
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    const acceptedExtensions = ['.csv', '.xlsx', '.xls', '.ods']

    if (!acceptedExtensions.includes(ext)) {
      toast.error(`Formato não suportado. Aceitos: ${acceptedExtensions.join(', ')}`)
      return
    }

    // CSV: parse directly as text (lighter, no need for SheetJS on client)
    if (ext === '.csv') {
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        const lines = text.split(/\r?\n/).filter(l => l.trim())

        if (lines.length === 0) {
          toast.error('Arquivo vazio')
          return
        }

        // Try to find phone column
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

        setPhoneInput(phones.join('\n'))
        setPhoneNumbers(phones)
        setResults([])
        setProgress({ current: 0, total: phones.length })
        toast.success(`${phones.length} número(s) importado(s) do CSV`)
      }
      reader.readAsText(file)
    } else {
      // XLSX, XLS, ODS: parse via SheetJS on client
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

            // Find phone column
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
              // No header match — try first column as phone numbers
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

            setPhoneInput(phones.join('\n'))
            setPhoneNumbers(phones)
            setResults([])
            setProgress({ current: 0, total: phones.length })
            toast.success(`${phones.length} número(s) importado(s) da planilha`)
          } catch {
            toast.error('Erro ao ler a planilha')
          }
        }
        reader.readAsArrayBuffer(file)
      }).catch(() => {
        toast.error('Erro ao carregar o processador de planilha')
      })
    }

    // Reset input so same file can be uploaded again
    e.target.value = ''
  }

  // ===== Start Verification =====
  const startVerification = async () => {
    if (!selectedChipId) {
      toast.error('Selecione um chip para verificação')
      return
    }

    if (phoneNumbers.length === 0) {
      toast.error('Carregue os números antes de verificar')
      return
    }

    if (!whatsappConnected) {
      toast.error('Conecte ao WhatsApp antes de verificar números')
      return
    }

    setIsVerifying(true)
    setResults([])
    setProgress({ current: 0, total: phoneNumbers.length })

    const BATCH_SIZE = 50
    const batches: string[][] = []
    for (let i = 0; i < phoneNumbers.length; i += BATCH_SIZE) {
      batches.push(phoneNumbers.slice(i, i + BATCH_SIZE))
    }
    setTotalBatches(batches.length)

    const abortController = new AbortController()
    abortRef.current = abortController

    let allResults: VerificationResult[] = []
    let checkedCount = 0

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (abortController.signal.aborted) break

      setCurrentBatch(batchIdx + 1)
      const batch = batches[batchIdx]

      try {
        const res = await fetch('/api/verifier/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones: batch, chipId: selectedChipId }),
          signal: abortController.signal,
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || `Erro no lote ${batchIdx + 1}`)
        }

        const data = await res.json()

        // Process results — Go service returns { results: [{ number, exists, jid, error }] }
        if (Array.isArray(data.results)) {
          const batchResults: VerificationResult[] = data.results.map(
            (r: { number?: string; phone?: string; exists?: boolean; name?: string; jid?: string; error?: string }, idx: number) => ({
              phone: r.number || r.phone || formatPhoneForApi(batch[idx] || ''),
              originalInput: batch[idx] || '',
              exists: r.exists || false,
              name: r.name || '',
              jid: r.jid || '',
            })
          )
          allResults = [...allResults, ...batchResults]
          setResults([...allResults])
        } else if (Array.isArray(data)) {
          // Handle case where Go service returns array directly
          const batchResults: VerificationResult[] = data.map(
            (r: { number?: string; phone?: string; exists?: boolean; name?: string; jid?: string; error?: string }, idx: number) => ({
              phone: r.number || r.phone || formatPhoneForApi(batch[idx] || ''),
              originalInput: batch[idx] || '',
              exists: r.exists || false,
              name: r.name || '',
              jid: r.jid || '',
            })
          )
          allResults = [...allResults, ...batchResults]
          setResults([...allResults])
        }

        checkedCount += batch.length
        setProgress({ current: checkedCount, total: phoneNumbers.length })
      } catch (err: unknown) {
        if (abortController.signal.aborted) break
        const msg = (err as Error).message || `Erro no lote ${batchIdx + 1}`
        toast.error(msg)
        // Add remaining phones in batch as unknown
        const unknownResults: VerificationResult[] = batch.map(phone => ({
          phone: formatPhoneForApi(phone),
          originalInput: phone,
          exists: false,
          name: '',
          jid: '',
        }))
        allResults = [...allResults, ...unknownResults]
        setResults([...allResults])
        checkedCount += batch.length
        setProgress({ current: checkedCount, total: phoneNumbers.length })
      }

      // Small delay between batches to avoid rate limiting
      if (batchIdx < batches.length - 1 && !abortController.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    setIsVerifying(false)
    if (!abortController.signal.aborted) {
      toast.success(`Verificação concluída! ${allResults.length} número(s) verificado(s)`)
    }
  }

  // ===== Cancel Verification =====
  const cancelVerification = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    setIsVerifying(false)
    toast.info('Verificação cancelada')
  }

  // ===== Export CSV =====
  const exportCsv = () => {
    const filteredResults = getFilteredResults()
    if (filteredResults.length === 0) {
      toast.error('Nenhum resultado para exportar')
      return
    }

    const header = 'Telefone,Telefone Original,Nome,Status\n'
    const rows = filteredResults.map(r =>
      `"${r.phone}","${r.originalInput}","${r.name || ''}","${r.exists ? 'Com WhatsApp' : 'Sem WhatsApp'}"`
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

  const selectedChip = chips.find(c => c.id === selectedChipId)

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
            Verifique quais números estão ativos no WhatsApp
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Connection Status */}
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
              onClick={connectWhatsApp}
              disabled={!selectedChipId}
            >
              <QrCode className="size-4" />
              Conectar WhatsApp
            </Button>
          )}

          {whatsappConnected && (
            <Button
              variant="outline"
              className="gap-2 text-rose-500 hover:bg-rose-500/10 border-rose-500/30"
              onClick={disconnectWhatsApp}
            >
              <WifiOff className="size-4" />
              Desconectar
            </Button>
          )}

          <Button
            variant="outline"
            className="gap-2"
            onClick={checkServiceStatus}
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
            trend: totalVerified > 0 ? 'verificação em andamento' : 'aguardando',
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
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                <Phone className="size-4 text-cyan-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Números para Verificação</CardTitle>
                <CardDescription>Cole os números ou importe de um CSV</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Chip Selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Chip / Proxy para Verificação</Label>
              <Select value={selectedChipId} onValueChange={setSelectedChipId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um chip..." />
                </SelectTrigger>
                <SelectContent>
                  {chips.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum chip cadastrado
                    </div>
                  ) : (
                    chips.map(chip => (
                      <SelectItem key={chip.id} value={chip.id}>
                        <div className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${chip.status === 'connected' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                          <span>{chip.name}</span>
                          <span className="text-xs text-muted-foreground">({chip.phoneNumber})</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {selectedChip && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Proxy: {selectedChip.proxyMode === 'socks5' && selectedChip.socks5Host ? `SOCKS5 ${selectedChip.socks5Host}:${selectedChip.socks5Port}` : selectedChip.wireguardIp ? `SOCKS5 ${selectedChip.wireguardIp}:${selectedChip.socksPort || 8080} (auto)` : 'Nenhum'}</span>
                </div>
              )}
            </div>

            {/* Textarea */}
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
                rows={8}
                className="font-mono text-sm resize-none"
              />
            </div>

            {/* Action Buttons Row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                className="gap-2"
                onClick={parsePhoneNumbers}
                disabled={!phoneInput.trim()}
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
                />
              </label>

              {phoneNumbers.length > 0 && (
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

            <Separator />

            {/* Verification Controls */}
            <div className="space-y-3">
              {/* Progress */}
              {(isVerifying || progress.current > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {isVerifying
                        ? `Verificando lote ${currentBatch}/${totalBatches}...`
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
                </div>
              )}

              {/* Verify / Cancel Buttons */}
              <div className="flex items-center gap-2">
                {isVerifying ? (
                  <Button
                    variant="destructive"
                    className="gap-2"
                    onClick={cancelVerification}
                  >
                    <X className="size-4" />
                    Cancelar
                  </Button>
                ) : (
                  <Button
                    className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
                    onClick={startVerification}
                    disabled={phoneNumbers.length === 0 || !selectedChipId || !whatsappConnected}
                  >
                    <ShieldCheck className="size-4" />
                    Verificar {phoneNumbers.length > 0 ? `(${phoneNumbers.length})` : ''}
                  </Button>
                )}
              </div>

              {!whatsappConnected && serviceAvailable && (
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
            </div>
          </CardContent>
        </Card>

        {/* Results Area */}
        <Card className="shadow-lg border-0">
          <CardHeader>
            <div className="flex items-center justify-between">
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
                      ✅ Com WhatsApp ({validCount})
                    </TabsTrigger>
                    <TabsTrigger value="invalid" className="text-xs px-3">
                      ❌ Sem WhatsApp ({invalidCount})
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
              <ScrollArea className="max-h-96">
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
                            : 'bg-rose-50 dark:bg-rose-900/10 hover:bg-rose-100 dark:hover:bg-rose-900/20'
                        }`}
                      >
                        {/* Status Icon */}
                        <div className={`flex size-7 items-center justify-center rounded-full shrink-0 ${
                          result.exists
                            ? 'bg-emerald-100 dark:bg-emerald-900/30'
                            : 'bg-rose-100 dark:bg-rose-900/30'
                        }`}>
                          {result.exists
                            ? <CheckCircle2 className="size-4 text-emerald-600" />
                            : <XCircle className="size-4 text-rose-500" />}
                        </div>

                        {/* Phone & Name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {formatPhoneDisplay(result.phone)}
                          </p>
                          {result.name && (
                            <p className="text-xs text-muted-foreground truncate">
                              {result.name}
                            </p>
                          )}
                        </div>

                        {/* Status Badge */}
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-xs ${
                            result.exists
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                          }`}
                        >
                          {result.exists ? '✅ Com WhatsApp' : '❌ Sem WhatsApp'}
                        </Badge>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={closeQrDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-5" />
              Conectar WhatsApp
            </DialogTitle>
            <DialogDescription>
              Escaneie o QR Code com o WhatsApp do chip selecionado
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center py-4 space-y-4">
            {qrLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="size-8 animate-spin text-emerald-500" />
                <p className="text-sm text-muted-foreground mt-2">Gerando QR Code...</p>
              </div>
            ) : qrConnected ? (
              <div className="flex flex-col items-center justify-center py-8">
                <CheckCircle2 className="size-12 text-emerald-500" />
                <p className="text-sm font-medium mt-2 text-emerald-600">WhatsApp Conectado!</p>
              </div>
            ) : qrCode ? (
              <>
                <img src={qrCode} alt="QR Code WhatsApp" className="rounded-xl shadow-lg max-w-[280px]" />
                <p className="text-xs text-center text-muted-foreground">
                  Abra o WhatsApp {'>'} Menu {'>'} Aparelhos conectados {'>'} Conectar
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <AlertTriangle className="size-8 mb-2" />
                <p className="text-sm">Não foi possível gerar o QR Code</p>
              </div>
            )}
          </div>
          <DialogFooter>
            {!qrConnected && qrCode && (
              <Button variant="outline" onClick={connectWhatsApp} disabled={qrLoading}>
                <RefreshCw className={`size-4 mr-2 ${qrLoading ? 'animate-spin' : ''}`} />
                Atualizar QR Code
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Contact List Dialog */}
      <Dialog open={addToListDialogOpen} onOpenChange={setAddToListDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-5" />
              Adicionar à Lista de Contatos
            </DialogTitle>
            <DialogDescription>
              Adicione {validCount} número(s) válido(s) a uma lista de contatos
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
                  {contactLists.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhuma lista cadastrada
                    </div>
                  ) : (
                    contactLists.map(list => (
                      <SelectItem key={list.id} value={list.id}>
                        <div className="flex items-center gap-2">
                          <span>{list.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({list._count?.contacts || 0} contatos)
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToListDialogOpen(false)} disabled={addingToList}>
              Cancelar
            </Button>
            <Button
              onClick={addValidContactsToList}
              disabled={!selectedListId || addingToList}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
            >
              {addingToList ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Adicionando...
                </>
              ) : (
                <>
                  <UserPlus className="size-4 mr-2" />
                  Adicionar {validCount} Contato(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
