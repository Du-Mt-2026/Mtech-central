'use client'

import { Badge } from '@/components/ui/badge'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'

export function statusColor(status: string) {
  const map: Record<string, string> = {
    connected: 'bg-emerald-500', connecting: 'bg-amber-500', disconnected: 'bg-zinc-400', error: 'bg-rose-500',
    running: 'bg-emerald-500', draft: 'bg-zinc-400', scheduled: 'bg-amber-500', paused: 'bg-amber-500', completed: 'bg-sky-500', cancelled: 'bg-rose-400',
    pending: 'bg-zinc-400', sent: 'bg-sky-500', delivered: 'bg-emerald-500', read: 'bg-teal-500', failed: 'bg-rose-500',
    quarantined: 'bg-orange-500',
  }
  return map[status] || 'bg-zinc-400'
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    connected: 'Conectado', connecting: 'Conectando', disconnected: 'Desconectado', error: 'Erro',
    running: 'Executando', draft: 'Rascunho', scheduled: 'Agendada', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada',
    pending: 'Pendente', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falhou',
    quarantined: 'Quarentena',
  }
  return map[status] || status
}

export function StatusBadge({ status }: { status: string }) {
  const isDestructive = ['error', 'failed'].includes(status)
  const isDefault = ['connected', 'running', 'delivered', 'read', 'completed'].includes(status)
  return (
    <Badge variant={isDestructive ? 'destructive' : isDefault ? 'default' : 'secondary'} className="gap-1">
      <span className={`size-1.5 rounded-full ${statusColor(status)}`} />
      {statusLabel(status)}
    </Badge>
  )
}

export function ConfirmDialog({
  open, onOpenChange, title, description, onConfirm, confirmLabel = 'Confirmar', variant = 'destructive',
}: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string
  onConfirm: () => void; confirmLabel?: string; variant?: 'destructive' | 'default'
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => { onConfirm(); onOpenChange(false) }}
            className={variant === 'destructive' ? 'bg-rose-600 hover:bg-rose-700' : ''}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
