'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: AdminUserItem interface, UsuariosTab, AuditLogSection (AuditLogSection is
// rendered inside UsuariosTab's JSX).

import { useState, useEffect, useCallback } from 'react'
import {
  Database, Pencil, Plus, RefreshCw, Search, Trash2, Type, User, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/shared'
import { useIsVisible } from '@/components/shared/use-is-visible'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

// ===== Usuários Tab =====
interface AdminUserItem {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  twoFactorEnabled: boolean
  imagem: string
  isSystemUser: boolean
  createdAt: string
  updatedAt: string
}

export function UsuariosTab() {
  const isVisible = useIsVisible()
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminUserItem | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'operador', active: true, isSystemUser: false })
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', active: true, password: '', isSystemUser: false })

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error('Erro ao carregar usuários')
      const data = await res.json()
      setUsers(data)
    } catch {
      toast.error('Erro ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
    const interval = setInterval(fetchUsers, isVisible ? 30000 : 300000)
    return () => clearInterval(interval)
  }, [fetchUsers])

  const createUser = async () => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar usuário')
      toast.success('Usuário criado com sucesso!')
      setAddDialogOpen(false)
      setNewUser({ name: '', email: '', password: '', role: 'operador', active: true, isSystemUser: false })
      fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao criar usuário')
    }
  }

  const updateUser = async () => {
    if (!selectedUser) return
    try {
      const updateData: Record<string, any> = {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        active: editForm.active,
        isSystemUser: editForm.isSystemUser,
      }
      if (editForm.password) updateData.password = editForm.password

      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao atualizar usuário')
      toast.success('Usuário atualizado com sucesso!')
      setEditDialogOpen(false)
      setSelectedUser(null)
      fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao atualizar usuário')
    }
  }

  const deleteUser = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir usuário')
      toast.success('Usuário excluído com sucesso!')
      fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao excluir usuário')
    }
  }

  const openEditDialog = (user: AdminUserItem) => {
    setSelectedUser(user)
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      password: '',
      isSystemUser: user.isSystemUser,
    })
    setEditDialogOpen(true)
  }

  const roleLabel = (role: string) => {
    const map: Record<string, string> = { master: 'Master', admin: 'Admin', operador: 'Operador' }
    return map[role] || role
  }

  const roleBadgeColor = (role: string) => {
    const map: Record<string, string> = {
      master: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
      admin: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
      operador: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
    }
    return map[role] || ''
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const masterCount = users.filter(u => u.role === 'master' && u.active).length
  const adminCount = users.filter(u => u.role === 'admin' && u.active).length
  const operadorCount = users.filter(u => u.role === 'operador' && u.active).length
  const inactiveCount = users.filter(u => !u.active).length

  if (loading) {
    return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Usuários</h2>
          <p className="text-sm text-muted-foreground">Gerencie os usuários do sistema</p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
          onClick={() => setAddDialogOpen(true)}>
          <Plus className="size-4" /> Novo Usuário
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-violet-600">{masterCount}</p>
            <p className="text-xs text-muted-foreground">Masters ativos</p>
          </CardContent>
        </Card>
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-sky-600">{adminCount}</p>
            <p className="text-xs text-muted-foreground">Admins ativos</p>
          </CardContent>
        </Card>
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-zinc-600 dark:text-zinc-400">{operadorCount}</p>
            <p className="text-xs text-muted-foreground">Operadores ativos</p>
          </CardContent>
        </Card>
        <Card className="shadow-md border-0">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-rose-600">{inactiveCount}</p>
            <p className="text-xs text-muted-foreground">Inativos</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, email ou papel..." value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
      </div>

      {/* Users List */}
      <Card className="shadow-lg border-0">
        <CardContent className="p-0">
          <ScrollArea className="max-h-[500px]">
          <div className="divide-y">
            {filteredUsers.map(user => (
              <div key={user.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                <div className={`flex size-10 items-center justify-center rounded-full ${
                  user.role === 'master' ? 'bg-gradient-to-br from-violet-400 to-purple-500' :
                  user.role === 'admin' ? 'bg-gradient-to-br from-sky-400 to-blue-500' :
                  'bg-gradient-to-br from-zinc-400 to-zinc-500'
                } shadow-md`}>
                  <span className="text-sm font-bold text-white">{user.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{user.name}</p>
                    {user.isSystemUser && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">Sistema</Badge>
                    )}
                    {!user.active && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inativo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                </div>
                <Badge className={roleBadgeColor(user.role)}>{roleLabel(user.role)}</Badge>
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditDialog(user)}>
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          onClick={() => setDeleteConfirm(user.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Excluir</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Users className="size-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhum usuário encontrado</p>
              </div>
            )}
          </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription>Crie um novo usuário no sistema</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Nome completo" value={newUser.name}
                onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" placeholder="email@exemplo.com" value={newUser.email}
                onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Senha</Label>
              <Input type="password" placeholder="Mínimo 6 caracteres" value={newUser.password}
                onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={newUser.role} onValueChange={v => setNewUser(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master — Acesso total</SelectItem>
                  <SelectItem value="admin">Admin — Operações + Anti-Ban</SelectItem>
                  <SelectItem value="operador">Operador — Envio e monitoramento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newUser.active} onCheckedChange={v => setNewUser(p => ({ ...p, active: v }))} />
              <Label>Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newUser.isSystemUser} onCheckedChange={v => setNewUser(p => ({ ...p, isSystemUser: v }))} />
              <Label>Usuário de sistema</Label>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600"
              onClick={createUser} disabled={!newUser.name || !newUser.email || !newUser.password}>
              <Plus className="size-4" /> Criar Usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden !p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>Altere os dados do usuário</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" placeholder="Deixe vazio para manter a atual" value={editForm.password}
                onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master — Acesso total</SelectItem>
                  <SelectItem value="admin">Admin — Operações + Anti-Ban</SelectItem>
                  <SelectItem value="operador">Operador — Envio e monitoramento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editForm.active} onCheckedChange={v => setEditForm(p => ({ ...p, active: v }))} />
              <Label>Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editForm.isSystemUser} onCheckedChange={v => setEditForm(p => ({ ...p, isSystemUser: v }))} />
              <Label>Usuário de sistema</Label>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600" onClick={updateUser}>
              <Pencil className="size-4" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Excluir Usuário" description="Tem certeza? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) { deleteUser(deleteConfirm); setDeleteConfirm(null) } }}
        confirmLabel="Excluir" />

      {/* Audit Log */}
      <AuditLogSection />
    </div>
  )
}

