'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Settings, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { WireGuardConfigDialog } from '@/components/wireguard-config-dialog'

interface Chip {
  id: string
  name: string
  phoneNumber: string
  wireguardIp: string
  socksPort: number
  status: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  connected: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  connecting: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  disconnected: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  banned: 'bg-red-500/20 text-red-400 border-red-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const statusLabels: Record<string, string> = {
  connected: 'Conectado',
  connecting: 'Conectando',
  disconnected: 'Desconectado',
  banned: 'Banido',
  error: 'Erro',
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
}

export function ChipsSection() {
  const [chips, setChips] = useState<Chip[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [wgDialogChipId, setWgDialogChipId] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchChips = useCallback(async () => {
    try {
      const res = await fetch('/api/chips')
      if (res.ok) {
        const data = await res.json()
        setChips(data)
      } else {
        toast({ title: 'Erro ao carregar chips', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao carregar chips', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchChips()
  }, [fetchChips])

  const handleAddChip = async () => {
    if (!name.trim() || !phone.trim()) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' })
      return
    }

    setAdding(true)
    try {
      const res = await fetch('/api/chips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phoneNumber: phone.trim() }),
      })

      if (res.status === 409) {
        toast({ title: 'Já existe um chip com este número', variant: 'destructive' })
        return
      }

      if (!res.ok) {
        toast({ title: 'Erro ao adicionar chip', variant: 'destructive' })
        return
      }

      toast({ title: 'Chip adicionado com sucesso!' })
      setName('')
      setPhone('')
      setAddDialogOpen(false)
      fetchChips()
    } catch {
      toast({ title: 'Erro ao adicionar chip', variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteChip = async (id: string) => {
    try {
      const res = await fetch(`/api/chips?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Chip removido com sucesso!' })
        fetchChips()
      } else {
        toast({ title: 'Erro ao remover chip', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao remover chip', variant: 'destructive' })
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Chips</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie os chips com conexão WireGuard
          </p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Chip
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Chip</DialogTitle>
              <DialogDescription>
                Adicione um novo chip com número de telefone para configurar o WireGuard.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="chip-name">Nome do Chip</Label>
                <Input
                  id="chip-name"
                  placeholder="Ex: Chip VIVO 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chip-phone">Número do Telefone</Label>
                <Input
                  id="chip-phone"
                  placeholder="Ex: +5511999999999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddDialogOpen(false)}
                disabled={adding}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleAddChip}
                disabled={adding}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {adding ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adicionando...
                  </>
                ) : (
                  'Adicionar'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Chips grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-5 w-32 bg-muted rounded mb-3" />
                <div className="h-4 w-24 bg-muted rounded mb-2" />
                <div className="h-4 w-20 bg-muted rounded mb-4" />
                <div className="h-8 w-full bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : chips.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-emerald-500/10 mb-4">
              <Plus className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Nenhum chip cadastrado</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Adicione seu primeiro chip para começar a enviar mensagens.
            </p>
            <Button
              onClick={() => setAddDialogOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Chip
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {chips.map((chip) => (
            <motion.div key={chip.id} variants={cardVariants}>
              <Card className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{chip.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={statusColors[chip.status] || statusColors.disconnected}
                    >
                      {statusLabels[chip.status] || chip.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Telefone:</span>{' '}
                      {chip.phoneNumber}
                    </p>
                    {chip.wireguardIp && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">WG IP:</span>{' '}
                        {chip.wireguardIp}
                      </p>
                    )}
                    {chip.socksPort && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">SOCKS:</span>{' '}
                        {chip.wireguardIp}:{chip.socksPort}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWgDialogChipId(chip.id)}
                      className="flex-1"
                    >
                      <Settings className="w-3.5 h-3.5 mr-1.5" />
                      WireGuard
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteChip(chip.id)}
                      className="text-red-500 hover:text-red-400 hover:bg-red-500/10 border-red-500/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* WireGuard Config Dialog */}
      {wgDialogChipId && (
        <WireGuardConfigDialog
          chipId={wgDialogChipId}
          open={!!wgDialogChipId}
          onOpenChange={(open) => {
            if (!open) setWgDialogChipId(null)
          }}
        />
      )}
    </div>
  )
}
