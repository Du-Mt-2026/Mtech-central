'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, Radio, Send, Shield, BarChart3, Plus, Trash2,
  Copy, RefreshCw, Check, X, Clock, Zap, Users, MessageSquare,
  Activity, AlertCircle, ChevronDown, FileText, Settings, Eye,
  Pause, Play, Edit
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import QRCode from 'qrcode'

// Types
interface Chip {
  id: string
  name: string
  phoneNumber: string
  wireguardIp: string
  wireguardPrivKey: string
  wireguardPubKey: string
  socksPort: number
  status: string
  lastSeen: string | null
  createdAt: string
  updatedAt: string
}

interface Campaign {
  id: string
  name: string
  status: string
  messageVariations: string
  sendIntervalMin: number
  sendIntervalMax: number
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  chips: { id: string; chipId: string; chip: Chip }[]
  _count?: { messages: number }
}

interface Message {
  id: string
  campaignId: string | null
  chipId: string
  contactId: string
  content: string
  status: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  error: string | null
  createdAt: string
  chip: { name: string; phoneNumber: string }
  contact: { name: string; phone: string }
}

interface Stats {
  totalChips: number
  connectedChips: number
  totalCampaigns: number
  activeCampaigns: number
  totalMessages: number
  sentMessages: number
  deliveredMessages: number
  failedMessages: number
}

// Status badge helper
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; label: string }> = {
    disconnected: { variant: 'outline', icon: <X className="size-3" />, label: 'Desconectado' },
    connecting: { variant: 'secondary', icon: <RefreshCw className="size-3 animate-spin" />, label: 'Conectando' },
    connected: { variant: 'default', icon: <Check className="size-3" />, label: 'Conectado' },
    error: { variant: 'destructive', icon: <AlertCircle className="size-3" />, label: 'Erro' },
    draft: { variant: 'outline', icon: <Edit className="size-3" />, label: 'Rascunho' },
    scheduled: { variant: 'secondary', icon: <Clock className="size-3" />, label: 'Agendada' },
    running: { variant: 'default', icon: <Play className="size-3" />, label: 'Executando' },
    paused: { variant: 'secondary', icon: <Pause className="size-3" />, label: 'Pausada' },
    completed: { variant: 'default', icon: <Check className="size-3" />, label: 'Concluída' },
    pending: { variant: 'outline', icon: <Clock className="size-3" />, label: 'Pendente' },
    sent: { variant: 'secondary', icon: <Send className="size-3" />, label: 'Enviada' },
    delivered: { variant: 'default', icon: <Check className="size-3" />, label: 'Entregue' },
    read: { variant: 'default', icon: <Eye className="size-3" />, label: 'Lida' },
    failed: { variant: 'destructive', icon: <X className="size-3" />, label: 'Falhou' },
  }
  const v = variants[status] || { variant: 'outline' as const, icon: null, label: status }
  return (
    <Badge variant={v.variant} className="gap-1">
      {v.icon}
      {v.label}
    </Badge>
  )
}

