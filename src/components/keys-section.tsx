'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Edit2, Key, Loader2, Copy, Tag, Clock, Shuffle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

interface TimeSlot {
  key: string
  start: string
  end: string
}

interface MessageKey {
  id: string
  name: string
  label: string
  category: string
  variations: string // JSON string
  resolutionType: string // "random" | "time_based"
  timeSlots: string | null // JSON string
  isDefault: boolean
  createdAt: string
}

const categoryLabels: Record<string, string> = {
  saudacao: 'Saudação',
  apresentacao: 'Apresentação',
  pergunta: 'Pergunta',
  encerramento: 'Encerramento',
  emoji: 'Emoji',
  geral: 'Geral',
}

const categoryColors: Record<string, string> = {
  saudacao: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  apresentacao: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  pergunta: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  encerramento: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  emoji: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  geral: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
}

export function KeysSection() {
  const [keys, setKeys] = useState<MessageKey[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<MessageKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('geral')
  const [variations, setVariations] = useState<string[]>([''])
  const [resolutionType, setResolutionType] = useState<'random' | 'time_based'>('random')
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([
    { key: '', start: '06:01', end: '12:00' },
    { key: '', start: '12:01', end: '19:00' },
    { key: '', start: '19:01', end: '06:00' },
  ])
  const [filterCategory, setFilterCategory] = useState('all')
  const { toast } = useToast()

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys')
      if (res.ok) {
        const data = await res.json()
        setKeys(data)
      } else {
        toast({ title: 'Erro ao carregar chaves', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao carregar chaves', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const openCreate = () => {
    setEditingKey(null)
    setName('')
    setLabel('')
    setCategory('geral')
    setVariations([''])
    setResolutionType('random')
    setTimeSlots([
      { key: '', start: '06:01', end: '12:00' },
      { key: '', start: '12:01', end: '19:00' },
      { key: '', start: '19:01', end: '06:00' },
    ])
    setDialogOpen(true)
  }

  const openEdit = (key: MessageKey) => {
    setEditingKey(key)
    setName(key.name)
    setLabel(key.label)
    setCategory(key.category)
    setResolutionType((key.resolutionType as 'random' | 'time_based') || 'random')
    try {
      const parsed = JSON.parse(key.variations)
      setVariations(Array.isArray(parsed) ? parsed : [''])
    } catch {
      setVariations([''])
    }
    try {
      if (key.timeSlots) {
        const parsed = JSON.parse(key.timeSlots)
        setTimeSlots(Array.isArray(parsed) ? parsed : [{ key: '', start: '06:01', end: '12:00' }])
      } else {
        setTimeSlots([
          { key: '', start: '06:01', end: '12:00' },
          { key: '', start: '12:01', end: '19:00' },
          { key: '', start: '19:01', end: '06:00' },
        ])
      }
    } catch {
      setTimeSlots([
        { key: '', start: '06:01', end: '12:00' },
        { key: '', start: '12:01', end: '19:00' },
        { key: '', start: '19:01', end: '06:00' },
      ])
    }
    setDialogOpen(true)
  }

  const addVariation = () => {
    setVariations([...variations, ''])
  }

  const removeVariation = (index: number) => {
    if (variations.length <= 1) return
    setVariations(variations.filter((_, i) => i !== index))
  }

  const updateVariation = (index: number, value: string) => {
    const updated = [...variations]
    updated[index] = value
    setVariations(updated)
  }

  const addTimeSlot = () => {
    setTimeSlots([...timeSlots, { key: '', start: '00:00', end: '23:59' }])
  }

  const removeTimeSlot = (index: number) => {
    if (timeSlots.length <= 1) return
    setTimeSlots(timeSlots.filter((_, i) => i !== index))
  }

  const updateTimeSlot = (index: number, field: keyof TimeSlot, value: string) => {
    const updated = [...timeSlots]
    updated[index] = { ...updated[index], [field]: value }
    setTimeSlots(updated)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Informe o nome da chave', variant: 'destructive' })
      return
    }
    if (!label.trim()) {
      toast({ title: 'Informe o rótulo da chave', variant: 'destructive' })
      return
    }
    const cleanVariations = variations.filter((v) => v.trim())
    if (cleanVariations.length === 0) {
      toast({ title: 'Adicione pelo menos uma variação', variant: 'destructive' })
      return
    }

    if (resolutionType === 'time_based') {
      const hasEmptySlots = timeSlots.some(s => !s.key.trim())
      if (hasEmptySlots) {
        toast({ title: 'Preencha a chave referenciada em todos os períodos', variant: 'destructive' })
        return
      }
    }

    setSaving(true)
    try {
      const url = editingKey ? `/api/keys/${editingKey.id}` : '/api/keys'
      const method = editingKey ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          label,
          category,
          variations: cleanVariations,
          resolutionType,
          timeSlots: resolutionType === 'time_based' ? timeSlots : undefined,
        }),
      })

      if (res.status === 409) {
        toast({ title: 'Já existe uma chave com este nome', variant: 'destructive' })
        return
      }

      if (!res.ok) {
        const data = await res.json()
        toast({ title: data.error || 'Erro ao salvar chave', variant: 'destructive' })
        return
      }

      toast({ title: editingKey ? 'Chave atualizada!' : 'Chave criada!' })
      setDialogOpen(false)
      fetchKeys()
    } catch {
      toast({ title: 'Erro ao salvar chave', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' })
      if (res.status === 403) {
        toast({ title: 'Chaves padrão não podem ser removidas', variant: 'destructive' })
        return
      }
      if (res.ok) {
        toast({ title: 'Chave removida!' })
        fetchKeys()
      } else {
        toast({ title: 'Erro ao remover chave', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Erro ao remover chave', variant: 'destructive' })
    }
  }

  const copyKeyUsage = (keyName: string) => {
    navigator.clipboard.writeText(`{{${keyName}}}`)
    toast({ title: `{{${keyName}}} copiado!` })
  }

  const filteredKeys = filterCategory === 'all'
    ? keys
    : keys.filter((k) => k.category === filterCategory)

  // Group keys by category
  const groupedKeys = filteredKeys.reduce<Record<string, MessageKey[]>>((acc, key) => {
    const cat = key.category || 'geral'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(key)
    return acc
  }, {})

  // Get current greeting based on time (for preview)
  const getCurrentGreeting = () => {
    const now = new Date()
    const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const h = brazilTime.getHours()
    if (h >= 6 && h < 12) return 'Bom dia'
    if (h >= 12 && h < 19) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Chaves de Variação</h2>
          <p className="text-sm text-muted-foreground">
            Crie blocos de variação reutilizáveis para suas mensagens — {'{{NOME_DA_CHAVE}}'}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Chave
          </Button>
        </div>
      </div>

      {/* Keys grouped by category */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-5 w-32 bg-muted rounded mb-3" />
                <div className="h-4 w-48 bg-muted rounded mb-2" />
                <div className="h-4 w-24 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : keys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-emerald-500/10 mb-4">
              <Key className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Nenhuma chave criada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Crie chaves de variação para personalizar suas mensagens automaticamente.
            </p>
            <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Criar Primeira Chave
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedKeys).map(([cat, catKeys]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                <Tag className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {categoryLabels[cat] || cat}
                </h3>
                <Badge variant="outline" className="text-xs bg-zinc-500/10">
                  {catKeys.length}
                </Badge>
              </div>
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {catKeys.map((key) => {
                  const parsedVariations = (() => {
                    try { return JSON.parse(key.variations) } catch { return [] }
                  })()
                  const parsedTimeSlots = (() => {
                    try { return key.timeSlots ? JSON.parse(key.timeSlots) : null } catch { return null }
                  })()
                  const isTimeBased = key.resolutionType === 'time_based'
                  return (
                    <motion.div key={key.id} variants={cardVariants}>
                      <Card className="relative group">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-sm font-mono text-emerald-400">
                                {key.name}
                              </CardTitle>
                              <Badge
                                variant="outline"
                                className={`text-xs ${categoryColors[key.category] || categoryColors.geral}`}
                              >
                                {categoryLabels[key.category] || key.category}
                              </Badge>
                              {isTimeBased && (
                                <Badge variant="outline" className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
                                  <Clock className="w-3 h-3 mr-1" />
                                  Horário
                                </Badge>
                              )}
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => copyKeyUsage(key.name)}
                                title="Copiar uso"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => openEdit(key)}
                                title="Editar"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              {!key.isDefault && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500"
                                  onClick={() => handleDelete(key.id)}
                                  title="Remover"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">{key.label}</p>
                        </CardHeader>
                        <CardContent className="pt-0">
                          {isTimeBased && parsedTimeSlots ? (
                            <div className="space-y-1 mb-2">
                              {parsedTimeSlots.map((slot: TimeSlot, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <span className="text-muted-foreground font-mono">{slot.start}-{slot.end}</span>
                                  <span className="text-muted-foreground">→</span>
                                  <code className="text-emerald-400 font-mono">{'{{'}{slot.key}{'}}'}</code>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {parsedVariations.map((v: string, i: number) => (
                                <p key={i} className="text-xs text-muted-foreground truncate pl-3 border-l-2 border-emerald-500/30">
                                  {v}
                                </p>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              {isTimeBased ? (
                                <><Clock className="w-3 h-3" /> Adaptativo por horário</>
                              ) : (
                                <><Shuffle className="w-3 h-3" /> {parsedVariations.length} variação{parsedVariations.length !== 1 ? 'ões' : ''}</>
                              )}
                            </span>
                            <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                              {'{{'}{key.name}{'}}'}
                            </code>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )
                })}
              </motion.div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingKey ? 'Editar Chave' : 'Nova Chave'}</DialogTitle>
            <DialogDescription>
              {editingKey
                ? 'Edite as variações desta chave'
                : 'Crie um bloco de variação reutilizável. Use {{NOME_DA_CHAVE}} nas mensagens.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Nome da Chave</Label>
                <Input
                  id="key-name"
                  placeholder="Ex: SAUDACAO_MANHA"
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, ''))}
                  className="font-mono"
                  disabled={editingKey?.isDefault}
                />
                <p className="text-xs text-muted-foreground">Apenas letras maiúsculas e underscores</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-label">Rótulo (nome amigável)</Label>
                <Input
                  id="key-label"
                  placeholder="Ex: Saudação - Bom dia"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Resolução</Label>
                <Select value={resolutionType} onValueChange={(v) => setResolutionType(v as 'random' | 'time_based')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">
                      <span className="flex items-center gap-2">
                        <Shuffle className="w-3.5 h-3.5" /> Aleatório
                      </span>
                    </SelectItem>
                    <SelectItem value="time_based">
                      <span className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5" /> Baseado em Horário
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {resolutionType === 'time_based' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Períodos do Dia
                  </Label>
                  <Button variant="ghost" size="sm" onClick={addTimeSlot} className="h-7 text-xs text-emerald-500">
                    <Plus className="w-3 h-3 mr-1" />
                    Período
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Define qual chave usar em cada período. A chave referenciada será resolvida com suas variações aleatórias.
                </p>
                <div className="space-y-2">
                  {timeSlots.map((slot, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={slot.start}
                        onChange={(e) => updateTimeSlot(i, 'start', e.target.value)}
                        className="w-28 text-xs font-mono"
                      />
                      <span className="text-xs text-muted-foreground">até</span>
                      <Input
                        type="time"
                        value={slot.end}
                        onChange={(e) => updateTimeSlot(i, 'end', e.target.value)}
                        className="w-28 text-xs font-mono"
                      />
                      <span className="text-xs text-muted-foreground">→</span>
                      <Input
                        value={slot.key}
                        onChange={(e) => updateTimeSlot(i, 'key', e.target.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, ''))}
                        placeholder="NOME_DA_CHAVE"
                        className="flex-1 text-xs font-mono"
                      />
                      {timeSlots.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-red-500" onClick={() => removeTimeSlot(i)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variações {resolutionType === 'time_based' ? '(referências)' : ''}</Label>
                <Button variant="ghost" size="sm" onClick={addVariation} className="h-7 text-xs text-emerald-500">
                  <Plus className="w-3 h-3 mr-1" />
                  Adicionar
                </Button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {variations.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="flex-shrink-0 flex items-center justify-center w-6 text-xs text-muted-foreground font-mono">
                      {i + 1}.
                    </div>
                    <Textarea
                      value={v}
                      onChange={(e) => updateVariation(i, e.target.value)}
                      placeholder={resolutionType === 'time_based' ? `Variação ${i + 1}... (texto da saudação)` : `Variação ${i + 1}...`}
                      rows={2}
                      className="text-sm"
                    />
                    {variations.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0 text-red-500"
                        onClick={() => removeVariation(i)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {resolutionType === 'time_based'
                  ? 'Para chaves baseadas em horário, as variações servem como fallback. A resolução real vem dos períodos acima.'
                  : 'O sistema escolherá uma variação aleatória cada vez que a chave for usada.'}
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Pré-visualização do uso:</p>
              <div className="flex items-center gap-2">
                <code className="text-sm text-emerald-400 font-mono">
                  {'{{'}{name || 'NOME_DA_CHAVE'}{'}}'}
                </code>
                {resolutionType === 'time_based' && (
                  <span className="text-xs text-muted-foreground">
                    → {getCurrentGreeting()} (agora)
                  </span>
                )}
              </div>
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
              ) : editingKey ? (
                'Salvar Alterações'
              ) : (
                'Criar Chave'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
