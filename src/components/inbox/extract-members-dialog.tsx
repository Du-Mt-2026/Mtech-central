'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Users, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface ExtractMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chipId: string
  chipName: string
  groupJid: string
  groupName: string
  onExtracted?: (contactListId: string) => void
}

interface ExtractResult {
  success: boolean
  contactListId?: string
  contactListName?: string
  groupName?: string
  stats?: {
    totalParticipants: number
    extracted: number
    duplicates: number
    skippedNoPhone: number
    skippedAdmin: number
  }
  error?: string
}

export function ExtractMembersDialog({
  open, onOpenChange, chipId, chipName, groupJid, groupName, onExtracted,
}: ExtractMembersDialogProps) {
  const [listName, setListName] = useState(
    `Membros — ${groupName} — ${new Date().toLocaleDateString('pt-BR')}`
  )
  const [excludeAdmins, setExcludeAdmins] = useState(false)
  const [onlyWithPhone, setOnlyWithPhone] = useState(true)
  const [dedupAgainstAll, setDedupAgainstAll] = useState(true)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ExtractResult | null>(null)

  const handleExtract = async () => {
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupJid)}/extract-members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chipId,
          contactListName: listName,
          options: { excludeAdmins, onlyWithPhone, dedupAgainstAll },
        }),
      })

      const data: ExtractResult = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao extrair membros')
      }

      setResult(data)
      toast.success(`${data.stats?.extracted} contatos extraídos!`)
      onExtracted?.(data.contactListId!)
    } catch (err: any) {
      console.error('[ExtractMembers]', err)
      toast.error(err.message || 'Erro ao extrair membros')
      setResult({ success: false, error: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setResult(null)
    setListName(`Membros — ${groupName} — ${new Date().toLocaleDateString('pt-BR')}`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            Extrair Membros do Grupo
          </DialogTitle>
          <DialogDescription>
            Extrai todos os membros do grupo <strong>{groupName}</strong> para uma nova lista de contatos.
            Chip usado: <strong>{chipName}</strong>
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="listName">Nome da nova lista</Label>
                <Input
                  id="listName"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="Ex: Membros do Grupo XYZ — 15/07"
                  disabled={loading}
                />
              </div>

              <div className="space-y-3">
                <Label>Opções de extração</Label>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="onlyWithPhone"
                    checked={onlyWithPhone}
                    onCheckedChange={(v) => setOnlyWithPhone(v === true)}
                    disabled={loading}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="onlyWithPhone" className="cursor-pointer text-sm font-normal">
                      Apenas contatos com telefone válido
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Ignora membros que só têm LID (sem telefone@s.whatsapp.net). Recomendado.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="dedupAgainstAll"
                    checked={dedupAgainstAll}
                    onCheckedChange={(v) => setDedupAgainstAll(v === true)}
                    disabled={loading}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="dedupAgainstAll" className="cursor-pointer text-sm font-normal">
                      Deduplicar contra todos os contatos existentes
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Não importa contatos que já existem no banco (qualquer lista).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="excludeAdmins"
                    checked={excludeAdmins}
                    onCheckedChange={(v) => setExcludeAdmins(v === true)}
                    disabled={loading}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="excludeAdmins" className="cursor-pointer text-sm font-normal">
                      Excluir administradores do grupo
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Pula admins do grupo (você provavelmente não quer disparar pros donos).
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 flex gap-2">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Limite recomendado: 1 extração por grupo por dia.
                  Extrações frequentes podem ser detectadas pelo WhatsApp.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={handleClose} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={handleExtract} disabled={loading || !listName.trim()}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Extraindo...
                  </>
                ) : (
                  <>
                    <Users className="size-4 mr-2" />
                    Extrair Membros
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="py-4 space-y-4">
              {result.success && result.stats ? (
                <>
                  <div className="flex flex-col items-center text-center py-4">
                    <CheckCircle2 className="size-12 text-emerald-600 mb-3" />
                    <h3 className="text-lg font-semibold">Extração concluída!</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Lista <strong>{result.contactListName}</strong> criada com sucesso.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border p-3">
                      <div className="text-2xl font-bold text-emerald-600">
                        {result.stats.extracted}
                      </div>
                      <div className="text-xs text-muted-foreground">Novos contatos</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-2xl font-bold text-blue-600">
                        {result.stats.duplicates}
                      </div>
                      <div className="text-xs text-muted-foreground">Duplicados (ignorados)</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-2xl font-bold text-muted-foreground">
                        {result.stats.skippedNoPhone}
                      </div>
                      <div className="text-xs text-muted-foreground">Sem telefone</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-2xl font-bold text-muted-foreground">
                        {result.stats.skippedAdmin}
                      </div>
                      <div className="text-xs text-muted-foreground">Admins excluídos</div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground text-center">
                    Total de participantes no grupo: <strong>{result.stats.totalParticipants}</strong>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center text-center py-4">
                  <XCircle className="size-12 text-rose-600 mb-3" />
                  <h3 className="text-lg font-semibold">Falha na extração</h3>
                  <p className="text-sm text-muted-foreground mt-1">{result.error}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