// ===== Audit Log Section =====
function AuditLogSection() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/audit-logs?limit=50')
      const data = await res.json()
      setLogs(data.logs || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const filtered = filter ? logs.filter(l =>
    l.action?.toLowerCase().includes(filter.toLowerCase()) ||
    l.userName?.toLowerCase().includes(filter.toLowerCase()) ||
    l.targetType?.toLowerCase().includes(filter.toLowerCase())
  ) : logs

  const actionColors: Record<string, string> = {
    CREATE: 'text-emerald-600',
    UPDATE: 'text-sky-600',
    DELETE: 'text-rose-600',
    PAUSE: 'text-amber-600',
    RESUME: 'text-emerald-600',
    CONNECT: 'text-violet-600',
    DISCONNECT: 'text-orange-600',
  }

  const getActionColor = (action: string) => {
    for (const [key, color] of Object.entries(actionColors)) {
      if (action.startsWith(key)) return color
    }
    return 'text-muted-foreground'
  }

  return (
    <Card className="shadow-lg border-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-900/30">
              <Database className="size-4 text-slate-600" />
            </div>
            <CardTitle className="text-lg">Log de Auditoria</CardTitle>
          </div>
          <Input
            placeholder="Filtrar por ação, usuário..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 w-56 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Database className="size-8 mb-2 opacity-50" />
            <p className="text-sm">Nenhum log de auditoria ainda</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-thin">
            {filtered.map((log) => (
              <div key={log.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-sm">
                <span className={cn('font-mono font-semibold shrink-0 w-32', getActionColor(log.action))}>
                  {log.action}
                </span>
                <span className="text-muted-foreground shrink-0 w-32 truncate">
                  {log.userName || 'Sistema'}
                </span>
                <span className="text-foreground/70 truncate flex-1">
                  {log.targetType ? log.targetType : ''}
                  {log.targetId ? ': ' + log.targetId.substring(0, 8) + '...' : ''}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(log.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