// ===== Dashboard Tab =====
function DashboardTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>

  const deliveryRate = stats.totalMessages > 0 ? Math.round((stats.deliveredMessages / stats.totalMessages) * 100) : 0
  const connectionRate = stats.totalChips > 0 ? Math.round((stats.connectedChips / stats.totalChips) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className="border-l-4 border-l-purple-500">
            <CardHeader>
              <CardDescription>Chips</CardDescription>
              <CardTitle className="text-3xl">{stats.totalChips}</CardTitle>
              <CardAction><Smartphone className="size-5 text-purple-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stats.connectedChips} conectados</p>
              <Progress value={connectionRate} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="border-l-4 border-l-emerald-500">
            <CardHeader>
              <CardDescription>Campanhas</CardDescription>
              <CardTitle className="text-3xl">{stats.totalCampaigns}</CardTitle>
              <CardAction><Radio className="size-5 text-emerald-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stats.activeCampaigns} ativas</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader>
              <CardDescription>Mensagens</CardDescription>
              <CardTitle className="text-3xl">{stats.totalMessages}</CardTitle>
              <CardAction><MessageSquare className="size-5 text-orange-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stats.sentMessages} enviadas</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="border-l-4 border-l-rose-500">
            <CardHeader>
              <CardDescription>Taxa de Entrega</CardDescription>
              <CardTitle className="text-3xl">{deliveryRate}%</CardTitle>
              <CardAction><Activity className="size-5 text-rose-500" /></CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stats.failedMessages} falharam</p>
              <Progress value={deliveryRate} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Resumo de Mensagens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /> Pendentes</div>
                <span className="font-semibold">{stats.totalMessages - stats.sentMessages - stats.deliveredMessages - stats.failedMessages}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Send className="size-4 text-blue-500" /> Enviadas</div>
                <span className="font-semibold">{stats.sentMessages}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Entregues</div>
                <span className="font-semibold">{stats.deliveredMessages}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><X className="size-4 text-rose-500" /> Falharam</div>
                <span className="font-semibold text-rose-600">{stats.failedMessages}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status dos Chips</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Conectados</div>
                <span className="font-semibold">{stats.connectedChips}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><X className="size-4 text-muted-foreground" /> Desconectados</div>
                <span className="font-semibold">{stats.totalChips - stats.connectedChips}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Activity className="size-4 text-purple-500" /> Taxa de Conexão</div>
                <span className="font-semibold">{connectionRate}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ===== Chips Tab =====
