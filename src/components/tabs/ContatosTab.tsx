'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: SortableContactRow + ContatosTab.

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Download, FileSpreadsheet, GripVertical, Info, LayoutList,
  Pencil, Phone, Plus, RefreshCw, Search, Trash2, Type, Upload, UserPlus,
  Users, X,
} from 'lucide-react'
import { type ContactItem, type ContactList } from '@/lib/types'
import { ConfirmDialog } from '@/components/shared'
import { useIsVisible } from '@/components/shared/use-is-visible'
import { STANDARD_CONTACT_FIELDS } from '@/components/shared/contact-fields'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { toast } from 'sonner'

// ===== Sortable Contact Row =====
function SortableContactRow({ contact, isSelected, onToggleSelect, onEdit, onDelete, customData }: {
  contact: ContactItem
  isSelected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onDelete: () => void
  customData: Record<string, string>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: contact.id })
  const style = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <tr ref={setNodeRef} style={style} className={`border-t hover:bg-muted/30 transition-colors ${isDragging ? 'bg-muted shadow-lg' : ''}`}>
      <td className="p-3 w-[40px]">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="size-4 rounded border-gray-300"
        />
      </td>
      <td className="p-3 w-[36px]" {...attributes} {...listeners}>
        <GripVertical className="size-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
      </td>
      {STANDARD_CONTACT_FIELDS.map(f => {
        const value = f.core
          ? (f.key === 'nome' ? contact.name : contact.phone)
          : (customData[f.key] || '-')
        return (
          <td key={f.key} className={`p-3 truncate ${f.core ? 'font-medium' : 'text-muted-foreground text-xs'}`}>
            {value}
          </td>
        )
      })}
      <td className="p-3 text-muted-foreground text-xs truncate">
        {contact.createdAt ? new Date(contact.createdAt).toLocaleString('pt-BR') : '—'}
      </td>
      <td className="p-3">
        <div className="flex gap-1">
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger><TooltipContent>Editar contato</TooltipContent></Tooltip></TooltipProvider>
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger><TooltipContent>Excluir contato</TooltipContent></Tooltip></TooltipProvider>
        </div>
      </td>
    </tr>
  )
}

