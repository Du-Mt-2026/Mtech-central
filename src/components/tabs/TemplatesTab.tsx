'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: TemplatesTab.

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  File as FileIcon, FileText, Film, Filter, Image as ImageIcon, Link2,
  MapPin, MessageCircle, Music, Paperclip, Pencil, Plus, Search,
  Sparkles, Trash2, Type, Users,
} from 'lucide-react'
import { type MessageTemplate } from '@/lib/types'
import { ConfirmDialog } from '@/components/shared'
import { useIsVisible } from '@/components/shared/use-is-visible'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { CardListSkeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

// ===== Templates Tab =====
export function TemplatesTab() {
  const isVisible = useIsVisible()
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [newTemplate, setNewTemplate] = useState({ name: '', content: '', category: 'geral', mediatype: 'text', mediaDescription: '', linkUrl: '', linkPreview: true })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('todas')
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null)
  const [editForm, setEditForm] = useState({ name: '', content: '', category: 'geral', mediatype: 'text', mediaDescription: '', linkUrl: '', linkPreview: true })

  const fetchTemplates = useCallback(async () => {
    try { const res = await fetch('/api/templates'); setTemplates(await res.json()) }
    catch { toast.error('Erro ao carregar templates') } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchTemplates()
    // PERF FIX: was 10s, now 30s. Templates rarely change.
    const interval = setInterval(fetchTemplates, isVisible ? 60000 : 300000)
    return () => clearInterval(interval)
  }, [fetchTemplates])

  const createTemplate = async () => {
    try {
      const res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTemplate) })
      if (!res.ok) throw new Error()
      toast.success('Template criado!')
      setCreateDialogOpen(false)
      setNewTemplate({ name: '', content: '', category: 'geral', mediatype: 'text', mediaDescription: '', linkUrl: '', linkPreview: true })
      fetchTemplates()
    } catch { toast.error('Erro ao criar template') }
  }

  const deleteTemplate = async (id: string) => {
    try { await fetch(`/api/templates?id=${id}`, { method: 'DELETE' }); toast.success('Template removido!'); fetchTemplates() }
    catch { toast.error('Erro ao remover template') }
  }

  const categories = ['todas', ...new Set(templates.map(t => t.category))]
  const filtered = templates.filter(t => {
    const matchSearch = !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.content.toLowerCase().includes(searchQuery.toLowerCase())
    const matchCategory = filterCategory === 'todas' || t.category === filterCategory
    return matchSearch && matchCategory
  })

  const insertVariable = (v: string) => {
    setNewTemplate(prev => ({ ...prev, content: prev.content + v }))
  }
  const insertEditVariable = (v: string) => {
    setEditForm(prev => ({ ...prev, content: prev.content + v }))
  }

  const TEMPLATE_VARS = ['{{nome}}', '{{whatsapp}}', '{{telefone}}']

  const openEditTemplate = (t: MessageTemplate) => {
    setEditTemplate(t)
    setEditForm({ name: t.name, content: t.content, category: t.category, mediatype: t.mediatype || 'text', mediaDescription: t.mediaDescription || '', linkUrl: t.linkUrl || '', linkPreview: t.linkPreview !== undefined ? t.linkPreview : true })
    setEditDialogOpen(true)
  }

  const saveEditTemplate = async () => {
    if (!editTemplate) return
    try {
      const res = await fetch(`/api/templates/${editTemplate.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error()
      toast.success('Template atualizado!')
      setEditDialogOpen(false)
      fetchTemplates()
    } catch { toast.error('Erro ao atualizar template') }
  }

  const categoryColors: Record<string, string> = {
    'saudação': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    'vendas': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    'follow-up': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    'pós-venda': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    'geral': 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400',
  }

  const mediaTypeIcons: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    'text': { icon: <MessageCircle className="size-3.5" />, color: 'text-zinc-500', label: 'Texto' },
    'image': { icon: <ImageIcon className="size-3.5" />, color: 'text-emerald-500', label: 'Imagem' },
    'video': { icon: <Film className="size-3.5" />, color: 'text-sky-500', label: 'Vídeo' },
    'audio': { icon: <Music className="size-3.5" />, color: 'text-amber-500', label: 'Áudio' },
    'document': { icon: <FileIcon className="size-3.5" />, color: 'text-violet-500', label: 'Documento' },
    'contact': { icon: <Users className="size-3.5" />, color: 'text-rose-500', label: 'Contato' },
    'location': { icon: <MapPin className="size-3.5" />, color: 'text-orange-500', label: 'Localização' },
    'link': { icon: <Link2 className="size-3.5" />, color: 'text-blue-500', label: 'Link' },
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Templates</h2>
          <p className="text-sm text-muted-foreground">Biblioteca de mensagens prontas</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
              <Plus className="size-4" /> Novo Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>Criar Template</DialogTitle>
              <DialogDescription>Crie um template de mensagem reutilizável</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input placeholder="Ex: Boas-vindas" value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={newTemplate.category} onValueChange={v => setNewTemplate(p => ({ ...p, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['geral', 'saudação', 'vendas', 'follow-up', 'pós-venda'].map(c => (
                        <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Paperclip className="size-3" /> Tipo de Mídia</Label>
                  <Select value={newTemplate.mediatype} onValueChange={v => setNewTemplate(p => ({ ...p, mediatype: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Somente texto</SelectItem>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="audio">Áudio</SelectItem>
                      <SelectItem value="document">Documento</SelectItem>
                      <SelectItem value="contact">Contato</SelectItem>
                      <SelectItem value="location">Localização</SelectItem>
                      <SelectItem value="link">Link</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {newTemplate.mediatype !== 'text' && (
                <div className="space-y-2">
                  <Label>Descrição da mídia</Label>
                  <Input placeholder={newTemplate.mediatype === 'image' ? 'Ex: Foto do monitor 27"' : newTemplate.mediatype === 'audio' ? 'Ex: Áudio de apresentação' : 'Descreva a mídia a anexar...'} value={newTemplate.mediaDescription} onChange={e => setNewTemplate(p => ({ ...p, mediaDescription: e.target.value }))} />
                </div>
              )}
              {newTemplate.mediatype === 'link' && (
                <div className="space-y-2">
                  <Label>URL do Link</Label>
                  <Input placeholder="https://..." value={newTemplate.linkUrl} onChange={e => setNewTemplate(p => ({ ...p, linkUrl: e.target.value }))} />
                  <div className="flex items-center gap-2">
                    <Switch checked={newTemplate.linkPreview} onCheckedChange={v => setNewTemplate(p => ({ ...p, linkPreview: v }))} />
                    <Label className="text-xs">Com visualização (preview)</Label>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>Conteúdo</Label>
                <Textarea placeholder="Ex: Olá {{nome}}! Tudo bem?" value={newTemplate.content} onChange={e => setNewTemplate(p => ({ ...p, content: e.target.value }))} rows={4} />
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARS.map(v => (
                    <Button key={v} variant="outline" size="sm" className="h-7 text-xs gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => insertVariable(v)}>
                      {v}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={createTemplate} disabled={!newTemplate.name || !newTemplate.content} className="bg-emerald-600 hover:bg-emerald-700">Criar Template</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar templates..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-44"><Filter className="size-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <CardListSkeleton count={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum template encontrado"
          description="Crie seu primeiro template de mensagem para reutilizar em campanhas."
          action={{ label: 'Criar primeiro template', onClick: () => setCreateDialogOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t, i) => {
            const vars = t.content.match(/\{\{[^}]+\}\}/g) || []
            const mediaInfo = mediaTypeIcons[t.mediatype || 'text'] || mediaTypeIcons['text']
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="shadow-lg hover:shadow-xl transition-all duration-200 border-0 group">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
                        <MessageCircle className="size-5 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate text-base">{t.name}</CardTitle>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge className={`text-xs ${categoryColors[t.category] || categoryColors['geral']}`}>
                            {t.category}
                          </Badge>
                          {t.mediatype && t.mediatype !== 'text' && (
                            <Badge variant="outline" className={`text-xs gap-1 ${mediaInfo.color}`}>
                              {mediaInfo.icon} {mediaInfo.label}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground line-clamp-3">{t.content}</p>
                    {t.mediaDescription && (
                      <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                        <Paperclip className="size-3" /> {t.mediaDescription}
                      </p>
                    )}
                    {vars.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {vars.map((v, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs gap-1">
                            <Sparkles className="size-2.5" />{v}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <TooltipProvider><Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-emerald-600 h-7 w-7 p-0" onClick={() => openEditTemplate(t)}>
                            <Pencil className="size-3.5" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Editar template</TooltipContent></Tooltip></TooltipProvider>
                        <TooltipProvider><Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600 h-7 w-7 p-0" onClick={() => setDeleteConfirm(t.id)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Excluir template</TooltipContent></Tooltip></TooltipProvider>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Template" description="Tem certeza que deseja remover este template?"
        onConfirm={() => { if (deleteConfirm) deleteTemplate(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      {/* Edit Template Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Editar Template</DialogTitle>
            <DialogDescription>Atualize as informações do template</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={editForm.category} onValueChange={v => setEditForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['geral', 'saudação', 'vendas', 'follow-up', 'pós-venda'].map(c => (
                      <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><Paperclip className="size-3" /> Tipo de Mídia</Label>
                <Select value={editForm.mediatype} onValueChange={v => setEditForm(p => ({ ...p, mediatype: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Somente texto</SelectItem>
                    <SelectItem value="image">Imagem</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                    <SelectItem value="audio">Áudio</SelectItem>
                    <SelectItem value="document">Documento</SelectItem>
                    <SelectItem value="contact">Contato</SelectItem>
                    <SelectItem value="location">Localização</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editForm.mediatype !== 'text' && (
              <div className="space-y-2">
                <Label>Descrição da mídia</Label>
                <Input placeholder="Descreva a mídia a anexar..." value={editForm.mediaDescription} onChange={e => setEditForm(p => ({ ...p, mediaDescription: e.target.value }))} />
              </div>
            )}
            {editForm.mediatype === 'link' && (
              <div className="space-y-2">
                <Label>URL do Link</Label>
                <Input placeholder="https://..." value={editForm.linkUrl} onChange={e => setEditForm(p => ({ ...p, linkUrl: e.target.value }))} />
                <div className="flex items-center gap-2">
                  <Switch checked={editForm.linkPreview} onCheckedChange={v => setEditForm(p => ({ ...p, linkPreview: v }))} />
                  <Label className="text-xs">Com visualização (preview)</Label>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Conteúdo</Label>
              <Textarea value={editForm.content} onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))} rows={4} />
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map(v => (
                  <Button key={v} variant="outline" size="sm" className="h-7 text-xs gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => insertEditVariable(v)}>
                    {v}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveEditTemplate} disabled={!editForm.name || !editForm.content} className="bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