function ChipsTab() {
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [selectedChipConfig, setSelectedChipConfig] = useState<{ config: string; chip: Partial<Chip> } | null>(null)
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [newChip, setNewChip] = useState({ name: '', phoneNumber: '' })

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setChips(data)
    } catch {
      toast.error('Erro ao carregar chips')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchChips() }, [fetchChips])

  // Generate QR code when config changes
  useEffect(() => {
    if (selectedChipConfig?.config) {
      QRCode.toDataURL(selectedChipConfig.config, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).then(url => setQrCodeUrl(url)).catch(() => setQrCodeUrl(''))
    } else {
      setQrCodeUrl('')
    }
  }, [selectedChipConfig?.config])

  const createChip = async () => {
    try {
      const res = await fetch('/api/chips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newChip),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      toast.success('Chip criado com sucesso!')
      setAddDialogOpen(false)
      setNewChip({ name: '', phoneNumber: '' })
      fetchChips()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar chip')
    }
  }

  const deleteChip = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este chip?')) return
    try {
      await fetch(`/api/chips/${id}`, { method: 'DELETE' })
      toast.success('Chip removido!')
      fetchChips()
    } catch {
      toast.error('Erro ao remover chip')
    }
  }

  const updateChipStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/chips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      toast.success('Status atualizado!')
      fetchChips()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  const fetchConfig = async (chipId: string) => {
    try {
      const res = await fetch(`/api/wireguard/${chipId}`)
      const data = await res.json()
      setSelectedChipConfig(data)
      setConfigDialogOpen(true)
    } catch {
      toast.error('Erro ao buscar configuração')
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copiado para a área de transferência!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Chips</h2>
          <p className="text-sm text-muted-foreground">Gerencie os chips conectados via WireGuard</p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700"><Plus className="size-4" /> Novo Chip</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Chip</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome do Chip</Label>
                <Input placeholder="Ex: Chip Claro" value={newChip.name} onChange={e => setNewChip(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Número do Telefone</Label>
                <Input placeholder="Ex: 11999990001" value={newChip.phoneNumber} onChange={e => setNewChip(prev => ({ ...prev, phoneNumber: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createChip} disabled={!newChip.name || !newChip.phoneNumber} className="bg-emerald-600 hover:bg-emerald-700">Criar Chip</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : chips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Smartphone className="size-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhum chip cadastrado</p>
            <p className="text-sm text-muted-foreground">Adicione um chip para começar</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {chips.map((chip, i) => (
              <motion.div key={chip.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <Smartphone className="size-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate">{chip.name}</CardTitle>
                        <CardDescription className="truncate">{chip.phoneNumber}</CardDescription>
                      </div>
                      <CardAction><StatusBadge status={chip.status} /></CardAction>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IP WireGuard</span>
                        <span className="font-mono text-xs">{chip.wireguardIp}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Porta SOCKS</span>
                        <span className="font-mono">{chip.socksPort}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Último visto</span>
                        <span>{chip.lastSeen ? new Date(chip.lastSeen).toLocaleString('pt-BR') : 'Nunca'}</span>
                      </div>
                    </div>
                    <Separator className="my-4" />
                    <div className="flex gap-2">
                      <Select onValueChange={(v) => updateChipStatus(chip.id, v)}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="disconnected">Desconectado</SelectItem>
                          <SelectItem value="connecting">Conectando</SelectItem>
                          <SelectItem value="connected">Conectado</SelectItem>
                          <SelectItem value="error">Erro</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => fetchConfig(chip.id)}>
                        <Shield className="size-3.5" /> Config
                      </Button>
                      <Button variant="outline" size="sm" className="text-rose-500 hover:text-rose-600" onClick={() => deleteChip(chip.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* WireGuard Config Dialog with QR Code and Tutorial */}
      <Dialog open={configDialogOpen} onOpenChange={(open) => {
        setConfigDialogOpen(open)
        if (!open) { setSelectedChipConfig(null); setQrCodeUrl(''); setCopied(false) }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-emerald-500" />
              Configuração WireGuard — {selectedChipConfig?.chip.name}
            </DialogTitle>
          </DialogHeader>
          {selectedChipConfig && (
            <Tabs defaultValue="qrcode" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="qrcode" className="flex-1 gap-1.5">📱 QR Code</TabsTrigger>
                <TabsTrigger value="config" className="flex-1 gap-1.5">📄 Configuração</TabsTrigger>
                <TabsTrigger value="tutorial" className="flex-1 gap-1.5">📋 Passo a Passo</TabsTrigger>
              </TabsList>

              {/* QR Code Tab */}
              <TabsContent value="qrcode" className="mt-4">
                <div className="flex flex-col items-center gap-4">
                  {qrCodeUrl ? (
                    <div className="bg-white p-4 rounded-xl shadow-lg">
                      <img src={qrCodeUrl} alt="QR Code WireGuard" className="w-64 h-64" />
                    </div>
                  ) : (
                    <div className="w-64 h-64 bg-muted rounded-xl flex items-center justify-center">
                      <RefreshCw className="size-8 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <div className="text-center space-y-2">
                    <p className="text-sm font-medium">Escaneie com o app WireGuard no celular</p>
                    <p className="text-xs text-muted-foreground">
                      Abra o app WireGuard → Toque em <strong>+</strong> → <strong>Escanear QR Code</strong>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm w-full max-w-xs">
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <span className="text-muted-foreground text-xs block">IP WireGuard</span>
                      <span className="font-mono font-semibold">{selectedChipConfig.chip.wireguardIp}</span>
                    </div>
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <span className="text-muted-foreground text-xs block">Porta SOCKS</span>
                      <span className="font-mono font-semibold">{selectedChipConfig.chip.socksPort}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Config Tab */}
              <TabsContent value="config" className="mt-4">
                <div className="space-y-4">
                  <div className="relative">
                    <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700">
                      {selectedChipConfig.config}
                    </pre>
                  </div>
                  <Button onClick={() => copyToClipboard(selectedChipConfig.config)} variant="outline" className="w-full">
                    {copied ? (
                      <><Check className="size-4 mr-2 text-emerald-500" /> Copiado!</>
                    ) : (
                      <><Copy className="size-4 mr-2" /> Copiar Config</>
                    )}
                  </Button>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Chave Pública do Chip</Label>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => copyToClipboard(selectedChipConfig.chip.wireguardPubKey || '')}>
                        <Copy className="size-3 mr-1" /> Copiar
                      </Button>
                    </div>
                    <code className="block rounded-lg bg-muted p-2 text-xs font-mono break-all">
                      {selectedChipConfig.chip.wireguardPubKey}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Cole esta config em <code className="bg-muted px-1 py-0.5 rounded">/etc/wireguard/wg0.conf</code> ou salve como arquivo <code className="bg-muted px-1 py-0.5 rounded">.conf</code> e importe no app
                  </p>
                </div>
              </TabsContent>

              {/* Tutorial Tab */}
              <TabsContent value="tutorial" className="mt-4">
                <div className="space-y-5 text-sm">
                  {/* Step 1 */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">1</span>
                      No Servidor (VPS)
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>• Instale o WireGuard: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">apt install wireguard</code></p>
                      <p>• Vá na aba <strong>WireGuard</strong> e copie a config do servidor</p>
                      <p>• Cole em <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/etc/wireguard/wg0.conf</code></p>
                      <p>• Ative: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">wg-quick up wg0</code></p>
                      <p>• Habilite IP forwarding: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">sysctl -w net.ipv4.ip_forward=1</code></p>
                      <p>• Torne persistente: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">systemctl enable wg-quick@wg0</code></p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">2</span>
                      No Celular — WireGuard
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>• Instale o app <strong>WireGuard</strong> (Play Store / App Store)</p>
                      <p>• Abra o app e toque no botão <strong>&quot;+&quot;</strong></p>
                      <p>• Escolha <strong>&quot;Escanear QR Code&quot;</strong></p>
                      <p>• Aponte a câmera para o QR Code da aba anterior</p>
                      <p>• Ative o túnel WireGuard (chave liga/desliga)</p>
                      <p>• Verifique se conectou — deve mostrar tempo de conexão ✅</p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">3</span>
                      No Celular — Every Proxy
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>• Instale o app <strong>Every Proxy</strong> (Play Store)</p>
                      <p>• Abra o Every Proxy</p>
                      <p>• Vá na aba <strong>&quot;SOCKS5&quot;</strong></p>
                      <p>• Ligue o switch — <strong>é só ligar, não tem configuração!</strong></p>
                      <p>• O app vai mostrar o IP (ex: <code className="bg-muted px-1 py-0.5 rounded text-xs">{selectedChipConfig.chip.wireguardIp}</code>) e porta <code className="bg-muted px-1 py-0.5 rounded text-xs">1080</code></p>
                      <p>• Pronto! O proxy SOCKS5 está rodando no chip 🎉</p>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-base flex items-center gap-2">
                      <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">4</span>
                      Teste a Conexão
                    </h4>
                    <div className="ml-8 space-y-1.5 text-muted-foreground">
                      <p>
                        • No servidor, teste com:{' '}
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                          curl --socks5 {selectedChipConfig.chip.wireguardIp}:1080 http://ifconfig.me
                        </code>
                      </p>
                      <p>• Deve retornar o <strong>IP do 4G</strong> do chip</p>
                      <p>• Se retornou, está tudo funcionando! ✅</p>
                    </div>
                  </div>

                  {/* Troubleshooting */}
                  <div className="mt-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <h4 className="font-semibold text-amber-400 mb-2">⚠️ Problemas Comuns:</h4>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>• <strong>WireGuard não conecta:</strong> Verifique se a porta 51820/UDP está aberta no firewall</p>
                      <p>• <strong>Proxy não funciona:</strong> Confirme que o WireGuard está conectado ANTES de ligar o Every Proxy</p>
                      <p>• <strong>IP errado no curl:</strong> Reinicie o Every Proxy após conectar o WireGuard</p>
                      <p>• <strong>Sem internet no celular:</strong> Verifique se AllowedIPs = 0.0.0.0/0 e o endpoint está correto</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== Campaigns Tab =====
function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    messageVariations: [''],
    sendIntervalMin: 30,
    sendIntervalMax: 90,
    chipIds: [] as string[],
  })

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns')
      const data = await res.json()
      setCampaigns(data)
    } catch {
      toast.error('Erro ao carregar campanhas')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      const data = await res.json()
      setAvailableChips(data)
    } catch {}
  }, [])

  useEffect(() => { fetchCampaigns(); fetchChips() }, [fetchCampaigns, fetchChips])

  const createCampaign = async () => {
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCampaign),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      toast.success('Campanha criada com sucesso!')
      setCreateDialogOpen(false)
      setNewCampaign({ name: '', messageVariations: [''], sendIntervalMin: 30, sendIntervalMax: 90, chipIds: [] })
      fetchCampaigns()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar campanha')
    }
  }

  const updateCampaignStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      toast.success('Status atualizado!')
      fetchCampaigns()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  const deleteCampaign = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover esta campanha?')) return
    try {
      await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      toast.success('Campanha removida!')
      fetchCampaigns()
    } catch {
      toast.error('Erro ao remover campanha')
    }
  }

  const addVariation = () => {
    setNewCampaign(prev => ({ ...prev, messageVariations: [...prev.messageVariations, ''] }))
  }

  const removeVariation = (index: number) => {
    setNewCampaign(prev => ({
      ...prev,
      messageVariations: prev.messageVariations.filter((_, i) => i !== index),
    }))
  }

  const toggleChip = (chipId: string) => {
    setNewCampaign(prev => ({
      ...prev,
      chipIds: prev.chipIds.includes(chipId)
        ? prev.chipIds.filter(id => id !== chipId)
        : [...prev.chipIds, chipId],
    }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas campanhas de envio em massa</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="size-4" /> Nova Campanha</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Criar Campanha</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome da Campanha</Label>
                <Input placeholder="Ex: Campanha Black Friday" value={newCampaign.name} onChange={e => setNewCampaign(prev => ({ ...prev, name: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Variações de Mensagem</Label>
                  <Button variant="ghost" size="sm" onClick={addVariation}><Plus className="size-3.5" /> Adicionar</Button>
                </div>
                {newCampaign.messageVariations.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <Textarea
                      placeholder="Use {nome} para personalização..."
                      value={v}
                      onChange={e => {
                        const updated = [...newCampaign.messageVariations]
                        updated[i] = e.target.value
                        setNewCampaign(prev => ({ ...prev, messageVariations: updated }))
                      }}
                      className="min-h-[60px]"
                    />
                    {newCampaign.messageVariations.length > 1 && (
                      <Button variant="ghost" size="sm" className="text-rose-500 shrink-0" onClick={() => removeVariation(i)}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Intervalo Mín (seg)</Label>
                  <Input type="number" value={newCampaign.sendIntervalMin} onChange={e => setNewCampaign(prev => ({ ...prev, sendIntervalMin: parseInt(e.target.value) || 30 }))} />
                </div>
                <div className="space-y-2">
                  <Label>Intervalo Máx (seg)</Label>
                  <Input type="number" value={newCampaign.sendIntervalMax} onChange={e => setNewCampaign(prev => ({ ...prev, sendIntervalMax: parseInt(e.target.value) || 90 }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Chips</Label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {availableChips.map(chip => (
                    <label key={chip.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newCampaign.chipIds.includes(chip.id)}
                        onChange={() => toggleChip(chip.id)}
                        className="rounded"
                      />
                      <Smartphone className="size-4 text-purple-500" />
                      <span className="text-sm">{chip.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{chip.phoneNumber}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createCampaign} disabled={!newCampaign.name || newCampaign.messageVariations.every(v => !v.trim())}>Criar Campanha</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Radio className="size-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma campanha cadastrada</p>
            <p className="text-sm text-muted-foreground">Crie uma campanha para começar</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {campaigns.map((campaign, i) => {
              const variations = JSON.parse(campaign.messageVariations || '[]')
              return (
                <motion.div key={campaign.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                          <Radio className="size-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="truncate">{campaign.name}</CardTitle>
                          <CardDescription>
                            {campaign.chips.length} chip(s) • {campaign._count?.messages || 0} mensagens • Intervalo: {campaign.sendIntervalMin}-{campaign.sendIntervalMax}s
                          </CardDescription>
                        </div>
                        <CardAction><StatusBadge status={campaign.status} /></CardAction>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Variações de mensagem:</p>
                          <div className="space-y-1 max-h-24 overflow-y-auto">
                            {variations.map((v: string, j: number) => (
                              <p key={j} className="text-sm bg-muted rounded px-2 py-1 truncate">&quot;{v}&quot;</p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {campaign.chips.map(cc => (
                            <Badge key={cc.id} variant="outline" className="gap-1 text-xs">
                              <Smartphone className="size-3" /> {cc.chip?.name}
                            </Badge>
                          ))}
                        </div>
                        <Separator />
                        <div className="flex gap-2 flex-wrap">
                          {campaign.status === 'draft' && (
                            <Button size="sm" className="gap-1" onClick={() => updateCampaignStatus(campaign.id, 'running')}>
                              <Play className="size-3.5" /> Iniciar
                            </Button>
                          )}
                          {campaign.status === 'running' && (
                            <Button size="sm" variant="secondary" className="gap-1" onClick={() => updateCampaignStatus(campaign.id, 'paused')}>
                              <Pause className="size-3.5" /> Pausar
                            </Button>
                          )}
                          {campaign.status === 'paused' && (
                            <Button size="sm" className="gap-1" onClick={() => updateCampaignStatus(campaign.id, 'running')}>
                              <Play className="size-3.5" /> Retomar
                            </Button>
                          )}
                          {(campaign.status === 'running' || campaign.status === 'paused') && (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => updateCampaignStatus(campaign.id, 'completed')}>
                              <Check className="size-3.5" /> Concluir
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="text-rose-500 hover:text-rose-600 gap-1" onClick={() => deleteCampaign(campaign.id)}>
                            <Trash2 className="size-3.5" /> Remover
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ===== WireGuard Tab =====
function WireGuardTab() {
  const [serverConfig, setServerConfig] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const fetchServerConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/wireguard/server-config')
      const data = await res.json()
      setServerConfig(data.config)
    } catch {
      toast.error('Erro ao carregar configuração do servidor')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchServerConfig() }, [fetchServerConfig])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiado para a área de transferência!')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">WireGuard</h2>
          <p className="text-sm text-muted-foreground">Configuração do servidor VPN</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => { setLoading(true); fetchServerConfig() }}>
          <RefreshCw className="size-4" /> Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Shield className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <CardTitle>Configuração do Servidor</CardTitle>
              <CardDescription>Cole este conteúdo em /etc/wireguard/wg0.conf no seu VPS</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => copyToClipboard(serverConfig)}>
                <Copy className="size-3.5" /> Copiar
              </Button>
            </CardAction>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8"><RefreshCw className="size-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <pre className="rounded-lg bg-muted p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
              {serverConfig}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instruções de Configuração</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <h4 className="font-semibold">1. No VPS (Servidor)</h4>
              <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
{`# Instale o WireGuard
apt install wireguard

# Cole a configuração do servidor
nano /etc/wireguard/wg0.conf

# Ative o IP forwarding
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p

# Inicie o WireGuard
wg-quick up wg0
systemctl enable wg-quick@wg0`}
              </pre>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">2. No Celular (Cliente)</h4>
              <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
{`# Instale o app WireGuard
# Android: Play Store "WireGuard"
# iOS: App Store "WireGuard"

# Para cada chip:
# 1. Clique em "Adicionar Túnel" > "Criar do zero"
# 2. Use a config gerada na aba Chips
# 3. Ative o túnel`}
              </pre>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">3. Configure o Proxy SOCKS5</h4>
              <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
{`# No celular, instale um app SOCKS5 proxy
# Configure para escutar na porta atribuída
# O tráfego será roteado via WireGuard`}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ===== Messages Tab =====
function MessagesTab() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const fetchMessages = useCallback(async (status?: string) => {
    try {
      const params = new URLSearchParams()
      if (status && status !== 'all') params.set('status', status)
      const res = await fetch(`/api/messages?${params.toString()}`)
      const data = await res.json()
      setMessages(data)
    } catch {
      toast.error('Erro ao carregar mensagens')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const handleFilterChange = (status: string) => {
    setFilterStatus(status)
    setLoading(true)
    fetchMessages(status === 'all' ? undefined : status)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Mensagens</h2>
          <p className="text-sm text-muted-foreground">Histórico de mensagens enviadas</p>
        </div>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="sent">Enviada</SelectItem>
              <SelectItem value="delivered">Entregue</SelectItem>
              <SelectItem value="read">Lida</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => { setLoading(true); fetchMessages(filterStatus === 'all' ? undefined : filterStatus) }}>
            <RefreshCw className="size-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="size-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhuma mensagem encontrada</p>
            <p className="text-sm text-muted-foreground">As mensagens aparecerão aqui quando as campanhas forem executadas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div key={msg.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                <Card className="py-3">
                  <CardContent className="py-0">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30 shrink-0 mt-0.5">
                        <MessageSquare className="size-4 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{msg.contact.name}</span>
                          <span className="text-xs text-muted-foreground">{msg.contact.phone}</span>
                          <Badge variant="outline" className="text-xs gap-1">
                            <Smartphone className="size-2.5" /> {msg.chip.name}
                          </Badge>
                          <div className="ml-auto"><StatusBadge status={msg.status} /></div>
                        </div>
                        <p className="text-sm mt-1 truncate">{msg.content}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{new Date(msg.createdAt).toLocaleString('pt-BR')}</span>
                          {msg.sentAt && <span>Enviada: {new Date(msg.sentAt).toLocaleString('pt-BR')}</span>}
                          {msg.error && <span className="text-rose-500">{msg.error}</span>}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ===== Main Page =====
export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activeTab, setActiveTab] = useState('dashboard')

  // Initial fetch on mount
  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await fetch('/api/stats')
        const data = await res.json()
        setStats(data)
      } catch {}
    }
    loadStats()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 dark:from-slate-950 dark:to-purple-950/20">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative size-9">
              <img src="/logo.png" alt="OctupusZap Logo" className="size-9 rounded-lg object-cover" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">OctupusZap</h1>
              <p className="text-xs text-muted-foreground -mt-0.5">WhatsApp Mass Messaging</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 hidden sm:flex">
              <Zap className="size-3" /> v1.0
            </Badge>
            <Button variant="ghost" size="sm" className="gap-1" onClick={async () => {
              try {
                const res = await fetch('/api/stats')
                const data = await res.json()
                setStats(data)
              } catch {}
            }}>
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 w-full sm:w-auto flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="dashboard" className="gap-1.5">
              <BarChart3 className="size-4" /> <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="chips" className="gap-1.5">
              <Smartphone className="size-4" /> <span className="hidden sm:inline">Chips</span>
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5">
              <Radio className="size-4" /> <span className="hidden sm:inline">Campanhas</span>
            </TabsTrigger>
            <TabsTrigger value="wireguard" className="gap-1.5">
              <Shield className="size-4" /> <span className="hidden sm:inline">WireGuard</span>
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5">
              <MessageSquare className="size-4" /> <span className="hidden sm:inline">Mensagens</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardTab stats={stats} />
          </TabsContent>
          <TabsContent value="chips">
            <ChipsTab />
          </TabsContent>
          <TabsContent value="campaigns">
            <CampaignsTab />
          </TabsContent>
          <TabsContent value="wireguard">
            <WireGuardTab />
          </TabsContent>
          <TabsContent value="messages">
            <MessagesTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white/50 dark:bg-slate-950/50 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>OctupusZap © 2024</span>
          <span>Powered by WireGuard VPN</span>
        </div>
      </footer>
    </div>
  )
}
