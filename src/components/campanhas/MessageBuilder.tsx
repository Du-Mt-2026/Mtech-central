'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Shuffle, Key, FileText, Plus, Smile, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { type MessageTemplate } from '@/lib/types'
import { CONTACT_VARIABLES, EMOJI_LIST, parseKeyBlocksFromText, generatePreviewText } from './shared'

export function MessageBuilder({ value, onChange, messageKeys, templates, contactVariables, previewContactData, rows = 3 }: {
  value: string
  onChange: (v: string) => void
  messageKeys: Array<{ id: string; name: string; label: string; category: string; variations: string; resolutionType?: string; timeSlots?: string | null }>
  templates?: MessageTemplate[]
  contactVariables?: Array<{ tag: string; label: string; source: string }>
  previewContactData?: { name: string; phone: string; customFields?: string } | null
  rows?: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [newBlockOpen, setNewBlockOpen] = useState(false)
  const [newBlockVariations, setNewBlockVariations] = useState('')
  const [previewSeed, setPreviewSeed] = useState(0)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [emojiSearch, setEmojiSearch] = useState('')

  // Parse KEY blocks from current text
  const keyBlocks = parseKeyBlocksFromText(value)

  // Insert text at cursor position
  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = value.substring(0, start) + text + value.substring(end)
      onChange(newValue)
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + text.length
        textarea.focus()
      }, 0)
    } else {
      onChange(value + text)
    }
  }

  // Insert new KEY block
  const insertNewBlock = () => {
    const lines = newBlockVariations.split('\n').map(l => l.trim()).filter(Boolean)
    // Also support | separator within lines
    const allVariations: string[] = []
    lines.forEach(line => {
      line.split('|').forEach(v => {
        const trimmed = v.trim()
        if (trimmed) allVariations.push(trimmed)
      })
    })
    if (allVariations.length < 2) {
      toast.error('Adicione pelo menos 2 variações separadas por | ou uma por linha')
      return
    }
    const keyBlock = `{{KEY: ${allVariations.join(' | ')}}}`
    insertAtCursor(keyBlock)
    setNewBlockVariations('')
    setNewBlockOpen(false)
  }

  const previewText = generatePreviewText(value, messageKeys, previewSeed, contactVariables, previewContactData)
  const [previewContactList, setPreviewContactList] = useState<Array<{ name: string; phone: string; customFields?: string }>>([])
  const [previewContactIdx, setPreviewContactIdx] = useState(0)

  // Fetch contacts from selected list for preview
  useEffect(() => {
    if (previewContactData) {
      setPreviewContactList([previewContactData])
      setPreviewContactIdx(0)
    } else {
      setPreviewContactList([])
    }
  }, [previewContactData])

  const currentPreviewContact = previewContactList[previewContactIdx] || previewContactData
  const charCount = previewText.length
  const lineCount = value.split('\n').length

  return (
    <div className="space-y-2">
      {/* Variable chips bar */}
      <div className="space-y-1.5 p-2 bg-muted/30 rounded-lg border">
        {/* Contact variables */}
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground font-medium w-full">📋 Dados do Contato</span>
          {(contactVariables && contactVariables.length > 0 ? contactVariables : CONTACT_VARIABLES).map(v => (
            <Button key={v.tag} variant="outline" size="sm"
              className={`h-6 text-[11px] gap-1 px-2 ${
                v.source === 'custom'
                  ? 'text-sky-600 border-sky-200 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-800 dark:hover:bg-sky-900/30'
                  : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30'
              }`}
              onClick={() => insertAtCursor(v.tag)}>
              {v.source === 'custom' ? '📎' : v.tag === '{{nome}}' ? '👤' : v.tag === '{{telefone}}' ? '📱' : '📋'} {v.label}
            </Button>
          ))}
          {(!contactVariables || contactVariables.length === 0) && (
            <span className="text-[9px] text-muted-foreground italic">Selecione uma lista de contatos para ver as variáveis disponíveis</span>
          )}
        </div>
        {/* KEY block chips */}
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground font-medium w-full">🔀 Blocos de Variação</span>
          {keyBlocks.map((block, idx) => {
            const firstVar = block.variations[0] || ''
            const extraCount = block.variations.length - 1
            const truncated = firstVar.length > 25 ? firstVar.slice(0, 25) + '…' : firstVar
            return (
              <Popover key={idx}>
                <PopoverTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
                  >
                    <Shuffle className="size-2.5" />
                    <span className="truncate max-w-[120px]">{truncated}</span>
                    {extraCount > 0 && (
                      <span className="inline-flex items-center justify-center size-4 rounded-full bg-amber-200 text-amber-700 text-[9px] font-bold dark:bg-amber-800 dark:text-amber-200">
                        +{extraCount}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" side="bottom" align="start">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold flex items-center gap-1">
                      <Shuffle className="size-3 text-amber-500" /> Bloco de Variação ({block.variations.length} variações)
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {block.variations.map((v, vi) => (
                        <div key={vi} className="flex items-start gap-2 text-xs p-1.5 rounded bg-muted/50">
                          <span className="text-muted-foreground font-mono shrink-0">{vi + 1}.</span>
                          <span className="break-words">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )
          })}
          {/* Saved keys from Chaves tab */}
          {messageKeys.map(k => {
            let varCount = 0
            try { varCount = JSON.parse(k.variations).length } catch { /* ignore */ }
            return (
              <Popover key={k.id}>
                <PopoverTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50 transition-colors cursor-pointer"
                  >
                    <Key className="size-2.5" />
                    <span className="truncate max-w-[100px]">{k.label}</span>
                    <span className="inline-flex items-center justify-center size-4 rounded-full bg-violet-200 text-violet-700 text-[9px] font-bold dark:bg-violet-800 dark:text-violet-200">
                      {varCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" side="bottom" align="start">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold flex items-center gap-1">
                      <Key className="size-3 text-violet-500" /> {k.label} ({varCount} variações)
                    </p>
                    <p className="text-[10px] text-muted-foreground">Clique para inserir como bloco inline ou como marcador</p>
                    <div className="space-y-1.5">
                      <Button size="sm" className="w-full h-7 text-[11px] gap-1" variant="outline"
                        onClick={() => {
                          try {
                            const vars = JSON.parse(k.variations)
                            if (vars?.length) {
                              insertAtCursor(`{{KEY: ${vars.join(' | ')}}}`)
                            }
                          } catch { /* ignore */ }
                        }}>
                        <Shuffle className="size-3" /> Inserir como Bloco Inline
                      </Button>
                      <Button size="sm" className="w-full h-7 text-[11px] gap-1" variant="outline"
                        onClick={() => insertAtCursor(`{{${k.name}}}`)}>
                        <Key className="size-3" /> Inserir como Marcador
                      </Button>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {(() => {
                        try {
                          return JSON.parse(k.variations).map((v: string, vi: number) => (
                            <div key={vi} className="flex items-start gap-2 text-xs p-1.5 rounded bg-muted/50">
                              <span className="text-muted-foreground font-mono shrink-0">{vi + 1}.</span>
                              <span className="break-words">{v}</span>
                            </div>
                          ))
                        } catch { return null }
                      })()}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )
          })}
          {/* Usar Template button */}
          {templates && templates.length > 0 && (
            <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm"
                  className="h-6 text-[11px] gap-1 px-2 text-sky-600 border-sky-200 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-800 dark:hover:bg-sky-900/30 border-dashed">
                  <FileText className="size-2.5" /> Usar Template
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" side="bottom" align="start">
                <div className="space-y-2">
                  <p className="text-xs font-semibold flex items-center gap-1">
                    <FileText className="size-3 text-sky-500" /> Selecionar Template
                  </p>
                  <Input
                    placeholder="Buscar template..."
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    className="h-7 text-xs"
                  />
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {templates
                      .filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.content.toLowerCase().includes(templateSearch.toLowerCase()))
                      .map(t => (
                        <button
                          key={t.id}
                          className="w-full text-left p-2 rounded-md hover:bg-muted/80 transition-colors group"
                          onClick={() => {
                            onChange(t.content)
                            setTemplatePickerOpen(false)
                            setTemplateSearch('')
                            toast.success(`Template "${t.name}" carregado!`)
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate">{t.name}</span>
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${{
                              'saudação': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                              'vendas': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                              'follow-up': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
                              'pós-venda': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
                              'geral': 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400',
                            }[t.category] || 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400'}`}>{t.category}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{t.content}</p>
                        </button>
                      ))}
                    {templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.content.toLowerCase().includes(templateSearch.toLowerCase())).length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-2">Nenhum template encontrado</p>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {/* + Novo Bloco button */}
          <Popover open={newBlockOpen} onOpenChange={setNewBlockOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm"
                className="h-6 text-[11px] gap-1 px-2 text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/30 border-dashed">
                <Plus className="size-2.5" /> Novo Bloco
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" side="bottom" align="start">
              <div className="space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Shuffle className="size-3 text-amber-500" /> Novo Bloco de Variação
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Digite as variações separadas por <code className="bg-muted px-1 rounded">|</code> ou uma por linha. Pode usar variáveis como {'{{nome}}'} dentro das variações.
                </p>
                <Textarea
                  placeholder={"Oi, bom dia... tudo bem? | Olá, tudo bem? Bom dia... | Bom dia! Tudo bem?"}
                  value={newBlockVariations}
                  onChange={e => setNewBlockVariations(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {(() => {
                      const lines = newBlockVariations.split('\n').map(l => l.trim()).filter(Boolean)
                      const allVars: string[] = []
                      lines.forEach(line => {
                        line.split('|').forEach(v => {
                          const t = v.trim()
                          if (t) allVars.push(t)
                        })
                      })
                      return allVars.length > 0 ? `${allVars.length} variação(ões) detectada(s)` : 'Separe variações com | ou Enter'
                    })()}
                  </span>
                  <Button size="sm" className="h-7 text-[11px] gap-1 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={insertNewBlock}
                    disabled={!newBlockVariations.trim()}>
                    <Plus className="size-3" /> Inserir
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Main text area with emoji button */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          placeholder="Texto da mensagem... Use {{nome}}, {{KEY: var1 | var2}} para variações"
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          className="text-sm font-mono pr-10"
        />
        <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="absolute top-2 right-2 size-7 rounded-md hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Inserir emoji"
            >
              <Smile className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" side="bottom" align="end" sideOffset={5}>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Input
                  placeholder="Buscar emoji..."
                  value={emojiSearch}
                  onChange={e => setEmojiSearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div className="grid grid-cols-8 gap-0.5 max-h-[200px] overflow-y-auto">
                {EMOJI_LIST
                  .filter(e => !emojiSearch || e.label.toLowerCase().includes(emojiSearch.toLowerCase()) || e.emoji.includes(emojiSearch))
                  .map((e, i) => (
                    <button
                      key={i}
                      type="button"
                      className="size-8 rounded hover:bg-muted/80 flex items-center justify-center text-lg transition-colors"
                      title={e.label}
                      onClick={() => {
                        insertAtCursor(e.emoji)
                        setEmojiPickerOpen(false)
                        setEmojiSearch('')
                      }}
                    >
                      {e.emoji}
                    </button>
                  ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Char/line count only - preview is now in the right panel */}
      {value.trim() && (
        <div className="flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setPreviewSeed(s => s + 1)}
            title="Alternar variação no preview"
          >
            <RefreshCw className="size-3" />
          </Button>
          <span className={cn(charCount > 1024 && 'text-rose-500 font-medium')}>{charCount} chars · {lineCount} linha(s){charCount > 1024 ? ' limite excedido' : ''}</span>
        </div>
      )}
    </div>
  )
}