// ===== Contatos Tab =====
export function ContatosTab() {
  const isVisible = useIsVisible()
  const [contactLists, setContactLists] = useState<ContactList[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [contactsPage, setContactsPage] = useState(1)
  const CONTACTS_PER_PAGE = 50
  const [loading, setLoading] = useState(true)
  const [selectedList, setSelectedList] = useState<ContactList | null>(null)
  const [addListDialog, setAddListDialog] = useState(false)
  const [addContactDialog, setAddContactDialog] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newContact, setNewContact] = useState({ name: '', phone: '', customFields: {} as Record<string, string> })
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editContactDialog, setEditContactDialog] = useState(false)
  const [editContact, setEditContact] = useState<ContactItem | null>(null)
  const [editContactForm, setEditContactForm] = useState({ name: '', phone: '', customFields: {} as Record<string, string> })
  const [deleteContactConfirm, setDeleteContactConfirm] = useState<string | null>(null)
  const [quickImportOpen, setQuickImportOpen] = useState(false)
  const [quickImportName, setQuickImportName] = useState('')
  const [quickImportFile, setQuickImportFile] = useState<File | null>(null)
  const [quickImporting, setQuickImporting] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  // DnD sensors for contact reorder
  const contactDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/contact-lists')
      const data = await res.json()
      setContactLists(data)
    } catch { toast.error('Erro ao carregar listas') }
    finally { setLoading(false) }
  }, [])

  const refreshSelectedList = useCallback(async (listId: string) => {
    try {
      const listRes = await fetch(`/api/contact-lists/${listId}`)
      if (listRes.ok) {
        const freshList = await listRes.json()
        setSelectedList(prev => prev?.id === listId ? freshList : prev)
      }
    } catch { /* ignore */ }
  }, [])

  const fetchContacts = useCallback(async (listId: string, page = 1) => {
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('search', searchQuery)
      params.set('page', String(page))
      params.set('limit', String(CONTACTS_PER_PAGE))
      const res = await fetch(`/api/contact-lists/${listId}/contacts?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar contatos')
      const list = Array.isArray(data) ? data : data.contacts || []
      setContacts(list)
      setTotalContacts(data.total ?? list.length)
      setContactsPage(page)
    } catch { toast.error('Erro ao carregar contatos') }
  }, [searchQuery])

  const handleContactDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !selectedList) return

    const oldIndex = contacts.findIndex(c => c.id === active.id)
    const newIndex = contacts.findIndex(c => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    // Optimistically update UI
    const reordered = arrayMove(contacts, oldIndex, newIndex)
    setContacts(reordered)

    // Persist to server
    try {
      await fetch(`/api/contact-lists/${selectedList.id}/contacts/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: reordered.map(c => c.id) }),
      })
    } catch {
      toast.error('Erro ao reordenar')
      fetchContacts(selectedList.id, contactsPage) // Revert on error
    }
  }

  const bulkDeleteContacts = async () => {
    if (selectedContactIds.size === 0 || !selectedList) return
    try {
      const res = await fetch('/api/contacts/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: Array.from(selectedContactIds) }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast.success(`${data.deleted} contatos removidos!`)
      setSelectedContactIds(new Set())
      setBulkDeleteConfirm(false)
      fetchContacts(selectedList.id, contactsPage)
      refreshSelectedList(selectedList.id)
    } catch {
      toast.error('Erro ao excluir contatos')
    }
  }

  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedContactIds.size === contacts.length && contacts.length > 0) {
      setSelectedContactIds(new Set())
    } else {
      setSelectedContactIds(new Set(contacts.map(c => c.id)))
    }
  }

  useEffect(() => {
    fetchLists()
    const interval = setInterval(fetchLists, isVisible ? 30000 : 120000)
    return () => clearInterval(interval)
  }, [fetchLists])
  useEffect(() => { if (selectedList) fetchContacts(selectedList.id, 1) }, [selectedList, fetchContacts])

  const createList = async () => {
    try {
      const res = await fetch('/api/contact-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newListName }) })
      if (!res.ok) throw new Error()
      toast.success('Lista criada!')
      setAddListDialog(false)
      setNewListName('')
      fetchLists()
    } catch { toast.error('Erro ao criar lista') }
  }

  const deleteList = async (id: string) => {
    try { await fetch(`/api/contact-lists/${id}`, { method: 'DELETE' }); toast.success('Lista removida!'); setSelectedList(null); fetchLists() }
    catch { toast.error('Erro ao remover lista') }
  }

  const addContact = async () => {
    if (!selectedList) return
    try {
      const res = await fetch(`/api/contact-lists/${selectedList.id}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newContact.name,
          phone: newContact.phone,
          customFields: newContact.customFields,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Contato adicionado!')
      setAddContactDialog(false)
      setNewContact({ name: '', phone: '', customFields: {} })
      fetchContacts(selectedList.id)
    } catch { toast.error('Erro ao adicionar contato') }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedList || !e.target.files?.[0]) return
    const formData = new FormData()
    formData.append('file', e.target.files[0])
    try {
      const res = await fetch(`/api/contact-lists/${selectedList.id}/import`, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao importar')
      const colInfo = data.columnMapping ? ` | Colunas: ${Object.keys(data.columnMapping).join(', ')}` : ''
      toast.success(`${data.imported} contatos importados!${colInfo}`)
      setImportDialogOpen(false)
      // Refresh the selected list to get updated columns mapping
      await refreshSelectedList(selectedList.id)
      fetchContacts(selectedList.id)
      fetchLists()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar contatos')
    }
  }

  const openEditContact = (contact: ContactItem) => {
    setEditContact(contact)
    let cf: Record<string, string> = {}
    if (contact.customFields) {
      try { cf = JSON.parse(contact.customFields) } catch { /* ignore */ }
    }
    setEditContactForm({ name: contact.name, phone: contact.phone, customFields: cf })
    setEditContactDialog(true)
  }

  const saveEditContact = async () => {
    if (!editContact) return
    try {
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editContactForm.name,
          phone: editContactForm.phone,
          customFields: Object.keys(editContactForm.customFields).length > 0 ? editContactForm.customFields : undefined,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Contato atualizado!')
      setEditContactDialog(false)
      if (selectedList) fetchContacts(selectedList.id)
    } catch { toast.error('Erro ao atualizar contato') }
  }

  const deleteContact = async (id: string) => {
    try {
      await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
      toast.success('Contato removido!')
      if (selectedList) fetchContacts(selectedList.id)
    } catch { toast.error('Erro ao remover contato') }
  }

  // Quick import: create list + import file in one step
  const handleQuickImport = async () => {
    if (!quickImportName.trim() || !quickImportFile) return
    setQuickImporting(true)
    try {
      // 1. Create list
      toast.loading('Criando lista...', { id: 'quick-import' })
      const listRes = await fetch('/api/contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quickImportName.trim() }),
      })
      const listData = await listRes.json()
      if (!listRes.ok) {
        toast.dismiss('quick-import')
        throw new Error(listData.error || 'Erro ao criar lista')
      }

      // 2. Import file into the new list
      toast.loading('Importando contatos...', { id: 'quick-import' })
      const formData = new FormData()
      formData.append('file', quickImportFile)
      const importRes = await fetch(`/api/contact-lists/${listData.id}/import`, {
        method: 'POST',
        body: formData,
      })
      const importData = await importRes.json()
      if (!importRes.ok) {
        toast.dismiss('quick-import')
        throw new Error(importData.error || 'Erro ao importar')
      }

      const colInfo = importData.columnMapping ? ` | Colunas: ${Object.keys(importData.columnMapping).join(', ')}` : ''
      toast.success(`Lista "${quickImportName}" criada com ${importData.imported} contatos!${colInfo}`, { id: 'quick-import', duration: 5000 })
      setQuickImportOpen(false)
      setQuickImportName('')
      setQuickImportFile(null)
      await fetchLists()
      // Re-fetch the list to get updated columns mapping after import
      await refreshSelectedList(listData.id)
      if (!selectedList) setSelectedList(listData)
      // Small delay to ensure DB is synced before fetching contacts
      setTimeout(() => fetchContacts(listData.id), 500)
    } catch (err: any) {
      console.error('Quick import error:', err)
      toast.error(err.message || 'Erro na importação', { duration: 8000 })
    } finally {
      setQuickImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Lista de Contatos</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas listas e contatos</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={() => {
            const a = document.createElement('a')
            a.href = '/templates/modelo_contatos.xlsx'
            a.download = 'modelo_contato_octupuszap.xlsx'
            a.click()
            toast.success('Planilha XLSX baixada!')
          }}>
            <Download className="size-4" /> Baixar Modelo
          </Button>
          <Button variant="outline" className="gap-2" onClick={async () => {
            try {
              const res = await fetch('/api/templates/download?format=csv')
              const csv = await res.text()
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              window.open('https://docs.google.com/spreadsheets/create', '_blank')
              const a = document.createElement('a')
              a.href = url
              a.download = 'modelo_contato_octupuszap.csv'
              a.click()
              URL.revokeObjectURL(url)
              toast.success('CSV baixado! No Google Sheets: Arquivo → Importar → Enviar', { duration: 8000 })
            } catch { toast.error('Erro ao gerar CSV') }
          }}>
            <FileSpreadsheet className="size-4" /> Google Sheets
          </Button>
          <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg" onClick={() => setQuickImportOpen(true)}>
            <Upload className="size-4" /> Importar Planilha
          </Button>
          <Dialog open={addListDialog} onOpenChange={setAddListDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="size-4" /> Nova Lista
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Criar Lista de Contatos</DialogTitle><DialogDescription>Dê um nome para sua nova lista</DialogDescription></DialogHeader>
              <div className="py-4">
                <Label>Nome da Lista</Label>
                <Input placeholder="Ex: Leads Black Friday" value={newListName} onChange={e => setNewListName(e.target.value)} className="mt-2" />
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={createList} disabled={!newListName} className="bg-emerald-600 hover:bg-emerald-700">Criar Lista</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : selectedList ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedList(null)} className="gap-1.5">
              <ArrowLeft className="size-4" /> Voltar
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <h3
              contentEditable={true}
              suppressContentEditableWarning={true}
              onBlur={async (e) => {
                const newName = e.currentTarget.textContent?.trim()
                if (newName && newName !== selectedList!.name) {
                  try {
                    await fetch(`/api/contact-lists/${selectedList!.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: newName }),
                    })
                    setSelectedList({ ...selectedList!, name: newName })
                    fetchLists()
                    toast.success('Nome atualizado!')
                  } catch { toast.error('Erro ao renomear lista') }
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
              className="text-lg font-semibold outline-none border-b border-transparent hover:border-muted-foreground/30 focus:border-primary px-1 rounded cursor-text"
              title="Clique para editar o nome"
            >{selectedList.name}</h3>
            <Badge variant="secondary">{totalContacts} contatos</Badge>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar contatos..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <Button variant="outline" className="gap-1.5" onClick={() => setAddContactDialog(true)}>
              <UserPlus className="size-4" /> Adicionar
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setImportDialogOpen(true)}>
              <Upload className="size-4" /> Importar Planilha
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => {
              if (!selectedList) return
              const doExport = async () => {
                try {
                  // Fetch ALL contacts for export (paginate through all pages)
                  const allExported: any[] = []
                  let exportPage = 1
                  const exportLimit = 200
                  let hasMore = true
                  while (hasMore) {
                    const res = await fetch(`/api/contact-lists/${selectedList.id}/contacts?page=${exportPage}&limit=${exportLimit}`)
                    const exportContacts = await res.json()
                    const pageList = Array.isArray(exportContacts) ? exportContacts : exportContacts.contacts || []
                    allExported.push(...pageList)
                    hasMore = pageList.length >= exportLimit
                    exportPage++
                  }
                  if (allExported.length === 0) { toast.error('Nenhum contato para exportar'); return }
                  const allCustomKeys = new Set<string>()
                  allExported.forEach((c: any) => {
                    if (c.customFields) {
                      try { Object.keys(JSON.parse(c.customFields)).forEach(k => allCustomKeys.add(k)) } catch {}
                    }
                  })
                  const headers = ['Nome', 'Telefone', ...Array.from(allCustomKeys).sort()]
                  const rows = allExported.map((c: any) => {
                    let cf: Record<string, string> = {}
                    if (c.customFields) { try { cf = JSON.parse(c.customFields) } catch {} }
                    return [c.name || '', c.phone || '', ...Array.from(allCustomKeys).sort().map(k => cf[k] || '')]
                  })
                  const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n')
                  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${selectedList.name}_contatos.csv`
                  a.click()
                  URL.revokeObjectURL(url)
                  toast.success(`${allExported.length} contatos exportados!`)
                } catch { toast.error('Erro ao exportar contatos') }
              }
              doExport()
            }}>
              <Download className="size-4" /> Exportar
            </Button>
          </div>

          {contacts.length === 0 ? (
            <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="size-10 text-muted-foreground mb-3" />
                <p className="font-semibold">Nenhum contato nesta lista</p>
                <p className="text-sm text-muted-foreground mb-4">Importe uma planilha ou adicione manualmente</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="gap-1.5" onClick={() => setImportDialogOpen(true)}>
                    <Upload className="size-4" /> Importar Planilha
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={() => setAddContactDialog(true)}>
                    <UserPlus className="size-4" /> Adicionar Contato
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-lg border-0">
              <CardContent className="p-0 flex flex-col" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                {/* Fixed header */}
                <div className="overflow-hidden bg-muted/50 border-b shrink-0 pr-[17px]">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-[40px]" />
                      <col className="w-[36px]" />
                      {STANDARD_CONTACT_FIELDS.map(f => (
                        <col key={f.key} className={f.core ? 'w-[18%]' : 'w-[12%]'} />
                      ))}
                      <col className="w-[16%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="p-3 w-[40px]">
                          <input type="checkbox" checked={selectedContactIds.size === contacts.length && contacts.length > 0} onChange={toggleSelectAll} className="size-4 rounded border-gray-300" />
                        </th>
                        <th className="p-3 w-[36px]"></th>
                        {STANDARD_CONTACT_FIELDS.map(f => (
                          <th key={f.key} className="text-left p-3 font-medium truncate">{f.header}</th>
                        ))}
                        <th className="text-left p-3 font-medium">Incluído em</th>
                        <th className="text-left p-3 font-medium">Ações</th>
                      </tr>
                    </thead>
                  </table>
                </div>
                {/* Bulk action toolbar */}
                {selectedContactIds.size > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border-b shrink-0">
                    <span className="text-sm font-medium">{selectedContactIds.size} selecionado(s)</span>
                    <Button variant="outline" size="sm" onClick={() => setSelectedContactIds(new Set())}>
                      Desmarcar todos
                    </Button>
                    <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setBulkDeleteConfirm(true)}>
                      <Trash2 className="size-3.5" /> Excluir selecionados
                    </Button>
                  </div>
                )}
                {/* Scrollable body with DnD */}
                <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                  <DndContext sensors={contactDragSensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleContactDragEnd}>
                    <SortableContext items={contacts.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                      <table className="w-full text-sm table-fixed">
                        <colgroup>
                          <col className="w-[40px]" />
                          <col className="w-[36px]" />
                          {STANDARD_CONTACT_FIELDS.map(f => (
                            <col key={f.key} className={f.core ? 'w-[18%]' : 'w-[12%]'} />
                          ))}
                          <col className="w-[16%]" />
                          <col className="w-[8%]" />
                        </colgroup>
                        <tbody>
                          {contacts.map(c => {
                            let customData: Record<string, string> = {}
                            if (c.customFields) {
                              try { customData = JSON.parse(c.customFields) } catch {}
                            }
                            return (
                              <SortableContactRow
                                key={c.id}
                                contact={c}
                                isSelected={selectedContactIds.has(c.id)}
                                onToggleSelect={() => toggleContactSelection(c.id)}
                                onEdit={() => openEditContact(c)}
                                onDelete={() => setDeleteContactConfirm(c.id)}
                                customData={customData}
                              />
                            )
                          })}
                        </tbody>
                      </table>
                    </SortableContext>
                  </DndContext>
                </div>
                {/* Pagination footer */}
                {totalContacts > CONTACTS_PER_PAGE && (
                  <div className="flex items-center justify-between px-4 py-3 border-t bg-background shrink-0">
                    <span className="text-sm text-muted-foreground">
                      {Math.min((contactsPage - 1) * CONTACTS_PER_PAGE + 1, totalContacts)}–{Math.min(contactsPage * CONTACTS_PER_PAGE, totalContacts)} de {totalContacts}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={contactsPage <= 1}
                        onClick={() => selectedList && fetchContacts(selectedList.id, contactsPage - 1)}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={contactsPage * CONTACTS_PER_PAGE >= totalContacts}
                        onClick={() => selectedList && fetchContacts(selectedList.id, contactsPage + 1)}
                      >
                        Próximo
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contactLists.map((list, i) => (
            <motion.div key={list.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="shadow-lg hover:shadow-xl transition-all duration-200 cursor-pointer border-0" onClick={() => { setSelectedList(list); fetchContacts(list.id) }}>
                <CardHeader>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
                      <LayoutList className="size-5 text-sky-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate text-base">{list.name}</CardTitle>
                      <CardDescription>{list._count?.contacts || 0} contatos</CardDescription>
                    </div>
                    <TooltipProvider><Tooltip><TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(list.id) }}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger><TooltipContent>Excluir lista</TooltipContent></Tooltip></TooltipProvider>
                  </div>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
          {contactLists.length === 0 && (
            <EmptyState
              icon={Users}
              title="Nenhuma lista criada"
              description="Crie uma lista para organizar seus contatos e facilitar o envio de campanhas."
              action={{ label: 'Criar primeira lista', onClick: () => setAddListDialog(true) }}
              className="col-span-full"
            />
          )}
        </div>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Lista" description="Tem certeza? Todos os contatos serão removidos."
        onConfirm={() => { if (deleteConfirm) deleteList(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      <ConfirmDialog open={!!deleteContactConfirm} onOpenChange={() => setDeleteContactConfirm(null)}
        title="Remover Contato" description="Tem certeza que deseja remover este contato?"
        onConfirm={() => { if (deleteContactConfirm) deleteContact(deleteContactConfirm) }} confirmLabel="Remover" variant="destructive" />

      <ConfirmDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}
        title="Excluir Contatos" description={`Tem certeza que deseja excluir ${selectedContactIds.size} contato(s)? Esta ação não pode ser desfeita.`}
        onConfirm={bulkDeleteContacts} confirmLabel="Excluir" variant="destructive" />

      {/* Edit Contact Dialog */}
      <Dialog open={editContactDialog} onOpenChange={setEditContactDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>Editar Contato</DialogTitle><DialogDescription>Atualize as informações do contato</DialogDescription></DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2"><Label>Nome</Label><Input value={editContactForm.name} onChange={e => setEditContactForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={editContactForm.phone} onChange={e => setEditContactForm(p => ({ ...p, phone: e.target.value }))} /></div>
            {STANDARD_CONTACT_FIELDS.filter(f => !f.core).map(f => (
              <div key={f.key} className="space-y-2">
                <Label>{f.header}</Label>
                <Input value={editContactForm.customFields[f.key] || ''} onChange={e => setEditContactForm(p => ({ ...p, customFields: { ...p.customFields, [f.key]: e.target.value } }))} />
              </div>
            ))}
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveEditContact} disabled={!editContactForm.name || !editContactForm.phone} className="bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Contact Dialog */}
      <Dialog open={addContactDialog} onOpenChange={(open) => { setAddContactDialog(open); if (!open) setNewContact({ name: '', phone: '', customFields: {} }) }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>Adicionar Contato</DialogTitle><DialogDescription>Adicione um contato manualmente à lista{selectedList ? ` "${selectedList.name}"` : ''}</DialogDescription></DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2"><Label>Nome</Label><Input placeholder="Ex: João Silva" value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input placeholder="Ex: 48999990001" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} /></div>
            {STANDARD_CONTACT_FIELDS.filter(f => !f.core).map(f => (
              <div key={f.key} className="space-y-2">
                <Label>{f.header}</Label>
                <Input placeholder={`Ex: valor para ${f.header}`} value={newContact.customFields[f.key] || ''} onChange={e => setNewContact(p => ({ ...p, customFields: { ...p.customFields, [f.key]: e.target.value } }))} />
              </div>
            ))}
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={addContact} disabled={!newContact.name || !newContact.phone} className="bg-emerald-600 hover:bg-emerald-700">Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog (inside a list) */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Importar Planilha</DialogTitle><DialogDescription>Importe contatos de um arquivo CSV, Excel ou ODS</DialogDescription></DialogHeader>
          <div className="py-4 space-y-4">
            <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-emerald-400 transition-colors">
              <Upload className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">Arraste o arquivo aqui</p>
              <p className="text-sm text-muted-foreground mb-3">CSV, Excel (.xlsx, .xls) ou LibreOffice (.ods)</p>
              <Input type="file" accept=".csv,.xlsx,.xls,.ods" onChange={handleImport} className="max-w-xs mx-auto" />
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-3">
              <p className="font-medium">Formato da planilha:</p>
              <p className="text-muted-foreground">Uma coluna de <strong>Telefone/WhatsApp</strong> é obrigatória (aceita: Telefone, WhatsApp, Celular, Tel, Phone, Numero). A coluna <strong>Nome</strong> é recomendada. As demais colunas ficam disponíveis automaticamente como variáveis (ex: coluna "Empresa" vira {'{{empresa}}'}, coluna "Vendedora" vira {'{{vendedora}}'}). Adicione quantas colunas quiser!</p>
              <code className="block bg-muted p-2 rounded text-[11px]">Nome,WhatsApp,Empresa,Vendedora{'\n'}Maria,5511999990001,Tech Corp,Ana{'\n'}Julia,5521988880002,Info Ltda,Carla</code>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Import Dialog — create list + import in one step */}
      <Dialog open={quickImportOpen} onOpenChange={(open) => { setQuickImportOpen(open); if (!open) { setQuickImportName(''); setQuickImportFile(null) } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Importar Planilha</DialogTitle><DialogDescription>Crie uma lista e importe contatos em um passo só</DialogDescription></DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">Nome da Lista <span className="text-rose-500 text-sm">*</span></Label>
              <Input placeholder="Ex: Leads Black Friday (obrigatório)" value={quickImportName} onChange={e => setQuickImportName(e.target.value)} className={!quickImportName.trim() && quickImportFile ? 'border-amber-400 focus:border-amber-500' : ''} />
              {!quickImportName.trim() && quickImportFile && (
                <p className="text-xs text-amber-600 font-medium">⚠ Preencha o nome da lista para ativar o botão de importação</p>
              )}
            </div>
            <div className="border-2 border-dashed rounded-xl p-6 text-center hover:border-emerald-400 transition-colors">
              {quickImportFile ? (
                <div className="flex items-center gap-3 justify-center">
                  <FileSpreadsheet className="size-8 text-emerald-500" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{quickImportFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(quickImportFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="ghost" size="sm" className="ml-2" onClick={() => setQuickImportFile(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="size-8 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">Selecione o arquivo</p>
                  <p className="text-sm text-muted-foreground mb-3">CSV, Excel (.xlsx, .xls) ou LibreOffice (.ods)</p>
                </>
              )}
              <Input type="file" accept=".csv,.xlsx,.xls,.ods" onChange={e => {
                const file = e.target.files?.[0] || null
                setQuickImportFile(file)
                // Auto-fill list name from filename if field is empty
                if (file && !quickImportName.trim()) {
                  const nameFromFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
                  setQuickImportName(nameFromFile)
                }
              }} className="max-w-xs mx-auto" />
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-2">
              <p className="font-medium">Não tem uma planilha?</p>
              <p className="text-muted-foreground">Baixe o modelo, preencha com seus dados e importe. Qualquer coluna que você adicionar vira uma variável automática!</p>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={() => {
                  const a = document.createElement('a')
                  a.href = '/templates/modelo_contatos.xlsx'
                  a.download = 'modelo_contato_octupuszap.xlsx'
                  a.click()
                  toast.success('Modelo XLSX baixado!')
                }}>
                  <Download className="size-3" /> Baixar XLSX
                </Button>
                <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={async () => {
                  try {
                    const res = await fetch('/api/templates/download?format=csv')
                    const csv = await res.text()
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    window.open('https://docs.google.com/spreadsheets/create', '_blank')
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'modelo_contato_octupuszap.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                    toast.success('CSV baixado! No Google Sheets: Arquivo → Importar → Enviar', { duration: 8000 })
                  } catch { toast.error('Erro ao gerar CSV') }
                }}>
                  <FileSpreadsheet className="size-3" /> Google Sheets
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {!quickImportFile && !quickImportName.trim() && (
              <p className="text-xs text-amber-600 text-center font-medium">⚠ Preencha o nome da lista e selecione um arquivo para importar</p>
            )}
            {quickImportFile && !quickImportName.trim() && (
              <p className="text-xs text-amber-600 text-center font-medium">⚠ Digite um nome para a lista acima</p>
            )}
            {!quickImportFile && quickImportName.trim() && (
              <p className="text-xs text-amber-600 text-center font-medium">⚠ Selecione um arquivo para importar</p>
            )}
            <div className="flex gap-2 w-full justify-end">
              <DialogClose asChild><Button variant="outline" disabled={quickImporting}>Cancelar</Button></DialogClose>
              <Button onClick={handleQuickImport} disabled={!quickImportName.trim() || !quickImportFile || quickImporting} className="bg-emerald-600 hover:bg-emerald-700 gap-2 min-w-[200px]">
                {quickImporting ? <><RefreshCw className="size-4 animate-spin" /> Importando...</> : <><Upload className="size-4" /> Criar Lista e Importar</>}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

