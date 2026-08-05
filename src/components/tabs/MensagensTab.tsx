'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: MensagensTab.

import { useState, useEffect, useCallback } from 'react'
import {
  Download, MessageSquare, RefreshCw, RotateCcw, Search,
} from 'lucide-react'
import { type Chip, type MessageItem } from '@/lib/types'
import { StatusBadge, statusLabel } from '@/components/shared'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

// ===== Mensagens Tab =====
export function MensagensTab() {
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

