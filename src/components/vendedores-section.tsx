'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Edit2, UserCheck, Loader2, Smartphone, Megaphone } from 'lucide-react'
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
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

interface Vendedor {
  id: string
  nome: string
  empresa: string | null
  cargo: string | null
  genero: string | null
  treatAs: string | null
  whatsapp: string | null
  ativo: boolean
  _count?: { chips: number; campaigns: number }
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
}

export function VendedoresSection() {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingVendedor, setEditingVendedor] = useState<Vendedor | null>(null)
  const [saving, setSaving] = useState(false)
  const [nome, setNome] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [cargo, setCargo] = useState('')
  const [genero, setGenero] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | 'ativo' | 'inativo'>('all')
  const { toast } = useToast()

  const fetchVendedores = useCallback(async () => {
    try {
      const res = await fetch('/api/vendedores')
      if (res.ok) {
        const data = await res.json()
        setVendedores(data)
      }
    } catch {
      toast({ title: 'Erro ao carregar vendedores', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchVendedores()
  }, [fetchVendedores])

  const openCreate = () => {
    setEditingVendedor(null)
    setNome('')
    setEmpresa('')
    setCargo('')
    setGenero('')
    setWhatsapp('')
    setAtivo(true)
    setDialogOpen(true)
  }

  const openEdit = (v: Vendedor) => {
    setEditingVendedor(v)
    setNome(v.nome)
    setEmpresa(v.empresa || '')
    setCargo(v.cargo || '')
    setGenero(v.genero || '')
    setWhatsapp(v.whatsapp || '')
    setAtivo(v.ativo)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!nome.trim()) {
      toast({ title: 'Informe o nome do vendedor', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const url = editingVendedor ? `/api/vendedores/${editingVendedor.id}` : '/api/vendedores'
      const method = editingVendedor ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          empresa: empresa || null,
          cargo: cargo || null,
          genero: genero || null,
          whatsapp: whatsapp || null,
          ativo,
        }),
      })

      if (!res.ok) {
        toast({ title: 'Erro ao salvar vendedor', variant: 'destructive' })
        return
      }

      toast({ title: editingVendedor ? 'Vendedor atualizado!' : 'Vendedor cadastrado!' })
      setDialogOpen(false)
      fetchVendedores()
    } catch {
      toast({ title: 'Erro ao salvar vendedor', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/vendedores/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Vendedor removido!' })
        fetchVendedores()
      } else {
        toast({ title: 'Erro ao remover vendedor', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao remover vendedor', variant: 'destructive' })
    }
  }

  const toggleAtivo = async (v: Vendedor) => {
    try {
      const res = await fetch(`/api/vendedores/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !v.ativo }),
      })
      if (res.ok) {
        toast({ title: v.ativo ? 'Vendedor desativado' : 'Vendedor reativado' })
        fetchVendedores()
      }
    } catch {
      toast({ title: 'Erro ao alterar status', variant: 'destructive' })
    }
  }

  const filteredVendedores = filterStatus === 'all'
    ? vendedores
    : vendedores.filter((v) => filterStatus === 'ativo' ? v.ativo : !v.ativo)

  const ativoCount = vendedores.filter((v) => v.ativo).length
  const inativoCount = vendedores.filter((v) => !v.ativo).length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Vendedores</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie os vendedores — cada campanha é enviada em nome de um vendedor
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as 'all' | 'ativo' | 'inativo')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos ({vendedores.length})</SelectItem>
              <SelectItem value="ativo">Ativos ({ativoCount})</SelectItem>
              <SelectItem value="inativo">Inativos ({inativoCount})</SelectItem>
            </SelectContent>
          </Select>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Vendedor
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <UserCheck className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{vendedores.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-500/10">
              <Smartphone className="w-4 h-4 text-sky-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{vendedores.reduce((sum, v) => sum + (v._count?.chips || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Chips associados</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Megaphone className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{vendedores.reduce((sum, v) => sum + (v._count?.campaigns || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Campanhas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <UserCheck className="w-4 h-4 text-violet-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{ativoCount}</p>
              <p className="text-xs text-muted-foreground">Ativos</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vendedores grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-5 w-32 bg-muted rounded mb-3" />
                <div className="h-4 w-24 bg-muted rounded mb-2" />
                <div className="h-4 w-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : vendedores.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-emerald-500/10 mb-4">
              <UserCheck className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Nenhum vendedor cadastrado</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Cadastre vendedores para associá-los a campanhas e chips.
            </p>
            <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Cadastrar Primeiro Vendedor
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
          {filteredVendedores.map((v) => (
            <motion.div key={v.id} variants={cardVariants}>
              <Card className={`relative group ${!v.ativo ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{v.nome}</CardTitle>
                      <Badge
                        variant="outline"
                        className={v.ativo
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                        }
                      >
                        {v.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(v)}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500"
                        onClick={() => handleDelete(v.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm space-y-1">
                    {v.empresa && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Empresa:</span> {v.empresa}
                      </p>
                    )}
                    {v.cargo && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Cargo:</span> {v.cargo}
                      </p>
                    )}
                    {v.genero && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Gênero:</span>{' '}
                        {v.genero === 'masculino' ? 'Masculino' : v.genero === 'feminino' ? 'Feminino' : v.genero}
                        {v.treatAs && <span className="text-xs ml-1">(sou {v.treatAs} {v.nome})</span>}
                      </p>
                    )}
                    {v.whatsapp && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">WhatsApp:</span> {v.whatsapp}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 pt-2 border-t border-border text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Smartphone className="w-3 h-3" /> {v._count?.chips || 0} chips
                    </span>
                    <span className="flex items-center gap-1">
                      <Megaphone className="w-3 h-3" /> {v._count?.campaigns || 0} campanhas
                    </span>
                  </div>
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAtivo(v)}
                      className="w-full text-xs"
                    >
                      {v.ativo ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVendedor ? 'Editar Vendedor' : 'Novo Vendedor'}</DialogTitle>
            <DialogDescription>
              {editingVendedor
                ? 'Atualize os dados do vendedor'
                : 'Cadastre um vendedor para associar a campanhas e chips'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vendedor-nome">Nome *</Label>
              <Input
                id="vendedor-nome"
                placeholder="Ex: Renato"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendedor-empresa">Empresa</Label>
                <Input
                  id="vendedor-empresa"
                  placeholder="Ex: Mtech Distribuidora"
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendedor-cargo">Cargo</Label>
                <Input
                  id="vendedor-cargo"
                  placeholder="Ex: Gerente de Contas"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gênero</Label>
                <Select value={genero} onValueChange={setGenero}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="masculino">Masculino (sou o ...)</SelectItem>
                    <SelectItem value="feminino">Feminino (sou a ...)</SelectItem>
                    <SelectItem value="outro">Outro (sou o(a) ...)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendedor-whatsapp">WhatsApp</Label>
                <Input
                  id="vendedor-whatsapp"
                  placeholder="Ex: +5511999999999"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Pré-visualização da mensagem:</p>
              <p className="text-sm">
                {genero === 'feminino' ? 'Sou a' : genero === 'masculino' ? 'Sou o' : 'Sou o(a)'}{' '}
                <span className="text-emerald-400 font-medium">{nome || 'Nome'}</span>
                {empresa && <> da <span className="text-emerald-400">{empresa}</span></>}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : editingVendedor ? (
                'Salvar Alterações'
              ) : (
                'Cadastrar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
