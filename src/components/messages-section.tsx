'use client'

import { useEffect, useState, useCallback } from 'react'
import { Filter, RefreshCw, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'

interface Message {
  id: string
  content: string
  status: string
  chipId: string | null
  campaignId: string | null
  sentAt: string | null
  createdAt: string
  chip?: { name: string; phoneNumber: string } | null
  campaign?: { name: string } | null
  contact?: { name: string; phone: string } | null
}

interface Campaign {
  id: string
  name: string
}

interface Chip {
  id: string
  name: string
  phoneNumber: string
}

const statusColors: Record<string, string> = {
  pending: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  sent: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  delivered: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  read: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falhou',
}

export function MessagesSection() {
  const [messages, setMessages] = useState<Message[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState<string>('all')
  const [filterChip, setFilterChip] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const { toast } = useToast()

  const fetchMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterCampaign !== 'all') params.set('campaignId', filterCampaign)
      if (filterChip !== 'all') params.set('chipId', filterChip)
      if (filterStatus !== 'all') params.set('status', filterStatus)

      const res = await fetch(`/api/messages?${params.toString()}`)
      if (res.ok) {
        setMessages(await res.json())
      }
    } catch {
      toast({ title: 'Erro ao carregar mensagens', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [filterCampaign, filterChip, filterStatus, toast])

  const fetchFilters = useCallback(async () => {
    try {
      const [campaignsRes, chipsRes] = await Promise.all([
        fetch('/api/campaigns'),
        fetch('/api/chips'),
      ])
      if (campaignsRes.ok) setCampaigns(await campaignsRes.json())
      if (chipsRes.ok) setChips(await chipsRes.json())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchFilters()
  }, [fetchFilters])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Mensagens</h2>
          <p className="text-sm text-muted-foreground">
            Histórico de mensagens enviadas
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true)
            fetchMessages()
          }}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filtros</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select value={filterCampaign} onValueChange={setFilterCampaign}>
              <SelectTrigger>
                <SelectValue placeholder="Campanha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as campanhas</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterChip} onValueChange={setFilterChip}>
              <SelectTrigger>
                <SelectValue placeholder="Chip" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os chips</SelectItem>
                {chips.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="sent">Enviada</SelectItem>
                <SelectItem value="delivered">Entregue</SelectItem>
                <SelectItem value="read">Lida</SelectItem>
                <SelectItem value="failed">Falhou</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Messages table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground">Nenhuma mensagem encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contato</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead className="hidden md:table-cell">Chip</TableHead>
                    <TableHead className="hidden lg:table-cell">Mensagem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((msg) => (
                    <TableRow key={msg.id}>
                      <TableCell className="font-medium">
                        {msg.contact?.name || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {msg.contact?.phone || '—'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {msg.chip?.name || '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-[200px] truncate">
                        {msg.content}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs ${statusColors[msg.status] || statusColors.pending}`}
                        >
                          {statusLabels[msg.status] || msg.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(msg.sentAt || msg.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
