'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo, CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Plus, Trash2, Copy, RefreshCw, Check, X, Clock, Zap, Users,
  Pause, Play, Upload, Search, ArrowLeft, CalendarDays,
  Download, ArrowRight, AlertCircle, AlertTriangle, Info,
  Pencil, Eye, XCircle, CheckCircle2,
  File as FileIcon, ImageIcon, Film, Music, Mic, MapPin, Link2,
  BookmarkPlus, GripVertical, Loader2, Eraser, ArrowRightLeft,
  ChevronDown, Filter, Smile, Shuffle, Save, CheckCircle, FileSpreadsheet, FileText, Flame, Globe, Key, MoreVertical, Paperclip, Phone, RotateCcw, Shield, Smartphone, Snowflake, Trash, Type, User, Video
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton, CardListSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { restrictToHorizontalAxis, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { cn } from '@/lib/utils'
import { type Chip, type Campaign, type ContactList, type MessageItem, type MessageTemplate, type SequenceStep, type StepForm } from '@/lib/types'
import { StatusBadge, ConfirmDialog, statusColor, statusLabel } from '@/components/shared'
import { logAction } from '@/lib/audit-log'
import { useIsVisible } from '@/hooks/use-is-visible'
import { WARMING_MODE_MULTIPLIERS, type AntiBanSettings } from '@/lib/constants'

// Module-level variables for audio conversion
let ffmpegInstance: any = null
let ffmpegLoaded = false

const CONTACT_VARIABLES = [
  { tag: '{{nome}}', label: 'Nome', icon: '👤', source: 'core' },
  { tag: '{{whatsapp}}', label: 'WhatsApp', icon: '📱', source: 'core' },
  { tag: '{{telefone}}', label: 'Telefone', icon: '📞', source: 'core' },
]

const EMOJI_LIST = [
  { emoji: '😀', label: 'rosto sorridente' }, { emoji: '😃', label: 'rosto feliz' }, { emoji: '😄', label: 'rosto alegre' },
  { emoji: '😁', label: 'sorridente olhos felizes' }, { emoji: '😆', label: 'rindo' }, { emoji: '😅', label: 'suando sorrindo' },
  { emoji: '🤣', label: 'rolando de rir' }, { emoji: '😂', label: 'lágrimas de alegria' }, { emoji: '🙂', label: 'sorriso leve' },
  { emoji: '😉', label: 'piscadela' }, { emoji: '😊', label: 'sorridente tímido' }, { emoji: '🥰', label: 'corações nos olhos' },
  { emoji: '😍', label: 'olhos de coração' }, { emoji: '🤩', label: 'olhos brilhantes' }, { emoji: '😘', label: 'beijo' },
  { emoji: '😗', label: 'beicinho' }, { emoji: '😚', label: 'beijo tímido' }, { emoji: '😋', label: 'saboroso' },
  { emoji: '😛', label: 'língua de fora' }, { emoji: '😜', label: 'piscadela língua' }, { emoji: '🤪', label: 'doido' },
  { emoji: '😝', label: 'língua olhos fechados' }, { emoji: '🤑', label: 'dinheiro' }, { emoji: '🤗', label: 'abraço' },
  { emoji: '🤭', label: 'mão na boca' }, { emoji: '🤫', label: 'silêncio' }, { emoji: '🤔', label: 'pensando' },
  { emoji: '🤐', label: 'boca fechada' }, { emoji: '🤨', label: 'sobrancelha levantada' }, { emoji: '😐', label: 'neutro' },
  { emoji: '😑', label: 'sem expressão' }, { emoji: '😶', label: 'sem boca' }, { emoji: '😏', label: 'sorriminho' },
  { emoji: '😒', label: 'entediado' }, { emoji: '🙄', label: 'olhos revirados' }, { emoji: '😬', label: 'careta' },
  { emoji: '😮‍💨', label: 'suspiro' }, { emoji: '🤥', label: 'mentiroso' }, { emoji: '😌', label: 'aliviado' },
  { emoji: '😔', label: 'pensativo triste' }, { emoji: '😪', label: 'sono' }, { emoji: '🤤', label: 'babando' },
  { emoji: '😴', label: 'dormindo' }, { emoji: '😷', label: 'máscara' }, { emoji: '🤒', label: 'doente' },
  { emoji: '🤕', label: 'curativo' }, { emoji: '🤢', label: 'náusea' }, { emoji: '🤮', label: 'vomitando' },
  { emoji: '🥵', label: 'calor' }, { emoji: '🥶', label: 'frio' }, { emoji: '😱', label: 'grito' },
  { emoji: '😨', label: 'assustado' }, { emoji: '😰', label: 'ansioso' }, { emoji: '😥', label: 'decepcionado' },
  { emoji: '😢', label: 'chorando' }, { emoji: '😭', label: 'muito triste' }, { emoji: '😤', label: 'bravo' },
  { emoji: '😡', label: 'furioso' }, { emoji: '🤬', label: 'xingando' }, { emoji: '😈', label: 'diabinho' },
  { emoji: '👍', label: 'joinha' }, { emoji: '👎', label: 'negativo' }, { emoji: '👊', label: 'soco' },
  { emoji: '✊', label: 'punho' }, { emoji: '🤛', label: 'punho esquerdo' }, { emoji: '🤜', label: 'punho direito' },
  { emoji: '👏', label: 'palmas' }, { emoji: '🙌', label: 'mãos levantadas' }, { emoji: '👐', label: 'mãos abertas' },
  { emoji: '🤲', label: 'palmas juntas' }, { emoji: '🤝', label: 'aperto de mão' }, { emoji: '🙏', label: 'rezando' },
  { emoji: '✌️', label: 'paz' }, { emoji: '🤟', label: 'te amo' }, { emoji: '🤘', label: 'rock' },
  { emoji: '👌', label: 'ok' }, { emoji: '🤌', label: 'dedos juntos' }, { emoji: '🤏', label: 'pouquinho' },
  { emoji: '👈', label: 'apontando esquerda' }, { emoji: '👉', label: 'apontando direita' }, { emoji: '👆', label: 'apontando cima' },
  { emoji: '👇', label: 'apontando baixo' }, { emoji: '☝️', label: 'indicador cima' }, { emoji: '✋', label: 'mão parada' },
  { emoji: '🤚', label: 'mão levantada' }, { emoji: '🖐️', label: 'mão aberta' }, { emoji: '👋', label: 'aceno' },
  { emoji: '💪', label: 'força' }, { emoji: '🦾', label: 'braço mecânico' }, { emoji: '❤️', label: 'coração vermelho' },
  { emoji: '🧡', label: 'coração laranja' }, { emoji: '💛', label: 'coração amarelo' }, { emoji: '💚', label: 'coração verde' },
  { emoji: '💙', label: 'coração azul' }, { emoji: '💜', label: 'coração roxo' }, { emoji: '🖤', label: 'coração preto' },
  { emoji: '🤍', label: 'coração branco' }, { emoji: '💔', label: 'coração partido' }, { emoji: '❣️', label: 'exclamação coração' },
  { emoji: '💕', label: 'dois corações' }, { emoji: '💞', label: 'corações girando' }, { emoji: '💓', label: 'coração pulsando' },
  { emoji: '💖', label: 'coração brilhando' }, { emoji: '💘', label: 'coração Cupido' }, { emoji: '💝', label: 'coração laço' },
  { emoji: '🔥', label: 'fogo' }, { emoji: '⭐', label: 'estrela' }, { emoji: '🌟', label: 'estrela brilhando' },
  { emoji: '✨', label: 'faíscas' }, { emoji: '💫', label: 'tontura' }, { emoji: '🎉', label: 'festa' },
  { emoji: '🎊', label: 'confete' }, { emoji: '🎈', label: 'balão' }, { emoji: '🎁', label: 'presente' },
  { emoji: '🏆', label: 'troféu' }, { emoji: '🥇', label: 'medalha ouro' }, { emoji: '💰', label: 'dinheiro' },
  { emoji: '💵', label: 'nota dólar' }, { emoji: '💎', label: 'diamante' }, { emoji: '📌', label: 'alfinete' },
  { emoji: '📎', label: 'clipe' }, { emoji: '🔗', label: 'link' }, { emoji: '📞', label: 'telefone' },
  { emoji: '📱', label: 'celular' }, { emoji: '💬', label: 'balão fala' }, { emoji: '💭', label: 'pensamento' },
  { emoji: '🕐', label: 'relógio' }, { emoji: '⚡', label: 'raio' }, { emoji: '🚀', label: 'foguete' },
  { emoji: '🎯', label: 'alvo' }, { emoji: '✅', label: 'check verde' }, { emoji: '❌', label: 'X vermelho' },
  { emoji: '⚠️', label: 'aviso' }, { emoji: '📢', label: 'megafone' }, { emoji: '🔔', label: 'sino' },
  { emoji: '🏷️', label: 'etiqueta' }, { emoji: '📋', label: 'prancheta' }, { emoji: '📅', label: 'calendário' },
  { emoji: '🟢', label: 'círculo verde' }, { emoji: '🔴', label: 'círculo vermelho' }, { emoji: '🟡', label: 'círculo amarelo' },
  { emoji: '💯', label: 'cem' }, { emoji: '🔝', label: 'topo' }, { emoji: '🆕', label: 'novo' },
  { emoji: '🆓', label: 'grátis' }, { emoji: '🟩', label: 'quadrado verde' }, { emoji: '🏳️', label: 'bandeira branca' },
  { emoji: '🇧🇷', label: 'brasil' }, { emoji: '🤖', label: 'robô' }, { emoji: '👋', label: 'aceno' },
]

export async function uploadMediaFile(
  file: File,
  mediatype: string,
  audioMode?: 'whatsapp' | 'original'
): Promise<{ mediaUrl: string; mediatype: string; originalName: string; converted: boolean }> {
  let uploadFile = file
  let clientConverted = false

  // If audio in WhatsApp mode, try client-side conversion first
  if (mediatype === 'audio' && audioMode === 'whatsapp') {
    const isOgg = file.name.endsWith('.ogg') || file.name.endsWith('.oga') || file.type === 'audio/ogg' || file.type === 'audio/opus'

    if (!isOgg) {
      try {
        uploadFile = await convertAudioToOgg(file)
        clientConverted = true
        toast.success('Áudio convertido para OGG (WhatsApp)')
      } catch {
        console.warn('[Upload] Client-side conversion failed, server will try as fallback')
        toast.warning('Conversão no navegador falhou, tentando no servidor...')
      }
    }
  }

  const uploadForm = new FormData()
  uploadForm.append('file', uploadFile)
  uploadForm.append('mediatype', mediatype)
  if (mediatype === 'audio') uploadForm.append('audioMode', audioMode || 'whatsapp')
  if (clientConverted) uploadForm.append('clientConverted', 'true')

  const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm })
  const uploadData = await uploadRes.json()
  if (!uploadRes.ok) throw new Error(uploadData.error || 'Erro ao fazer upload da mídia')

  return uploadData
}

export function calcChipEffectiveInfo(chip: Chip, antiBanSettings: AntiBanSettings | null, warmingMode?: string): { effectiveLimit: number; phaseDay: number; phaseMaxDays: number } {
  if (!antiBanSettings || !chip.warmingEnabled || !antiBanSettings.warmingEnabled) {
    return { effectiveLimit: chip.dailyLimit || 200, phaseDay: 0, phaseMaxDays: 0 }
  }

  const phase = chip.warmingPhase || 'nursery'
  const now = new Date()

  // Parse schedules
  let schedule: { dayRange: string; days: [number, number]; limit: number }[] = []
  try {
    if (phase === 'nursery') {
      schedule = JSON.parse(antiBanSettings.nurserySchedule || '[]')
    } else if (phase === 'prewarm') {
      schedule = JSON.parse(antiBanSettings.prewarmSchedule || '[]')
    }
  } catch { /* ignore parse errors */ }

  if (phase === 'ready') {
    return { effectiveLimit: antiBanSettings.readyDailyLimit || chip.dailyLimit || 200, phaseDay: 0, phaseMaxDays: 0 }
  }

  // Calculate day within phase
  let dayInPhase = 1
  const warmingStart = chip.warmingStartedAt ? new Date(chip.warmingStartedAt) : null

  if (!warmingStart) {
    dayInPhase = 1
  } else {
    // Calculate days since warming started (using Brasília timezone)
    const spFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'America/Sao_Paulo' })
    const nowStr = spFormatter.format(now)
    const startStr = spFormatter.format(warmingStart)
    const [nm, nd, ny] = nowStr.split('/').map(Number)
    const [sm, sd, sy] = startStr.split('/').map(Number)
    const nowDate = new Date(ny, nm - 1, nd)
    const startDate = new Date(sy, sm - 1, sd)
    dayInPhase = Math.max(1, Math.floor((nowDate.getTime() - startDate.getTime()) / (86400000)) + 1)
  }

  // Find limit for current day
  let limit = 10 // fallback
  for (const entry of schedule) {
    if (dayInPhase >= entry.days[0] && dayInPhase <= entry.days[1]) {
      limit = entry.limit
      break
    }
  }
  // If beyond schedule, use last entry's limit
  if (schedule.length > 0 && dayInPhase > schedule[schedule.length - 1].days[1]) {
    limit = schedule[schedule.length - 1].limit
  }

  // Cap at chip's dailyLimit
  limit = Math.min(limit, chip.dailyLimit || antiBanSettings.dailyLimitPerChip)

  // Apply warming mode multiplier (matching backend behavior)
  const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode || 'normal']
  if (modeMultiplier) {
    limit = Math.round(limit * modeMultiplier.limitMultiplier)
  }

  const phaseMaxDays = schedule.length > 0 ? schedule[schedule.length - 1].days[1] : 0

  return { effectiveLimit: limit, phaseDay: dayInPhase, phaseMaxDays }
}

function parseKeyBlocksFromText(text: string): Array<{ fullMatch: string; variations: string[] }> {
  const blocks: Array<{ fullMatch: string; variations: string[] }> = []
  // Match {{KEY: ...}} but handle nested {{variable}} inside
  // Strategy: find {{KEY: then match until the matching }}
  const regex = /\{\{KEY:\s*/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const startIdx = match.index
    let depth = 0
    let i = startIdx + match[0].length
    // Skip past "KEY:" part, now find the closing }}
    // We need to find the matching }} accounting for nested {{ }}
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++
        i++ // skip next {
      } else if (text[i] === '}' && text[i + 1] === '}') {
        if (depth > 0) {
          depth--
          i++ // skip next }
        } else {
          // Found the closing }}
          const innerContent = text.slice(startIdx + match[0].length, i)
          const fullMatch = text.slice(startIdx, i + 2)
          const variations = innerContent.split('|').map(s => s.trim()).filter(Boolean)
          blocks.push({ fullMatch, variations })
          break
        }
      }
    }
    // Prevent infinite loop
    if (match.index === regex.lastIndex) regex.lastIndex++
  }
  return blocks
}

function generatePreviewText(text: string, messageKeys: Array<{ id: string; name: string; label: string; category: string; variations: string; resolutionType?: string; timeSlots?: string | null }>, seed: number, contactVariables?: Array<{ tag: string; label: string; source: string }>, previewContactData?: { name: string; phone: string; customFields?: string } | null): string {
  // First, resolve {{KEY: ...}} blocks — pick a deterministic variation based on seed
  let preview = text.replace(/\{\{KEY:\s*((?:[^{}]|\{\{[^}]*\}\})*)\}\}/g, (_, inner) => {
    const options = inner.split('|').map((s: string) => s.trim()).filter(Boolean)
    if (options.length === 0) return ''
    const idx = seed % options.length
    return options[idx]
  })

  // Replace old-style {{KEY_NAME}} with resolved variation from messageKeys
  messageKeys.forEach(k => {
    try {
      if (k.resolutionType === 'time_based' && k.timeSlots) {
        // Time-based key: resolve based on current time
        const slots = JSON.parse(k.timeSlots)
        const now = new Date()
        const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
        const currentMinutes = brazilTime.getHours() * 60 + brazilTime.getMinutes()
        let matchedKey: string | null = null
        for (const slot of slots) {
          const [startH, startM] = slot.start.split(':').map(Number)
          const [endH, endM] = slot.end.split(':').map(Number)
          const startMin = startH * 60 + startM
          const endMin = endH * 60 + endM
          if (startMin <= endMin) {
            if (currentMinutes >= startMin && currentMinutes <= endMin) { matchedKey = slot.key; break }
          } else {
            if (currentMinutes >= startMin || currentMinutes <= endMin) { matchedKey = slot.key; break }
          }
        }
        if (matchedKey) {
          const refKey = messageKeys.find(mk => mk.name === matchedKey)
          if (refKey) {
            const vars = JSON.parse(refKey.variations)
            if (vars?.length) preview = preview.replace(new RegExp(`\\{\\{${k.name}\\}\\}`, 'g'), vars[0])
          } else {
            preview = preview.replace(new RegExp(`\\{\\{${k.name}\\}\\}`, 'g'), matchedKey)
          }
        }
      } else {
        // Random key: use first variation for preview
        const vars = JSON.parse(k.variations)
        if (vars?.length) preview = preview.replace(new RegExp(`\\{\\{${k.name}\\}\\}`, 'g'), vars[0])
      }
    } catch { /* ignore */ }
  })

  // Build replacement data from the first contact of the linked list
  const replaceData: Record<string, string> = {}

  if (previewContactData) {
    // customFields has ALL columns from the spreadsheet: {"nome":"Maria","whatsapp":"55119...","empresa":"Tech Corp"}
    if (previewContactData.customFields) {
      try {
        const customData = JSON.parse(previewContactData.customFields)
        for (const [key, value] of Object.entries(customData)) {
          replaceData[key.toLowerCase()] = String(value)
        }
      } catch { /* ignore */ }
    }
    // Fallback core fields
    if (!replaceData['nome']) replaceData['nome'] = previewContactData.name
    if (!replaceData['telefone']) replaceData['telefone'] = previewContactData.phone
  }

  // Replace ALL {{variable}} patterns: if found in data, replace; if not, leave as-is
  preview = preview.replace(/\{\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}\}/g, (match, varName) => {
    const key = varName.toLowerCase()
    if (replaceData[key]) return replaceData[key]
    // Variable not found in contact data — leave {{varName}} as-is
    return match
  })

  // Convert WhatsApp formatting to HTML for preview
  // *bold* → <strong>bold</strong>
  // _italic_ → <em>italic</em>
  // ~strikethrough~ → <s>strikethrough</s>
  preview = preview.replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
  preview = preview.replace(/_([^_]+)_/g, '<em>$1</em>')
  preview = preview.replace(/~([^~]+)~/g, '<s>$1</s>')
  return preview
}

export async function convertAudioToOgg(file: File): Promise<File> {
  try {
    // Dynamic import of @ffmpeg/ffmpeg and @ffmpeg/util
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const { fetchFile } = await import('@ffmpeg/util')

    if (!ffmpegInstance) {
      ffmpegInstance = new FFmpeg()
    }

    if (!ffmpegLoaded) {
      await ffmpegInstance.load()
      ffmpegLoaded = true
    }

    const inputExt = file.name.split('.').pop()?.toLowerCase() || 'mp3'
    const inputName = `input.${inputExt}`
    const outputName = 'output.ogg'

    // Write input file to ffmpeg virtual filesystem
    await ffmpegInstance.writeFile(inputName, await fetchFile(file))

    // Convert to OGG/Opus (WhatsApp native format)
    await ffmpegInstance.exec([
      '-i', inputName,
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      '-vn',
      '-y',
      outputName,
    ])

    // Read the converted file
    const data = await ffmpegInstance.readFile(outputName)
    const blob = new Blob([data], { type: 'audio/ogg' })
    const oggName = file.name.replace(/\.[^/.]+$/, '') + '.ogg'

    // Cleanup
    try { await ffmpegInstance.deleteFile(inputName) } catch { /* ignore */ }
    try { await ffmpegInstance.deleteFile(outputName) } catch { /* ignore */ }

    return new File([blob], oggName, { type: 'audio/ogg' })
  } catch (err) {
    console.error('[AudioConverter] Client-side conversion failed:', err)
    throw err
  }
}

function MessageBuilder({ value, onChange, messageKeys, templates, contactVariables, previewContactData, rows = 3 }: {
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

function SortableTab({ id, idx, isActive, canClose, onClick, onClose, isFollowUp, delayLabel }: {
  id: string; idx: number; isActive: boolean; canClose: boolean; onClick: () => void; onClose: () => void;
  isFollowUp?: boolean; delayLabel?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  }

  // All steps use the same browser-tab style
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="shrink-0 group"
    >
      <div
        className={`flex items-center gap-0.5 pl-2 pr-0.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
          isActive
            ? 'bg-background text-emerald-600 ring-1 ring-emerald-200 dark:ring-emerald-800 shadow-sm'
            : 'text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/50'
        }`}
      >
        {/* Drag handle */}
        <span
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground mr-0.5"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3" />
        </span>
        {/* Tab label - clicking switches tab */}
        <button type="button" className="flex items-center gap-1.5" onClick={onClick}>
          <span className="flex items-center justify-center size-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">{idx + 1}</span>
          <span className="whitespace-nowrap">Mensagem {idx + 1}</span>
          {delayLabel && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
              <Clock className="size-2.5" />{delayLabel}
            </span>
          )}
        </button>
        {/* Close X button */}
        {canClose && (
          <button
            type="button"
            className="ml-0.5 flex items-center justify-center size-4 rounded-sm text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors opacity-0 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); onClose() }}
            title="Fechar mensagem"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}

export function CampanhasTab() {
  const isVisible = useIsVisible()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([])

  // PERF FIX: Memoize status counts to avoid 4+ .filter() calls on every render.
  // Previously, each of the 4 status cards called detailMessages.filter() separately,
  // plus 2 more in the tab buttons. Now computed once per detailMessages change.
  const detailMessageCounts = useMemo(() => {
    let pending = 0, sent = 0, delivered = 0, failed = 0, sending = 0
    for (const m of detailMessages) {
      switch (m.status) {
        case 'pending': pending++; break
        case 'sent': sent++; break
        case 'delivered':
        case 'read': delivered++; break
        case 'failed': failed++; break
        case 'sending': sending++; break
      }
    }
    return { pending, sent, delivered, failed, sending, total: detailMessages.length }
  }, [detailMessages])
  const [availableChips, setAvailableChips] = useState<Chip[]>([])
  const [availableLists, setAvailableLists] = useState<ContactList[]>([])
  const [messageKeys, setMessageKeys] = useState<Array<{ id: string; name: string; label: string; category: string; variations: string; resolutionType?: string; timeSlots?: string | null }>>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [contactVariables, setContactVariables] = useState<Array<{ tag: string; label: string; source: string }>>([])
  const [previewContact, setPreviewContact] = useState<{ name: string; phone: string; customFields?: string } | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [continuousProcessing, setContinuousProcessing] = useState(false)
  const [continuousStats, setContinuousStats] = useState({ processed: 0, remaining: 0, elapsed: 0 })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [distMode, setDistMode] = useState<'absolute' | 'percentage'>('absolute')
  const [redistributeDialogOpen, setRedistributeDialogOpen] = useState(false)
  const [redistributeDistribution, setRedistributeDistribution] = useState<Record<string, number>>({})
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportingAll, setExportingAll] = useState(false)
  const [refreshingDetail, setRefreshingDetail] = useState(false)
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'running' | 'paused' | 'completed' | 'cancelled' | 'draft'>('all')
  const [campaignSearch, setCampaignSearch] = useState('')
  // BUGFIX: Default é 'sendOrder' (ordem de envio) em vez de 'name' (alfabética).
  // Persiste a escolha do usuário em localStorage para não re-selecionar toda vez.
  const [detailSortBy, setDetailSortBy] = useState<'name' | 'sendOrder'>(() => {
    if (typeof window === 'undefined') return 'sendOrder'
    const saved = window.localStorage.getItem('campaignDetail_sortBy')
    return saved === 'name' ? 'name' : 'sendOrder'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('campaignDetail_sortBy', detailSortBy)
    }
  }, [detailSortBy])
  const [detailSearchQuery, setDetailSearchQuery] = useState('')
  const [detailStatusFilter, setDetailStatusFilter] = useState('all')
  const [antiBanSettings, setAntiBanSettings] = useState<AntiBanSettings | null>(null)
  const [editForm, setEditForm] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
    chipDistribution: {} as Record<string, number>, // chipId → contactLimit (0 = auto)
  })

  const [newCampaign, setNewCampaign] = useState({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [] as string[], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
    chipDistribution: {} as Record<string, number>, // chipId → contactLimit (0 = auto)
  })

  const resetNewCampaign = () => setNewCampaign({
    name: '', sendIntervalMin: 30, sendIntervalMax: 90,
    chipIds: [], contactListId: '', scheduledAt: '',
    steps: [{ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] as StepForm[],
    antiBanEnabled: true, warmingMode: 'normal',
    chipDistribution: {} as Record<string, number>,
  })

  const prevStatusRef = useRef<Record<string, string>>({})
  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' })
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : [])
    }
    catch { toast.error('Erro ao carregar campanhas') } finally { setLoading(false) }
  }, [])
  const fetchChips = useCallback(async () => {
    try { const res = await fetch('/api/chips'); setAvailableChips(await res.json()) } catch { /* empty */ }
  }, [])

  // PROBLEMA 4: Pausa individual de chip — pausa sem desconectar do WhatsApp.
  // Quando pausado, o chip não recebe novas mensagens de campanha, mas continua
  // conectado. Mensagens pendentes ficam aguardando (não são redistribuídas).
  const toggleChipPause = useCallback(async (chipId: string, currentlyPaused: boolean, chipName: string) => {
    try {
      const endpoint = currentlyPaused ? 'resume' : 'pause'
      const res = await fetch(`/api/chips/${chipId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: currentlyPaused ? '{}' : JSON.stringify({ reason: 'Pausa manual pelo usuário' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      // Atualiza o estado local dos availableChips
      setAvailableChips(prev => prev.map(c => c.id === chipId ? { ...c, paused: data.chip?.paused ?? !currentlyPaused, pausedAt: data.chip?.pausedAt ?? null, pauseReason: data.chip?.pauseReason ?? null } : c))
      // Atualiza também o chip dentro da campanha selecionada (se for o caso)
      setSelectedCampaign(prev => {
        if (!prev || !prev.chips) return prev
        return {
          ...prev,
          chips: prev.chips.map((cc: any) => cc.chip?.id === chipId ? { ...cc, chip: { ...cc.chip, paused: data.chip?.paused ?? !currentlyPaused, pausedAt: data.chip?.pausedAt ?? null, pauseReason: data.chip?.pauseReason ?? null } } : cc)
        }
      })
      toast.success(data.message || `Chip ${chipName} ${currentlyPaused ? 'retomado' : 'pausado'}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao alterar pausa do chip'
      toast.error(msg)
    }
  }, [])
  const fetchLists = useCallback(async () => {
    try { const res = await fetch('/api/contact-lists'); setAvailableLists(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchKeys = useCallback(async () => {
    try { const res = await fetch('/api/keys'); setMessageKeys(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchTemplates = useCallback(async () => {
    try { const res = await fetch('/api/templates'); setTemplates(await res.json()) } catch { /* empty */ }
  }, [])
  const fetchAntiBanSettings = useCallback(async () => {
    try { const res = await fetch('/api/antiban'); if (res.ok) setAntiBanSettings(await res.json()) } catch { /* empty */ }
  }, [])

  // Wrapper for calcChipEffectiveInfo using local antiBanSettings
  const getChipEffectiveInfo = useCallback((chip: Chip) => calcChipEffectiveInfo(chip, antiBanSettings), [antiBanSettings])

  // Fetch available variables from the selected contact list
  const fetchContactVariables = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/contact-lists/${listId}/contacts?limit=1`)
      const data = await res.json()
      if (data.availableVariables) {
        setContactVariables(data.availableVariables)
      } else {
        setContactVariables([])
      }
      // Also store first contact data for realistic preview
      if (data.firstContact) {
        setPreviewContact(data.firstContact)
      } else {
        setPreviewContact(null)
      }
    } catch {
      setContactVariables([])
      setPreviewContact(null)
    }
  }, [])

  useEffect(() => { fetchCampaigns(); fetchChips(); fetchLists(); fetchKeys(); fetchTemplates(); fetchAntiBanSettings() }, [fetchCampaigns, fetchChips, fetchLists, fetchKeys, fetchTemplates, fetchAntiBanSettings])

  // Auto-refresh campaigns every 10 seconds when any campaign is running (for live progress)
  // PERF FIX: was 5s, now 10s. Detail dialog polling handles real-time updates.
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === 'running')
    if (!hasRunning) return
    const interval = setInterval(fetchCampaigns, isVisible ? 20000 : 120000)
    return () => clearInterval(interval)
  }, [campaigns, fetchCampaigns])

  // Auto-refresh campaign detail dialog every 3 seconds when open and campaign is active
  // Uses refs to avoid re-creating interval on every data update
  const detailPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const detailCampaignIdRef = useRef<string | null>(null)
  const detailHasActiveMessagesRef = useRef(false)

  useEffect(() => {
    // Clear previous polling
    if (detailPollingRef.current) {
      clearInterval(detailPollingRef.current)
      detailPollingRef.current = null
    }

    if (!detailDialogOpen || !selectedCampaign) return

    // Track the campaign ID for polling
    detailCampaignIdRef.current = selectedCampaign.id

    // Check if campaign is in an active state
    const isActive = ['running', 'scheduled'].includes(selectedCampaign.status) ||
      detailMessages.some(m => m.status === 'pending' || m.status === 'sending')
    detailHasActiveMessagesRef.current = detailMessages.some(m => m.status === 'pending' || m.status === 'sending')

    if (!isActive) return

    // PERF FIX: was 3s, now 5s. Also removed redundant fetchCampaigns() call
    // (the 10s campaign list polling already keeps cards in sync).
    // Reduced message limit from 5000 to 500 — most users only see recent messages.
    detailPollingRef.current = setInterval(async () => {
      const campaignId = detailCampaignIdRef.current
      if (!campaignId) return
      try {
        // Refresh campaign data
        const res = await fetch(`/api/campaigns/${campaignId}`, { cache: 'no-store' })
        if (!res.ok) return
        const updated = await res.json()
        setSelectedCampaign(updated)
        // Refresh messages (limit 500 — enough for real-time view)
        const msgRes = await fetch(`/api/messages?campaignId=${campaignId}&limit=500`, { cache: 'no-store' })
        const msgData = await msgRes.json()
        const messages = Array.isArray(msgData?.data) ? msgData.data : Array.isArray(msgData) ? msgData : []
        setDetailMessages(messages)
        // Stop polling if campaign is no longer active and no messages are pending/sending
        const stillActive = ['running', 'scheduled'].includes(updated.status) ||
          messages.some((m: MessageItem) => m.status === 'pending' || m.status === 'sending')
        if (!stillActive && detailPollingRef.current) {
          clearInterval(detailPollingRef.current)
          detailPollingRef.current = null
        }
      } catch { /* silent — will retry next interval */ }
    }, 5000)

    return () => {
      if (detailPollingRef.current) {
        clearInterval(detailPollingRef.current)
        detailPollingRef.current = null
      }
    }
  }, [detailDialogOpen, selectedCampaign?.id, selectedCampaign?.status, fetchCampaigns])

  // When contact list changes, fetch available variables
  useEffect(() => {
    if (newCampaign.contactListId) {
      fetchContactVariables(newCampaign.contactListId)
    } else {
      setContactVariables([])
      setPreviewContact(null)
    }
  }, [newCampaign.contactListId, fetchContactVariables])

  const createCampaign = async (asDraft: boolean = false) => {
    if (saving) return // prevent double-click
    setSaving(true)
    try {
      // Upload media and build steps payload
      const stepsPayload: Array<{ stepOrder: number; content: string; delayMinutes: number; delayUnit?: string; mediaUrl?: string; mediatype?: string; variations: string }> = []

      for (let i = 0; i < newCampaign.steps.length; i++) {
        const s = newCampaign.steps[i]
        let mediaUrl = s.mediaUrl || ''
        let mediatype = s.mediatype || ''

        // Upload step media if present
        if (s.mediaFile && mediatype) {
          try {
            const uploadData = await uploadMediaFile(s.mediaFile, mediatype, s.audioMode)
            mediaUrl = uploadData.mediaUrl
            mediatype = uploadData.mediatype
          } catch (uploadErr: any) {
            console.error(`[createCampaign] Upload failed for step ${i + 1}:`, uploadErr?.message)
            toast.error(`Erro no upload da mídia da mensagem ${i + 1}: ${uploadErr?.message || 'erro desconhecido'}`, { duration: 6000 })
            throw uploadErr
          }
        }

        // Upload media for each variation
        const variationsWithMedia: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        for (const v of s.variations) {
          if (!v.content.trim() && !v.mediaFile && !v.mediaUrl && !v.mediatype) continue
          let vMediaUrl = v.mediaUrl || ''
          let vMediatype = v.mediatype || ''

          if (v.mediaFile && vMediatype) {
            try {
              const uploadData = await uploadMediaFile(v.mediaFile, vMediatype, v.audioMode)
              vMediaUrl = uploadData.mediaUrl
              vMediatype = uploadData.mediatype
            } catch (uploadErr: any) {
              console.error(`[createCampaign] Upload failed for variation in step ${i + 1}:`, uploadErr?.message)
              throw uploadErr
            }
          }

          variationsWithMedia.push({ content: v.content, mediaUrl: vMediaUrl || undefined, mediatype: vMediatype || undefined })
        }

        stepsPayload.push({
          stepOrder: i + 1,
          content: s.content,
          delayMinutes: s.delayMinutes,
          delayUnit: s.delayUnit,
          mediaUrl: mediaUrl || undefined,
          mediatype: mediatype || undefined,
          variations: JSON.stringify(variationsWithMedia),
        })
      }

      const payload = {
        name: newCampaign.name, sendIntervalMin: newCampaign.sendIntervalMin, sendIntervalMax: newCampaign.sendIntervalMax,
        chipIds: newCampaign.chipIds, contactListId: newCampaign.contactListId || null,
        chipDistribution: newCampaign.chipDistribution,
        scheduledAt: newCampaign.scheduledAt ? (() => {
          // datetime-local value is in Brasília time (UTC-3)
          // Append timezone offset so Date() converts correctly to UTC for the database
          const localVal = newCampaign.scheduledAt // e.g. "2026-05-21T15:00"
          const brasiliaOffset = '-03:00'
          return new Date(localVal + brasiliaOffset).toISOString()
        })() : null,
        steps: stepsPayload, antiBanEnabled: newCampaign.antiBanEnabled, warmingMode: newCampaign.warmingMode,
        status: asDraft ? 'draft' : undefined,
      }

      console.log('[createCampaign] Saving campaign:', { name: payload.name, stepsCount: stepsPayload.length, editing, campaignId: selectedCampaign?.id })

      if (editing && selectedCampaign) {
        // Edit mode: PATCH the existing campaign
        const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Erro ${res.status} ao atualizar campanha`) }
        // Auto-redistribute if campaign is paused/draft and has chipDistribution changes
        if (['paused', 'draft'].includes(selectedCampaign.status) && Object.values(newCampaign.chipDistribution).some(v => (v || 0) > 0)) {
          try {
            const redistRes = await fetch(`/api/campaigns/${selectedCampaign.id}/redistribute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chipDistribution: newCampaign.chipDistribution }),
            })
            const redistData = await redistRes.json()
            if (redistRes.ok && redistData.redistributed > 0) {
              toast.success(`Campanha atualizada! ${redistData.redistributed} mensagens redistribuídas.`)
            } else {
              toast.success('Campanha atualizada com sucesso!')
            logAction({ action: 'UPDATE_CAMPAIGN', category: 'campaign', targetType: 'Campaign' })
            }
          } catch {
            toast.success('Campanha atualizada com sucesso! (redistribuição automática falhou)')
          }
        } else {
          toast.success('Campanha atualizada com sucesso!')
        }
      } else {
        // Create mode: POST new campaign
        const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Erro ${res.status} ao criar campanha`) }
        toast.success(asDraft ? 'Rascunho salvo com sucesso!' : 'Campanha criada com sucesso!')
        logAction({ action: 'CREATE_CAMPAIGN', category: 'campaign', targetType: 'Campaign' })
      }
      setCreateDialogOpen(false); setEditing(false); resetNewCampaign(); setActiveStep(0); fetchCampaigns()
    } catch (err: unknown) {
      console.error('[createCampaign] Error:', err)
      const errMsg = (err as Error).message || 'Erro ao salvar campanha'
      toast.error(errMsg, { duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  // Track which campaigns are currently starting (prevents double-click)
  const [startingCampaignIds, setStartingCampaignIds] = React.useState<Set<string>>(new Set())

  const startCampaignAction = async (id: string) => {
    // Prevent double-click: if this campaign is already starting, ignore
    if (startingCampaignIds.has(id)) return
    setStartingCampaignIds(prev => new Set(prev).add(id))

    try {
      const res = await fetch(`/api/campaigns/${id}/start`, { method: 'POST' })
      let data
      try { data = await res.json() } catch { data = {} }
      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar campanha')
      toast.success(`Campanha iniciada! ${data.messageCount || 0} mensagens criadas. Processando...`)
      fetchCampaigns()
      // Start continuous processing loop
      startContinuousProcessing()
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro ao iniciar campanha'
      toast.error(msg)
      console.error('Campaign start error:', err)
    } finally {
      // Remove from starting set after a delay to prevent rapid re-clicks
      setTimeout(() => {
        setStartingCampaignIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 3000)
    }
  }

  // Continuous processing loop — keeps calling /api/campaigns/process
  // until no more running campaigns or user stops it
  const startContinuousProcessing = () => {
    setContinuousProcessing(true)
    setContinuousStats({ processed: 0, remaining: 0, elapsed: 0 })
  }

  const stopContinuousProcessing = () => {
    setContinuousProcessing(false)
  }

  // Effect that runs the continuous processing loop
  useEffect(() => {
    if (!continuousProcessing) return

    let cancelled = false

    const processLoop = async () => {
      while (!cancelled) {
        try {
          const res = await fetch('/api/campaigns/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          const data = await res.json()

          if (!res.ok) {
            console.error('[ContinuousProcess] Error:', data.error)
            break
          }

          setContinuousStats(prev => ({
            processed: prev.processed + (data.processed || 0),
            remaining: data.remaining || 0,
            elapsed: data.elapsedMs || 0,
          }))

          // Show toasts for chip ban/disconnect/auto-pause events
          if (data.events?.length) {
            for (const event of data.events) {
              if (event.type === 'chip_banned') {
                toast.error(`Chip ${event.chipName} foi banido durante a campanha "${event.campaignName}"`, { duration: 8000 })
              } else if (event.type === 'chip_disconnected') {
                toast.warning(`Chip ${event.chipName} desconectou durante a campanha "${event.campaignName}"`, { duration: 8000 })
              } else if (event.type === 'campaign_auto_paused') {
                toast.error(`Campanha "${event.campaignName}" foi pausada automaticamente: ${event.reason}`, { duration: 8000 })
              }
            }
          }

          // If no messages were processed and no running campaigns, stop
          if (data.processed === 0 && data.campaigns === 0) {
            console.log('[ContinuousProcess] No more running campaigns, stopping.')
            break
          }

          // If outside sending window, stop (will resume via cron)
          if (data.lastReason?.includes('outside_sending_window')) {
            console.log('[ContinuousProcess] Outside sending window, stopping.')
            break
          }

          // If campaign paused by warning, stop
          if (data.lastReason?.includes('whatsapp_warning_detected')) {
            toast.error('Campanha pausada — aviso do WhatsApp detectado!')
            break
          }

          // Notify when a chip hits daily limit
          if (data.lastReason?.includes('daily_limit_')) {
            const chipMatch = data.lastReason.match(/daily_limit_(?:reassigned_)?(.+)/)
            const chipName = chipMatch ? chipMatch[1] : 'desconhecido'
            if (data.lastReason.includes('reassigned')) {
              toast.warning(`Chip "${chipName}" atingiu o limite diário — mensagens reatribuídas a outros chips`, { duration: 6000 })
            } else {
              toast.error(`Chip "${chipName}" atingiu o limite diário e não há outros chips disponíveis`, { duration: 6000 })
              break
            }
          }

          // Refresh campaign list to show progress
          fetchCampaigns()

          // ADAPTIVE DELAY between loop iterations
          // The /api/campaigns/process endpoint already waits internally for the anti-ban delay,
          // but we still add a minimum gap to prevent hammering the server when the endpoint
          // returns quickly (e.g., when the campaign slot is already claimed by another invocation).
          // If the endpoint took a long time (meaning it was processing + waiting), we use a short delay.
          // If it was quick (meaning nothing was processed or slot was claimed), we wait longer.
          const responseTimeMs = data.elapsedMs || 0
          if (data.processed === 0) {
            // No messages processed — another invocation has the slot or campaign is blocked.
            // Wait 30 seconds before trying again (no point in hammering the server).
            await new Promise(r => setTimeout(r, 30000))
          } else if (responseTimeMs < 10000) {
            // Processed quickly (< 10s) — the delay was short, wait a bit more
            await new Promise(r => setTimeout(r, 5000))
          } else {
            // Normal processing — the endpoint already waited for the anti-ban delay
            // Short 2-second gap before next iteration is fine
            await new Promise(r => setTimeout(r, 2000))
          }

        } catch (err) {
          console.error('[ContinuousProcess] Fetch error:', err)
          // Wait a bit and retry
          await new Promise(r => setTimeout(r, 5000))
        }
      }

      if (!cancelled) {
        setContinuousProcessing(false)
      }
    }

    processLoop()

    return () => { cancelled = true }
  }, [continuousProcessing])

  const updateCampaignStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      toast.success('Status atualizado!'); fetchCampaigns()
    } catch { toast.error('Erro ao atualizar status') }
  }

  const deleteCampaign = async (id: string) => {
    try { await fetch(`/api/campaigns/${id}`, { method: 'DELETE' }); toast.success('Campanha removida!'); fetchCampaigns() }
    catch { toast.error('Erro ao remover campanha') }
  }

  const exportCampaign = async (id: string, name: string) => {
    setExportingId(id)
    try {
      const res = await fetch(`/api/campaigns/${id}/export`)
      if (!res.ok) throw new Error('Erro ao exportar')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/)
      a.download = filenameMatch ? filenameMatch[1] : `relatorio_${name}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Relatório exportado!')
    } catch { toast.error('Erro ao exportar relatório') }
    finally { setExportingId(null) }
  }

  const exportAllCampaigns = async (filter?: string) => {
    setExportingAll(true)
    try {
      const query = filter && filter !== 'all' ? `?status=${filter}` : ''
      const res = await fetch(`/api/campaigns/export-all${query}`)
      if (!res.ok) throw new Error('Erro ao exportar')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/)
      a.download = filenameMatch ? filenameMatch[1] : 'relatorio_geral_campanhas.csv'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Relatório geral exportado!')
    } catch { toast.error('Erro ao exportar relatório geral') }
    finally { setExportingAll(false) }
  }

  const duplicateCampaign = async (c: Campaign) => {
    try {
      const steps = (c.sequenceSteps || []).map((s: SequenceStep) => ({
        stepOrder: s.stepOrder,
        content: s.content,
        delayMinutes: s.delayMinutes,
        mediaUrl: s.mediaUrl || '',
        mediatype: s.mediatype || 'text',
        variations: s.variations || '[]',
      }))
      const chipIds = (c.chips || []).map((cc: { chipId: string }) => cc.chipId)
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.name} (Cópia)`,
          contactListId: c.contactListId,
          sendIntervalMin: c.sendIntervalMin,
          sendIntervalMax: c.sendIntervalMax,
          antiBanEnabled: c.antiBanEnabled,
          warmingMode: c.warmingMode,
          chipIds,
          steps,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Campanha duplicada!')
      fetchCampaigns()
    } catch { toast.error('Erro ao duplicar campanha') }
  }

  const saveCampaignAsTemplate = async (c: Campaign) => {
    try {
      const steps = (c.sequenceSteps || []).map((s: SequenceStep) => ({
        stepOrder: s.stepOrder,
        content: s.content,
        delayMinutes: s.delayMinutes,
        mediaUrl: s.mediaUrl || '',
        mediatype: s.mediatype || 'text',
        variations: s.variations || '[]',
      }))
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          category: 'campanha',
          content: steps.length === 1 ? steps[0].content : '',
          mediatype: steps.length === 1 ? steps[0].mediatype : 'text',
          steps: JSON.stringify(steps),
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Template salvo com sucesso!')
    } catch { toast.error('Erro ao salvar template') }
  }

  const processAllCampaigns = async () => {
    setProcessing(true)
    try {
      const res = await fetch('/api/campaigns/process', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao processar campanhas')
      const processed = data.processed ?? data.startedScheduled ?? 0
      toast.success(`${processed} campanha(s) processada(s) com sucesso!`)
      fetchCampaigns()
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao processar campanhas')
    } finally {
      setProcessing(false)
    }
  }

  const openDetail = async (campaign: Campaign) => {
    setSelectedCampaign(campaign); setDetailDialogOpen(true); setEditing(false)
    // PROBLEMA 2: Não resetar detailSortBy para 'name' — respeitar o default
    // 'sendOrder' (ou a preferência salva no localStorage do usuário).
    // Apenas resetar search e status filter.
    setDetailSearchQuery(''); setDetailStatusFilter('all')
    try {
      // Fetch fresh campaign data with latest chip info
      const [campRes, msgRes] = await Promise.all([
        fetch(`/api/campaigns/${campaign.id}`, { cache: 'no-store' }),
        fetch(`/api/messages?campaignId=${campaign.id}&limit=5000`, { cache: 'no-store' })
      ])
      if (campRes.ok) setSelectedCampaign(await campRes.json())
      const msgData = await msgRes.json()
      setDetailMessages(Array.isArray(msgData?.data) ? msgData.data : Array.isArray(msgData) ? msgData : [])
    }
    catch { setDetailMessages([]) }
  }

  const toggleChip = (chipId: string) => {
    setNewCampaign(prev => {
      const isRemoving = prev.chipIds.includes(chipId)
      const newChipIds = isRemoving ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId]
      // If removing a chip, also remove its distribution entry
      const newDistribution = { ...prev.chipDistribution }
      if (isRemoving) {
        delete newDistribution[chipId]
      }
      return { ...prev, chipIds: newChipIds, chipDistribution: newDistribution }
    })
  }

  const addStep = () => {
    const newLength = newCampaign.steps.length + 1
    setNewCampaign(prev => ({ ...prev, steps: [...prev.steps, { content: '', delayMinutes: 60, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] }))
    setActiveStep(newLength - 1) // auto-switch to the new step (0-indexed)
  }
  const removeStep = (idx: number) => setNewCampaign(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  const duplicateStep = (idx: number) => {
    setNewCampaign(prev => {
      const stepToCopy = prev.steps[idx]
      if (!stepToCopy) return prev
      const newStep = { ...stepToCopy, mediaFile: null, mediaUrl: stepToCopy.mediaUrl, variations: stepToCopy.variations?.map(v => ({ ...v, mediaFile: null })) || [] }
      const newSteps = [...prev.steps]
      newSteps.splice(idx + 1, 0, newStep)
      return { ...prev, steps: newSteps }
    })
    setActiveStep(idx + 1)
  }
  const moveStep = (fromIdx: number, toIdx: number) => {
    setNewCampaign(prev => {
      const steps = arrayMove(prev.steps, fromIdx, toIdx)
      return { ...prev, steps }
    })
    setActiveStep(toIdx)
  }
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = Number(active.id)
      const newIndex = Number(over.id)
      moveStep(oldIndex, newIndex)
    }
  }
  const updateStep = (idx: number, field: 'content' | 'delayMinutes' | 'delayUnit' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'audioMode' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | number | File | boolean | null) => {
    setNewCampaign(prev => { const steps = [...prev.steps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, steps } })
  }

  // Variation helpers (within a step)
  const addVariation = (stepIdx: number) => setNewCampaign(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: [...steps[stepIdx].variations, { content: '', mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }
    return { ...prev, steps }
  })
  const removeVariation = (stepIdx: number, varIdx: number) => setNewCampaign(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: steps[stepIdx].variations.filter((_, i) => i !== varIdx) }
    return { ...prev, steps }
  })
  const updateVariation = (stepIdx: number, varIdx: number, field: 'content' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | File | boolean | null) => {
    setNewCampaign(prev => {
      const steps = [...prev.steps]
      const vars = [...steps[stepIdx].variations]
      vars[varIdx] = { ...vars[varIdx], [field]: value }
      steps[stepIdx] = { ...steps[stepIdx], variations: vars }
      return { ...prev, steps }
    })
  }

  const canCreate = newCampaign.name.trim() && newCampaign.chipIds.length > 0 &&
    newCampaign.steps.some(s =>
      s.content.trim() ||
      s.mediaFile ||
      s.mediaUrl ||
      s.mediatype ||
      s.variations.some(v => v.content.trim() || v.mediaFile || v.mediaUrl || v.mediatype)
    )

  // ─── Edit Campaign Helpers ──────────────────────────────────
  const startEditing = (campaign: Campaign) => {
    const emptyVariation = { content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }
    const steps: StepForm[] = (campaign.sequenceSteps || [])
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map(s => {
        let parsedVars: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        try { parsedVars = JSON.parse(s.variations || '[]') } catch { /* ignore */ }
        return {
          content: s.content || '',
          delayMinutes: s.delayMinutes || 0,
          delayUnit: (s.delayUnit || 'minutes') as 'minutes' | 'seconds',
          mediaFile: null as File | null,
          mediaUrl: s.mediaUrl || '',
          mediatype: s.mediatype || '',
          audioMode: 'whatsapp' as const,
          caption: '',
          linkUrl: '',
          linkPreview: true,
          contactName: '',
          contactPhone: '',
          locationLat: '',
          locationLng: '',
          locationName: '',
          variations: parsedVars.length > 0
            ? parsedVars.map(v => ({ content: v.content, mediaFile: null as File | null, mediaUrl: v.mediaUrl || '', mediatype: v.mediatype || '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }))
            : [{ ...emptyVariation }],
        }
      })
    if (steps.length === 0) {
      steps.push({ content: '', delayMinutes: 0, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ ...emptyVariation }] })
    }
    // Pre-fill newCampaign and open create dialog instead of editing inside detail dialog
    setNewCampaign({
      name: campaign.name,
      sendIntervalMin: campaign.sendIntervalMin || 30,
      sendIntervalMax: campaign.sendIntervalMax || 90,
      chipIds: (campaign.chips || []).map(cc => cc.chipId),
      contactListId: campaign.contactList?.id || '',
      scheduledAt: campaign.scheduledAt ? (() => {
        // Convert UTC to Brasília time for the datetime-local input
        const d = new Date(campaign.scheduledAt)
        const brasilia = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
        const offset = brasilia.getTimezoneOffset()
        const local = new Date(brasilia.getTime() - offset * 60000)
        return local.toISOString().slice(0, 16)
      })() : '',
      steps,
      antiBanEnabled: campaign.antiBanEnabled ?? true,
      warmingMode: campaign.warmingMode || 'normal',
      chipDistribution: (campaign.chips || []).reduce((acc: Record<string, number>, cc: any) => {
        if (cc.contactLimit && cc.contactLimit > 0) acc[cc.chipId] = cc.contactLimit
        return acc
      }, {}),
    })
    setDetailDialogOpen(false)
    setCreateDialogOpen(true)
    setEditing(true) // keep editing flag so createCampaign knows to PATCH instead of POST
  }

  const cancelEditing = () => {
    setEditing(false)
    setCreateDialogOpen(false)
    resetNewCampaign()
  }

  const saveEdit = async () => {
    if (!selectedCampaign) return
    setSaving(true)
    try {
      const stepsPayload: Array<{ stepOrder: number; content: string; delayMinutes: number; delayUnit?: string; mediaUrl?: string; mediatype?: string; variations: string }> = []
      for (let i = 0; i < editForm.steps.length; i++) {
        const s = editForm.steps[i]
        let mediaUrl = s.mediaUrl || ''
        let mediatype = s.mediatype || ''
        if (s.mediaFile && mediatype) {
          try {
            const uploadData = await uploadMediaFile(s.mediaFile, mediatype, s.audioMode)
            mediaUrl = uploadData.mediaUrl
            mediatype = uploadData.mediatype
          } catch (uploadErr: any) {
            console.error(`[saveEdit] Upload failed for step ${i + 1}:`, uploadErr?.message)
            toast.error(`Erro no upload da mídia da mensagem ${i + 1}: ${uploadErr?.message || 'erro desconhecido'}`, { duration: 6000 })
            throw uploadErr
          }
        }
        const variationsWithMedia: Array<{ content: string; mediaUrl?: string; mediatype?: string }> = []
        for (const v of s.variations) {
          if (!v.content.trim() && !v.mediaFile && !v.mediaUrl && !v.mediatype) continue
          let vMediaUrl = v.mediaUrl || ''
          let vMediatype = v.mediatype || ''
          if (v.mediaFile && vMediatype) {
            try {
              const uploadData = await uploadMediaFile(v.mediaFile, vMediatype, v.audioMode)
              vMediaUrl = uploadData.mediaUrl
              vMediatype = uploadData.mediatype
            } catch (uploadErr: any) {
              console.error(`[saveEdit] Upload failed for variation in step ${i + 1}:`, uploadErr?.message)
              throw uploadErr
            }
          }
          variationsWithMedia.push({ content: v.content, mediaUrl: vMediaUrl || undefined, mediatype: vMediatype || undefined })
        }
        stepsPayload.push({
          stepOrder: i + 1,
          content: s.content,
          delayMinutes: s.delayMinutes,
          delayUnit: s.delayUnit,
          mediaUrl: mediaUrl || undefined,
          mediatype: mediatype || undefined,
          variations: JSON.stringify(variationsWithMedia),
        })
      }
      const payload = {
        name: editForm.name,
        sendIntervalMin: editForm.sendIntervalMin,
        sendIntervalMax: editForm.sendIntervalMax,
        chipIds: editForm.chipIds,
        contactListId: editForm.contactListId || null,
        scheduledAt: editForm.scheduledAt ? new Date(editForm.scheduledAt + '-03:00').toISOString() : null,
        steps: stepsPayload,
        antiBanEnabled: editForm.antiBanEnabled,
        warmingMode: editForm.warmingMode,
        chipDistribution: editForm.chipDistribution,
      }
      console.log('[saveEdit] Saving campaign:', { name: payload.name, stepsCount: stepsPayload.length, campaignId: selectedCampaign.id })
      const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Erro ao atualizar campanha') }
      // Auto-redistribute if campaign is paused/draft and has chipDistribution changes
      if (['paused', 'draft'].includes(selectedCampaign.status) && Object.values(editForm.chipDistribution).some(v => (v || 0) > 0)) {
        try {
          const redistRes = await fetch(`/api/campaigns/${selectedCampaign.id}/redistribute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chipDistribution: editForm.chipDistribution }),
          })
          const redistData = await redistRes.json()
          if (redistRes.ok && redistData.redistributed > 0) {
            toast.success(`Campanha atualizada! ${redistData.redistributed} mensagens redistribuídas.`)
          } else {
            toast.success('Campanha atualizada com sucesso!')
          }
        } catch {
          toast.success('Campanha atualizada com sucesso! (redistribuição automática falhou)')
        }
      } else {
        toast.success('Campanha atualizada com sucesso!')
      }
      setEditing(false)
      fetchCampaigns()
      // Refresh selected campaign
      const updated = await fetch(`/api/campaigns/${selectedCampaign.id}`).then(r => r.json())
      setSelectedCampaign(updated)
    } catch (err: unknown) {
      console.error('[saveEdit] Error:', err)
      const errMsg = (err as Error).message || 'Erro ao atualizar campanha'
      toast.error(errMsg, { duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  const editToggleChip = (chipId: string) => {
    setEditForm(prev => {
      const isRemoving = prev.chipIds.includes(chipId)
      const newChipIds = isRemoving ? prev.chipIds.filter(id => id !== chipId) : [...prev.chipIds, chipId]
      const newDistribution = { ...prev.chipDistribution }
      if (isRemoving) {
        delete newDistribution[chipId]
      }
      return { ...prev, chipIds: newChipIds, chipDistribution: newDistribution }
    })
  }
  const editAddStep = () => setEditForm(prev => ({ ...prev, steps: [...prev.steps, { content: '', delayMinutes: 60, delayUnit: 'minutes' as const, mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '', variations: [{ content: '', mediaFile: null as File | null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }] }))
  const editRemoveStep = (idx: number) => setEditForm(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  const editUpdateStep = (idx: number, field: 'content' | 'delayMinutes' | 'delayUnit' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | number | File | boolean | null) => {
    setEditForm(prev => { const steps = [...prev.steps]; steps[idx] = { ...steps[idx], [field]: value }; return { ...prev, steps } })
  }
  const editAddVariation = (stepIdx: number) => setEditForm(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: [...steps[stepIdx].variations, { content: '', mediaFile: null, mediaUrl: '', mediatype: '', audioMode: 'whatsapp' as const, caption: '', linkUrl: '', linkPreview: true, contactName: '', contactPhone: '', locationLat: '', locationLng: '', locationName: '' }] }
    return { ...prev, steps }
  })
  const editRemoveVariation = (stepIdx: number, varIdx: number) => setEditForm(prev => {
    const steps = [...prev.steps]
    steps[stepIdx] = { ...steps[stepIdx], variations: steps[stepIdx].variations.filter((_, i) => i !== varIdx) }
    return { ...prev, steps }
  })
  const editUpdateVariation = (stepIdx: number, varIdx: number, field: 'content' | 'mediaFile' | 'mediaUrl' | 'mediatype' | 'caption' | 'linkUrl' | 'linkPreview' | 'contactName' | 'contactPhone' | 'locationLat' | 'locationLng' | 'locationName', value: string | File | boolean | null) => {
    setEditForm(prev => {
      const steps = [...prev.steps]
      const vars = [...steps[stepIdx].variations]
      vars[varIdx] = { ...vars[varIdx], [field]: value }
      steps[stepIdx] = { ...steps[stepIdx], variations: vars }
      return { ...prev, steps }
    })
  }

  const canSaveEdit = editForm.name.trim() && editForm.chipIds.length > 0 &&
    editForm.steps.some(s =>
      s.content.trim() ||
      s.mediaFile ||
      s.mediaUrl ||
      s.mediatype ||
      s.variations.some(v => v.content.trim() || v.mediaFile || v.mediaUrl || v.mediatype)
    )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas campanhas de envio em massa</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {continuousProcessing && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Enviando...</span>
              </div>
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {continuousStats.processed} enviadas | {continuousStats.remaining} restantes
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50" onClick={stopContinuousProcessing}>
                Parar
              </Button>
            </div>
          )}
          {!continuousProcessing && (
            <Button variant="outline" className="gap-2" onClick={() => { processAllCampaigns(); startContinuousProcessing() }} disabled={processing}>
              {processing ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
              {processing ? 'Processando...' : 'Processar Campanhas'}
            </Button>
          )}
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 border-sky-500/30 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400" disabled={exportingAll || campaigns.length === 0}>
                  {exportingAll ? <RefreshCw className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  Exportar
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAllCampaigns()} className="gap-2">
                  <FileSpreadsheet className="size-4" /> Todas as campanhas (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('running')} className="gap-2">
                  <Play className="size-4" /> Só em execução (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('completed')} className="gap-2">
                  <CheckCircle className="size-4" /> Só concluídas (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('paused')} className="gap-2">
                  <Pause className="size-4" /> Só pausadas (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAllCampaigns('cancelled')} className="gap-2">
                  <X className="size-4" /> Só canceladas (CSV)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger><TooltipContent>Exportar relatório de campanhas com filtros</TooltipContent></Tooltip></TooltipProvider>
          <Dialog open={createDialogOpen} onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) { setEditing(false); setSaving(false); resetNewCampaign(); setActiveStep(0) } }}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
                <Plus className="size-4" /> Nova Campanha
              </Button>
            </DialogTrigger>
          <DialogContent fullWidth className="h-[90vh]" showCloseButton>
            <DialogHeader className="px-6 py-4 border-b shrink-0">
              <DialogTitle>{editing ? 'Editar Campanha' : 'Criar Campanha'}</DialogTitle>
              <DialogDescription>{editing ? 'Modifique os dados da campanha' : 'Configure uma nova campanha de envio'}</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left: Configuration Panel - Compact Sidebar */}
              <div className="w-[30%] min-w-[300px] border-r overflow-y-auto p-4 space-y-3 bg-muted/10">
                {/* Campaign Name */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Type className="size-3" /> Nome da Campanha</Label>
                  <Input placeholder="Ex: Campanha Black Friday" value={newCampaign.name} onChange={e => setNewCampaign(prev => ({ ...prev, name: e.target.value }))} className="h-8 text-sm" />
                </div>

                {/* Contact List */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Users className="size-3" /> Lista de Contatos</Label>
                  <Select value={newCampaign.contactListId} onValueChange={v => setNewCampaign(prev => ({ ...prev, contactListId: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                    <SelectContent>
                      {availableLists.map(l => (
                        <SelectItem key={l.id} value={l.id}>
                          <div className="flex items-center gap-2">{l.name}<span className="text-xs text-muted-foreground">({l._count?.contacts || 0})</span></div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Scheduling */}
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><CalendarDays className="size-3" /> Agendamento</Label>
                  <Input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(prev => ({ ...prev, scheduledAt: e.target.value }))} className="h-8 text-sm" />
                  <p className="text-[10px] text-muted-foreground">Deixe vazio para executar imediatamente</p>
                </div>

                {/* Chips for Sending */}
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Smartphone className="size-3" /> Chips para envio</Label>
                  {/* Distribution mode toggle — show when multiple chips selected */}
                  {newCampaign.chipIds.length > 1 && (
                    <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-md">
                      <button type="button" onClick={() => setDistMode('absolute')} className={`flex-1 text-[10px] py-0.5 rounded transition-all ${distMode === 'absolute' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                        Número
                      </button>
                      <button type="button" onClick={() => setDistMode('percentage')} className={`flex-1 text-[10px] py-0.5 rounded transition-all ${distMode === 'percentage' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                        Porcentagem %
                      </button>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                    {/* Disconnected chips warning */}
                    {availableChips.filter(c => c.status !== 'connected').length > 0 && newCampaign.chipIds.some(id => availableChips.find(c => c.id === id && c.status !== 'connected')) && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[10px] text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span>Chips desconectados selecionados não enviarão mensagens!</span>
                      </div>
                    )}
                    {/* Connected chips first, then disconnected */}
                    {[...availableChips.filter(c => c.status === 'connected'), ...availableChips.filter(c => c.status !== 'connected')].map(chip => {
                      const isSelected = newCampaign.chipIds.includes(chip.id)
                      const isDisconnected = chip.status !== 'connected'
                      // Calculate chip capacity: use effective warming limit instead of raw dailyLimit
                      const effectiveInfo = getChipEffectiveInfo(chip)
                      const chipCapacity = Math.max(0, effectiveInfo.effectiveLimit - (chip.sentToday || 0))
                      // Get total contacts in selected list
                      const totalContacts = (() => {
                        const list = availableLists.find((l: any) => l.id === newCampaign.contactListId)
                        return list?._count?.contacts || 0
                      })()
                      // Current distribution value for this chip (absolute number)
                      const distValue = newCampaign.chipDistribution[chip.id] || 0
                      // Max for this chip = min(chipCapacity, totalContacts or chipCapacity)
                      const maxForChip = totalContacts > 0 ? Math.min(chipCapacity, totalContacts) : chipCapacity
                      // Calculate what other chips have already allocated
                      const otherChipsTotal = Object.entries(newCampaign.chipDistribution)
                        .filter(([id]) => id !== chip.id && newCampaign.chipIds.includes(id))
                        .reduce((sum, [, v]) => sum + (v || 0), 0)
                      // Effective max for this chip: can't exceed totalContacts minus what others already have
                      const effectiveMaxForChip = totalContacts > 0 ? Math.min(maxForChip, Math.max(0, totalContacts - otherChipsTotal)) : maxForChip
                      // Percentage representation
                      const distPct = totalContacts > 0 && distValue > 0 ? Math.round(distValue / totalContacts * 100) : 0
                      const maxPct = totalContacts > 0 ? Math.round(effectiveMaxForChip / totalContacts * 100) : 100
                      // Slider value and max depend on mode
                      const sliderValue = distMode === 'percentage' ? distPct : distValue
                      const sliderMax = distMode === 'percentage' ? maxPct : effectiveMaxForChip

                      return (
                        <div key={chip.id}>
                          <div onClick={() => toggleChip(chip.id)} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all text-sm ${isDisconnected ? 'opacity-60' : ''} ${isSelected ? (isDisconnected ? 'border-rose-400/60 bg-rose-50 dark:bg-rose-900/20' : 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-900/20 shadow-sm') : 'hover:bg-muted/50 border-transparent'}`}>
                            <div className={`size-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? (isDisconnected ? 'bg-rose-400 border-rose-400' : 'bg-emerald-500 border-emerald-500') : 'border-muted-foreground/40'}`}>
                              {isSelected && <Check className="size-3.5 text-white" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className={`text-xs font-medium truncate ${isSelected ? (isDisconnected ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300') : ''}`}>{chip.name}</p>
                                {isDisconnected && <span className="text-[9px] px-1 py-0.5 rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 whitespace-nowrap shrink-0">Desconectado</span>}
                              </div>
                              <p className="text-[10px] text-muted-foreground">{chip.phoneNumber} · <span className={`${isDisconnected ? 'text-rose-500' : 'text-emerald-600'} font-medium`}>{chipCapacity}</span> restantes/dia{effectiveInfo.effectiveLimit < (chip.dailyLimit || 200) ? ` (de ${chip.dailyLimit || 200})` : ''}</p>
                            </div>
                            {!isDisconnected && isSelected && chip.warmingPhase && chip.warmingPhase !== 'ready' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 whitespace-nowrap">
                                {chip.warmingPhase === 'nursery' ? 'Berçário' : 'Pré-aquec.'}
                              </span>
                            )}
                          </div>
                          {/* Distribution slider — shown when chip is selected AND there are multiple chips selected */}
                          {isSelected && newCampaign.chipIds.length > 1 && (
                            <div className="ml-7 mt-1 mb-2 px-3 py-2 bg-muted/30 rounded-lg space-y-1.5 border border-muted/50" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground font-medium">Distribuição</span>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    max={distMode === 'percentage' ? maxPct : effectiveMaxForChip}
                                    value={distMode === 'percentage' ? distPct || '' : distValue || ''}
                                    onChange={e => {
                                      const rawVal = parseInt(e.target.value, 10) || 0
                                      // Convert back to absolute number if in percentage mode
                                      // Clamp to effectiveMaxForChip to prevent exceeding total contacts
                                      const absVal = distMode === 'percentage'
                                        ? Math.min(Math.round(rawVal / 100 * totalContacts), effectiveMaxForChip)
                                        : Math.min(rawVal, effectiveMaxForChip)
                                      setNewCampaign(prev => ({
                                        ...prev,
                                        chipDistribution: { ...prev.chipDistribution, [chip.id]: absVal },
                                      }))
                                    }}
                                    className="w-14 h-5 text-[10px] text-center bg-background border border-muted rounded px-1 focus:border-emerald-500 focus:outline-none"
                                    placeholder="0"
                                  />
                                  <span className="text-[10px] text-muted-foreground">{distMode === 'percentage' ? '%' : 'contatos'}</span>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={sliderMax}
                                value={sliderValue}
                                onChange={e => {
                                  const rawVal = parseInt(e.target.value, 10)
                                  // Convert back to absolute number if in percentage mode
                                  // Clamp to effectiveMaxForChip to prevent exceeding total contacts
                                  const absVal = distMode === 'percentage'
                                    ? Math.min(Math.round(rawVal / 100 * totalContacts), effectiveMaxForChip)
                                    : Math.min(rawVal, effectiveMaxForChip)
                                  setNewCampaign(prev => ({
                                    ...prev,
                                    chipDistribution: { ...prev.chipDistribution, [chip.id]: absVal },
                                  }))
                                }}
                                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-500"
                              />
                              <div className="flex justify-between text-[9px] text-muted-foreground">
                                <span>Auto (igualitário)</span>
                                <span>Máx: {distMode === 'percentage' ? `${maxPct}%` : effectiveMaxForChip}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Distribution summary */}
                  {newCampaign.chipIds.length > 1 && (() => {
                    const totalContacts = (() => {
                      const list = availableLists.find((l: any) => l.id === newCampaign.contactListId)
                      return list?._count?.contacts || 0
                    })()
                    const manualTotal = Object.values(newCampaign.chipDistribution).reduce((sum: number, v: any) => sum + (v || 0), 0)
                    const autoChips = newCampaign.chipIds.filter(id => !newCampaign.chipDistribution[id] || newCampaign.chipDistribution[id] === 0)
                    const remaining = totalContacts - manualTotal
                    const exceedsTotal = totalContacts > 0 && manualTotal > totalContacts
                    // Also check if any chip's distribution exceeds its effective capacity (warming-aware)
                    const exceedsCapacity = newCampaign.chipIds.some(chipId => {
                      const chip = availableChips.find((c: any) => c.id === chipId)
                      if (!chip) return false
                      const effectiveInfo = getChipEffectiveInfo(chip)
                      const chipCap = Math.max(0, effectiveInfo.effectiveLimit - (chip.sentToday || 0))
                      const dist = newCampaign.chipDistribution[chipId] || 0
                      return dist > chipCap
                    })
                    // Check if any selected chip is disconnected
                    const hasDisconnectedChip = newCampaign.chipIds.some(chipId => {
                      const chip = availableChips.find((c: any) => c.id === chipId)
                      return chip && chip.status !== 'connected'
                    })
                    return (
                      <div className={`p-2 rounded-lg text-[10px] space-y-1 border ${exceedsTotal || exceedsCapacity ? 'bg-red-500/10 border-red-500/30' : 'bg-muted/30 border-muted/50'}`}>
                        {totalContacts > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Total de contatos:</span>
                            <span className="font-medium text-foreground">{totalContacts}</span>
                          </div>
                        )}
                        {manualTotal > 0 && totalContacts > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Alocados manualmente:</span>
                            <span className={`font-medium ${exceedsTotal ? 'text-red-500' : 'text-emerald-600'}`}>{manualTotal} ({Math.round(manualTotal / totalContacts * 100)}%)</span>
                          </div>
                        )}
                        {manualTotal > 0 && totalContacts === 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Alocados manualmente:</span>
                            <span className="font-medium text-emerald-600">{manualTotal}</span>
                          </div>
                        )}
                        {autoChips.length > 0 && remaining > 0 && totalContacts > 0 && !exceedsTotal && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Auto ({autoChips.length} chip{autoChips.length > 1 ? 's' : ''}, ~{Math.ceil(remaining / autoChips.length)} cada):</span>
                            <span className="font-medium text-foreground">{remaining}</span>
                          </div>
                        )}
                        {exceedsTotal && (
                          <p className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Total alocado excede contatos!</p>
                        )}
                        {exceedsCapacity && (
                          <p className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Um ou mais chips excedem a capacidade real (limite de aquecimento)!</p>
                        )}
                        {hasDisconnectedChip && !exceedsTotal && !exceedsCapacity && (
                          <p className="text-amber-600 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Chips desconectados não enviarão mensagens</p>
                        )}
                      </div>
                    )
                  })()}
                </div>

                <Separator />

                {/* Anti-Ban Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Shield className="size-3.5 text-emerald-500" />
                      <Label className="text-xs font-semibold">Proteção Anti-Ban</Label>
                    </div>
                    <Switch checked={newCampaign.antiBanEnabled} onCheckedChange={v => setNewCampaign(prev => ({ ...prev, antiBanEnabled: v }))} />
                  </div>
                  {newCampaign.antiBanEnabled && (
                    <div className="space-y-1.5 p-2.5 bg-muted/50 rounded-lg">
                      <Label className="text-[11px] font-medium">Modo de Aquecimento</Label>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { value: 'normal', label: 'Normal', icon: Shield, desc: 'Equilibrado' },
                          { value: 'agressive', label: 'Agressivo', icon: Flame, desc: 'Mais rápido' },
                          { value: 'stealth', label: 'Furtivo', icon: Snowflake, desc: 'Máx. segurança' },
                        ].map(m => (
                          <button key={m.value} type="button" onClick={() => setNewCampaign(prev => ({ ...prev, warmingMode: m.value }))}
                            className={`p-1.5 rounded-md border text-center transition-all ${newCampaign.warmingMode === m.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}>
                            <m.icon className={`size-3.5 mx-auto mb-0.5 ${newCampaign.warmingMode === m.value ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                            <p className="text-[11px] font-medium">{m.label}</p>
                            <p className="text-[9px] text-muted-foreground">{m.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Message Builder + Preview */}
              <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Editor Panel */}
                <div className="flex-1 flex flex-col min-h-0 border-r">
                  {/* Message Tabs with Drag & Drop */}
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={handleDragEnd}>
                    <SortableContext items={newCampaign.steps.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
                      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b shrink-0 bg-muted/20 overflow-x-auto">
                        {newCampaign.steps.map((step, idx) => {
                          const delayLabel = idx > 0 && step.delayMinutes > 0
                            ? `+${step.delayMinutes}${step.delayUnit === 'seconds' ? 'seg' : 'min'}`
                            : undefined
                          return (
                            <SortableTab
                              key={idx}
                              id={String(idx)}
                              idx={idx}
                              isActive={activeStep === idx}
                              canClose={newCampaign.steps.length > 1}
                              onClick={() => setActiveStep(idx)}
                              onClose={() => { removeStep(idx); setActiveStep(Math.max(0, idx > 0 ? idx - 1 : 0)) }}
                              isFollowUp={idx > 0}
                              delayLabel={delayLabel}
                              
                            />
                          )
                        })}
                        <div className="flex items-center gap-1 shrink-0">
                          {newCampaign.steps.length > 1 && (
                            <TooltipProvider><Tooltip><TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="gap-1 text-sky-600 h-7 px-2" onClick={() => duplicateStep(activeStep)}>
                                <Copy className="size-3.5" />
                                <span className="text-xs">Duplicar</span>
                              </Button>
                            </TooltipTrigger><TooltipContent>Duplicar mensagem atual</TooltipContent></Tooltip></TooltipProvider>
                          )}
                          <Button variant="ghost" size="sm" className="gap-1 text-emerald-600 h-7 px-2" onClick={addStep}>
                            <Plus className="size-3.5" />
                            <span className="text-xs">Adicionar mensagem</span>
                          </Button>
                        </div>
                      </div>
                    </SortableContext>
                  </DndContext>

                  {/* Active Step Content */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {newCampaign.steps.map((step, idx) => idx === activeStep && (
                      <div key={idx} className="space-y-3">
                        {/* Delay config for steps > 0 */}
                        {idx > 0 && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
                            <Clock className="size-3.5" />
                            <span>Atraso antes desta mensagem:</span>
                            <Input type="number" min={0} value={step.delayMinutes} onChange={e => updateStep(idx, 'delayMinutes', parseInt(e.target.value) || 0)} className="w-20 h-7 text-xs" />
                            <Select value={step.delayUnit} onValueChange={v => updateStep(idx, 'delayUnit', v)}>
                              <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="minutes">Minutos</SelectItem>
                                <SelectItem value="seconds">Segundos</SelectItem>
                              </SelectContent>
                            </Select>
                            <span>{step.delayUnit === 'minutes' ? 'min' : 'seg'} após mensagem anterior</span>
                          </div>
                        )}

                        <MessageBuilder value={step.content} onChange={v => updateStep(idx, 'content', v)} messageKeys={messageKeys} templates={templates} contactVariables={contactVariables} previewContactData={previewContact} rows={14} />

                        {/* Attach media */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium flex items-center gap-1"><Paperclip className="size-3" /> Anexar Mídia</Label>
                          <div className="flex gap-2">
                            <Select value={step.mediatype} onValueChange={v => updateStep(idx, 'mediatype', v)}>
                              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="image">Imagem</SelectItem>
                                <SelectItem value="video">Vídeo</SelectItem>
                                <SelectItem value="audio">Áudio</SelectItem>
                                <SelectItem value="document">Documento</SelectItem>
                                <SelectItem value="contact">Contato</SelectItem>
                                <SelectItem value="location">Localização</SelectItem>
                                <SelectItem value="link">Link</SelectItem>
                              </SelectContent>
                            </Select>
                            {['image','video','audio','document'].includes(step.mediatype) && (
                              <Input type="file" className="h-8 text-xs flex-1" accept={step.mediatype === 'image' ? 'image/*' : step.mediatype === 'video' ? 'video/*' : step.mediatype === 'audio' ? 'audio/*' : undefined} onChange={e => { const f = e.target.files?.[0] || null; updateStep(idx, 'mediaFile', f) }} />
                            )}
                          </div>
                          {step.mediatype === 'audio' && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Modo do Áudio</Label>
                              <div className="flex gap-2">
                                <button type="button" className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-all ${step.audioMode === 'whatsapp' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'border-border hover:bg-muted/50'}`} onClick={() => updateStep(idx, 'audioMode', 'whatsapp')}>
                                  <span className="font-medium">WhatsApp</span>
                                  <span className="block text-[10px] text-muted-foreground">Converte para OGG (nativo)</span>
                                </button>
                                <button type="button" className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-all ${step.audioMode === 'original' ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400' : 'border-border hover:bg-muted/50'}`} onClick={() => updateStep(idx, 'audioMode', 'original')}>
                                  <span className="font-medium">Personalizado</span>
                                  <span className="block text-[10px] text-muted-foreground">Mantém formato original</span>
                                </button>
                              </div>
                            </div>
                          )}
                          {['image','video'].includes(step.mediatype) && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Legenda</Label>
                              <Input placeholder="Legenda da imagem/vídeo..." value={step.caption} onChange={e => updateStep(idx, 'caption', e.target.value)} className="h-8 text-xs" />
                            </div>
                          )}
                          {step.mediatype === 'contact' && (
                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="Nome do contato" value={step.contactName} onChange={e => updateStep(idx, 'contactName', e.target.value)} className="h-8 text-xs" />
                              <Input placeholder="Telefone (5511999999999)" value={step.contactPhone} onChange={e => updateStep(idx, 'contactPhone', e.target.value)} className="h-8 text-xs" />
                            </div>
                          )}
                          {step.mediatype === 'location' && (
                            <div className="space-y-2">
                              <Input placeholder="Nome do local" value={step.locationName} onChange={e => updateStep(idx, 'locationName', e.target.value)} className="h-8 text-xs" />
                              <div className="grid grid-cols-2 gap-2">
                                <Input placeholder="Latitude" value={step.locationLat} onChange={e => updateStep(idx, 'locationLat', e.target.value)} className="h-8 text-xs" />
                                <Input placeholder="Longitude" value={step.locationLng} onChange={e => updateStep(idx, 'locationLng', e.target.value)} className="h-8 text-xs" />
                              </div>
                            </div>
                          )}
                          {step.mediatype === 'link' && (
                            <div className="space-y-2">
                              <Input placeholder="https://..." value={step.linkUrl} onChange={e => updateStep(idx, 'linkUrl', e.target.value)} className="h-8 text-xs" />
                              <div className="flex items-center gap-2">
                                <Switch checked={step.linkPreview} onCheckedChange={v => updateStep(idx, 'linkPreview', v)} />
                                <Label className="text-xs">Com visualização (preview)</Label>
                              </div>
                            </div>
                          )}
                          {step.mediaFile ? (
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg text-xs">
                              {step.mediatype === 'image' ? (
                                <img src={URL.createObjectURL(step.mediaFile)} alt="Preview" className="size-12 rounded object-cover border shrink-0" />
                              ) : step.mediatype === 'video' ? <Film className="size-3.5 text-sky-500" /> : step.mediatype === 'audio' ? <Music className="size-3.5 text-amber-500" /> : <FileIcon className="size-3.5 text-zinc-500" />}
                              <span className="truncate">{step.mediaFile.name}</span>
                              <span className="text-muted-foreground">({(step.mediaFile.size / 1024).toFixed(1)}KB)</span>
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => updateStep(idx, 'mediaFile', null)}><X className="size-3" /></Button>
                            </div>
                          ) : step.mediaUrl ? (
                            <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                              {step.mediatype === 'image' ? (
                                <img src={step.mediaUrl} alt="Preview" className="size-12 rounded object-cover border shrink-0" />
                              ) : step.mediatype === 'video' ? <Film className="size-3.5 text-sky-500" /> : step.mediatype === 'audio' ? <Music className="size-3.5 text-amber-500" /> : <FileIcon className="size-3.5 text-zinc-500" />}
                              <span className="truncate text-emerald-600 dark:text-emerald-400">Mídia salva</span>
                              <a href={step.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground underline truncate max-w-[120px]">abrir</a>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto text-red-500 hover:text-red-400" onClick={() => { updateStep(idx, 'mediaUrl', ''); updateStep(idx, 'mediatype', ''); }}><X className="size-3" /></Button></TooltipTrigger><TooltipContent>Remover mídia</TooltipContent></Tooltip></TooltipProvider>
                            </div>
                          ) : null}
                        </div>

                        {/* Variations (collapsible) */}
                        <details className="group border rounded-lg">
                          <summary className="flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-muted/30 rounded-lg transition-colors">
                            <div className="flex items-center gap-2">
                              <Shuffle className="size-3.5 text-amber-500" />
                              <Label className="text-xs font-semibold cursor-pointer">Variações da Mensagem {idx + 1}</Label>
                              {step.variations.length > 1 && (
                                <Badge variant="secondary" className="h-4 text-[10px] px-1.5">{step.variations.length}</Badge>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 text-xs text-emerald-600 gap-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); addVariation(idx) }}>
                              <Plus className="size-3" /> Variação
                            </Button>
                          </summary>
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-[11px] text-muted-foreground">Uma variação aleatória será escolhida para cada contato (anti-ban)</p>
                            {step.variations.map((v, vIdx) => (
                              <div key={vIdx} className="relative p-3 border rounded-lg space-y-2 bg-background/50">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-muted-foreground">Variação {vIdx + 1}</span>
                                  {step.variations.length > 1 && (
                                    <Button variant="ghost" size="sm" className="ml-auto text-rose-500 h-5 w-5 p-0" onClick={() => removeVariation(idx, vIdx)}>
                                      <X className="size-3" />
                                    </Button>
                                  )}
                                </div>
                                <Textarea placeholder={`Texto da variação ${vIdx + 1}...`} value={v.content} onChange={e => updateVariation(idx, vIdx, 'content', e.target.value)} rows={2} />
                                <div className="space-y-1.5">
                                  <div className="flex flex-wrap gap-1">
                                    <span className="text-[10px] text-muted-foreground font-medium w-full">📋 Contato</span>
                                    {CONTACT_VARIABLES.map(cv => (
                                      <Button key={cv.tag} variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30" onClick={() => updateVariation(idx, vIdx, 'content', v.content + cv.tag)}>
                                        {cv.icon} {cv.label}
                                      </Button>
                                    ))}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <span className="text-[10px] text-muted-foreground font-medium w-full">🔀 Blocos de Variação</span>
                                    {messageKeys.map(k => {
                                      let varCount = 0
                                      try { varCount = JSON.parse(k.variations).length } catch { /* ignore */ }
                                      return (
                                        <Button key={k.id} variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-900/30" onClick={() => {
                                          try {
                                            const vars = JSON.parse(k.variations)
                                            if (vars?.length) {
                                              updateVariation(idx, vIdx, 'content', v.content + `{{KEY: ${vars.join(' | ')}}}`)
                                            }
                                          } catch {
                                            updateVariation(idx, vIdx, 'content', v.content + `{{${k.name}}}`)
                                          }
                                        }} title={`${k.label} — ${varCount} variações`}>
                                          <Shuffle className="size-2.5" /> {k.label}
                                        </Button>
                                      )
                                    })}
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground">Se tiver mídia, o texto será a legenda/descrição</p>
                                {/* Anexar (variation) */}
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <Select value={v.mediatype} onValueChange={mt => updateVariation(idx, vIdx, 'mediatype', mt)}>
                                      <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="image">Imagem</SelectItem>
                                        <SelectItem value="video">Vídeo</SelectItem>
                                        <SelectItem value="audio">Áudio</SelectItem>
                                        <SelectItem value="document">Documento</SelectItem>
                                        <SelectItem value="contact">Contato</SelectItem>
                                        <SelectItem value="location">Localização</SelectItem>
                                        <SelectItem value="link">Link</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {['image','video','audio','document'].includes(v.mediatype) && (
                                      <Input type="file" className="h-7 text-xs flex-1" accept={v.mediatype === 'image' ? 'image/*' : v.mediatype === 'video' ? 'video/*' : v.mediatype === 'audio' ? 'audio/*' : undefined} onChange={e => { const f = e.target.files?.[0] || null; updateVariation(idx, vIdx, 'mediaFile', f) }} />
                                    )}
                                  </div>
                                  {['image','video'].includes(v.mediatype) && (
                                    <Input placeholder="Legenda..." value={v.caption} onChange={e => updateVariation(idx, vIdx, 'caption', e.target.value)} className="h-7 text-xs" />
                                  )}
                                  {v.mediatype === 'contact' && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input placeholder="Nome" value={v.contactName} onChange={e => updateVariation(idx, vIdx, 'contactName', e.target.value)} className="h-7 text-xs" />
                                      <Input placeholder="Telefone" value={v.contactPhone} onChange={e => updateVariation(idx, vIdx, 'contactPhone', e.target.value)} className="h-7 text-xs" />
                                    </div>
                                  )}
                                  {v.mediatype === 'location' && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input placeholder="Nome do local" value={v.locationName} onChange={e => updateVariation(idx, vIdx, 'locationName', e.target.value)} className="h-7 text-xs" />
                                      <Input placeholder="Lat, Lng" value={v.locationLat && v.locationLng ? `${v.locationLat}, ${v.locationLng}` : ''} onChange={e => { const [lat, lng] = e.target.value.split(',').map(s => s.trim()); updateVariation(idx, vIdx, 'locationLat', lat || ''); updateVariation(idx, vIdx, 'locationLng', lng || '') }} className="h-7 text-xs" />
                                    </div>
                                  )}
                                  {v.mediatype === 'link' && (
                                    <div className="space-y-1">
                                      <Input placeholder="https://..." value={v.linkUrl} onChange={e => updateVariation(idx, vIdx, 'linkUrl', e.target.value)} className="h-7 text-xs" />
                                      <div className="flex items-center gap-2">
                                        <Switch checked={v.linkPreview} onCheckedChange={val => updateVariation(idx, vIdx, 'linkPreview', val)} />
                                        <Label className="text-xs">Preview</Label>
                                      </div>
                                    </div>
                                  )}
                                  {v.mediaFile ? (
                                    <div className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg text-xs">
                                      {v.mediatype === 'image' ? (
                                        <img src={URL.createObjectURL(v.mediaFile)} alt="Preview" className="size-10 rounded object-cover border shrink-0" />
                                      ) : v.mediatype === 'video' ? <Film className="size-3 text-sky-500" /> : v.mediatype === 'audio' ? <Music className="size-3 text-amber-500" /> : <FileIcon className="size-3 text-zinc-500" />}
                                      <span className="truncate">{v.mediaFile.name}</span>
                                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 ml-auto" onClick={() => updateVariation(idx, vIdx, 'mediaFile', null)}><X className="size-2.5" /></Button>
                                    </div>
                                  ) : v.mediaUrl ? (
                                    <div className="flex items-center gap-2 p-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                                      {v.mediatype === 'image' ? (
                                        <img src={v.mediaUrl} alt="Preview" className="size-10 rounded object-cover border shrink-0" />
                                      ) : v.mediatype === 'video' ? <Film className="size-3 text-sky-500" /> : v.mediatype === 'audio' ? <Music className="size-3 text-amber-500" /> : <FileIcon className="size-3 text-zinc-500" />}
                                      <span className="truncate text-emerald-600 dark:text-emerald-400">Mídia salva</span>
                                      <a href={v.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground underline truncate max-w-[80px]">abrir</a>
                                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-4 w-4 p-0 ml-auto text-red-500 hover:text-red-400" onClick={() => { updateVariation(idx, vIdx, 'mediaUrl', ''); updateVariation(idx, vIdx, 'mediatype', ''); }}><X className="size-2.5" /></Button></TooltipTrigger><TooltipContent>Remover mídia</TooltipContent></Tooltip></TooltipProvider>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WhatsApp Preview Panel - 6.7" phone simulation */}
                <div className="w-[380px] shrink-0 flex flex-col bg-muted/10 overflow-hidden">
                  <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Eye className="size-3" /> Pré-visualização</p>
                    <span className="text-[10px] text-muted-foreground">6.7"</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-start p-3 overflow-y-auto min-h-0">
                    {/* Phone frame - 6.7" aspect ratio (~19.5:9) */}
                    <div className="w-full max-w-[340px] rounded-2xl border-4 border-zinc-800 dark:border-zinc-600 shadow-2xl bg-[#0b141a] flex flex-col" style={{ height: '90%', maxHeight: 'calc(90vh - 140px)' }}>
                      {/* WhatsApp status bar */}
                      <div className="flex items-center justify-between px-3 py-1 bg-[#1f2c34] text-white/60 text-[9px]">
                        <span>{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="flex items-center gap-1">
                          <span>5G</span>
                          <span>🔋</span>
                        </div>
                      </div>
                      {/* Chat header */}
                      <div className="flex items-center gap-2.5 px-3 py-2 bg-[#1f2c34]">
                        <div className="size-9 rounded-full bg-emerald-600/60 flex items-center justify-center text-white text-xs font-bold">C</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-white">Cliente</p>
                          <p className="text-[10px] text-emerald-200/60">online</p>
                        </div>
                        <div className="flex items-center gap-3 text-white/50">
                          <Video className="size-4" />
                          <Phone className="size-4" />
                          <MoreVertical className="size-4" />
                        </div>
                      </div>
                      {/* Chat body - scrollable */}
                      <div className="flex-1 bg-[#0b141a] p-3 space-y-2 overflow-y-auto min-h-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}>
                        {newCampaign.steps.map((step, idx) => {
                          // Resolve variables using real contact data from the linked list
                          const resolveVars = (text: string) => {
                            const replaceData: Record<string, string> = {}
                            if (previewContact?.customFields) {
                              try {
                                const customData = JSON.parse(previewContact.customFields)
                                for (const [key, value] of Object.entries(customData)) {
                                  replaceData[key.toLowerCase()] = String(value)
                                }
                              } catch { /* ignore */ }
                            }
                            if (!replaceData['nome'] && previewContact) replaceData['nome'] = previewContact.name
                            if (!replaceData['telefone'] && previewContact) replaceData['telefone'] = previewContact.phone
                            return text
                              .replace(/\{\{KEY:\s*([^}]+)\}\}/g, (_: string, vars: string) => {
                                const options = vars.split('|').map((s: string) => s.trim())
                                return options[0] || 'variação'
                              })
                              .replace(/\{\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}\}/g, (match: string, varName: string) => {
                                const key = varName.toLowerCase()
                                return replaceData[key] || match
                              })
                          }
                          const previewContent = resolveVars(step.content)
                          // Convert WhatsApp formatting to HTML for preview
                          const formatWhatsApp = (text: string) => {
                            return text
                              .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
                              .replace(/_([^_]+)_/g, '<em>$1</em>')
                              .replace(/~([^~]+)~/g, '<s>$1</s>')
                          }
                          if (!step.content && !step.mediaFile && !step.mediatype && !step.mediaUrl) return null
                          return (
                            <div key={idx} className="flex justify-end">
                              <div className="bg-[#005c4b] rounded-lg rounded-tr-none max-w-[280px] shadow-sm overflow-hidden">
                                {idx > 0 && step.delayMinutes > 0 && (
                                  <div className="text-[9px] text-white/40 px-2.5 pt-2 flex items-center gap-0.5">
                                    <Clock className="size-2" /> +{step.delayMinutes}{step.delayUnit === 'seconds' ? 'seg' : 'min'}
                                  </div>
                                )}
                                {/* Media attachment preview */}
                                {step.mediatype === 'image' && (step.mediaFile ? (
                                  <div className="relative">
                                    <img src={URL.createObjectURL(step.mediaFile)} alt="Preview" className="w-full max-h-[200px] object-cover" />
                                    {step.caption && <p className="text-[12px] text-white/90 px-2.5 pt-1.5 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: formatWhatsApp(resolveVars(step.caption)) }} />}
                                  </div>
                                ) : step.mediaUrl ? (
                                  <div className="relative">
                                    <img src={step.mediaUrl} alt="Preview" className="w-full max-h-[200px] object-cover" />
                                    {step.caption && <p className="text-[12px] text-white/90 px-2.5 pt-1.5 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: formatWhatsApp(resolveVars(step.caption)) }} />}
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center bg-[#1a3a2a] h-[140px] w-full">
                                    <div className="text-center">
                                      <ImageIcon className="size-8 text-white/30 mx-auto mb-1" />
                                      <p className="text-[10px] text-white/40">Imagem</p>
                                    </div>
                                  </div>
                                ))}
                                {step.mediatype === 'video' && (
                                  <div className="flex items-center justify-center bg-[#1a3a2a] h-[140px] w-full">
                                    <div className="text-center">
                                      <Film className="size-8 text-white/30 mx-auto mb-1" />
                                      <p className="text-[10px] text-white/40">Vídeo</p>
                                      <div className="size-10 rounded-full bg-white/20 flex items-center justify-center mx-auto mt-1">
                                        <div className="size-0 border-t-[6px] border-b-[6px] border-l-[10px] border-transparent border-l-white/70 ml-1" />
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'audio' && (
                                  <div className="flex items-center gap-2 px-3 py-3">
                                    <div className="size-8 rounded-full bg-white/10 flex items-center justify-center">
                                      <Play className="size-4 text-white/70 ml-0.5" />
                                    </div>
                                    <div className="flex-1 flex items-center gap-0.5">
                                      {Array.from({ length: 30 }).map((_, i) => (
                                        <div key={i} className="w-[2px] bg-white/40 rounded-full" style={{ height: `${Math.random() * 16 + 4}px` }} />
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'document' && (
                                  <div className="flex items-center gap-2.5 px-3 py-3 bg-[#1a3a2a]">
                                    <div className="size-10 rounded bg-blue-500/20 flex items-center justify-center">
                                      <FileIcon className="size-5 text-blue-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] text-white/80 truncate">{step.mediaFile?.name || 'Documento.pdf'}</p>
                                      <p className="text-[9px] text-white/40">{step.mediaFile ? `${(step.mediaFile.size / 1024).toFixed(0)} KB` : 'PDF'}</p>
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'contact' && (
                                  <div className="flex items-center gap-2.5 px-3 py-3 bg-[#1a3a2a]">
                                    <div className="size-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                      <User className="size-5 text-emerald-400" />
                                    </div>
                                    <div>
                                      <p className="text-[11px] text-white/80">{step.contactName || 'Nome do contato'}</p>
                                      <p className="text-[9px] text-white/40">{step.contactPhone || 'Telefone'}</p>
                                    </div>
                                  </div>
                                )}
                                {step.mediatype === 'location' && (
                                  <div className="bg-[#1a3a2a] p-2">
                                    <div className="h-[100px] rounded bg-emerald-900/30 flex items-center justify-center">
                                      <MapPin className="size-6 text-emerald-400/60" />
                                    </div>
                                    {step.locationName && <p className="text-[11px] text-white/70 mt-1.5 px-1">{step.locationName}</p>}
                                  </div>
                                )}
                                {step.mediatype === 'link' && step.linkPreview && (
                                  <div className="bg-[#1a3a2a] overflow-hidden">
                                    <div className="h-[80px] bg-gradient-to-br from-sky-900/40 to-blue-900/40 flex items-center justify-center">
                                      <Globe className="size-6 text-sky-400/60" />
                                    </div>
                                    <div className="px-2.5 py-1.5">
                                      <p className="text-[9px] text-white/40 truncate">{step.linkUrl || 'https://...'}</p>
                                      <p className="text-[10px] text-white/60">Preview do link</p>
                                    </div>
                                  </div>
                                )}
                                {/* Text content */}
                                {previewContent && (
                                  <p className="text-[13px] text-white/90 whitespace-pre-wrap break-words leading-[1.5] px-2.5 py-1" dangerouslySetInnerHTML={{ __html: formatWhatsApp(previewContent) }} />
                                )}
                                {/* Timestamp */}
                                <div className="flex items-center justify-end gap-0.5 px-2.5 pb-1.5">
                                  <span className="text-[9px] text-white/40">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <svg className="size-3.5 text-blue-400" viewBox="0 0 16 16" fill="currentColor"><path d="M12.354 4.354a.5.5 0 00-.708-.708L5.5 9.793 3.354 7.646a.5.5 0 10-.708.708l2.5 2.5a.5.5 0 00.708 0l6.5-6.5z"/><path d="M15 8A7 7 0 111 8a7 7 0 0114 0zm-1 0A6 6 0 102 8a6 6 0 0012 0z"/></svg>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        {newCampaign.steps.every(s => !s.content && !s.mediaFile && !s.mediatype && !s.mediaUrl) && (
                          <div className="flex items-center justify-center h-[320px]">
                            <p className="text-xs text-white/30 text-center">Comece a digitar sua mensagem<br/>para ver a pré-visualização</p>
                          </div>
                        )}
                      </div>
                      {/* Input bar - simulated label */}
                      <div className="shrink-0 flex items-center justify-center px-3 py-1.5 bg-[#1f2c34]">
                        <span className="text-[9px] text-white/25 italic">Visualização de mensagem simulada</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="px-6 py-3 border-t shrink-0 flex-col items-stretch sm:flex-row sm:items-center">
              {!canCreate && !saving && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1 sm:mb-0 sm:mr-auto">
                  <AlertCircle className="size-3" />
                  {!newCampaign.name.trim() ? 'Informe o nome da campanha' : newCampaign.chipIds.length === 0 ? 'Selecione pelo menos 1 chip para envio' : 'Preencha pelo menos 1 mensagem (texto ou mídia)'}
                </p>
              )}
              {canCreate && !saving && !editing && (
                <div className="flex items-center gap-3 mb-1 sm:mb-0 sm:mr-auto text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Smartphone className="size-3" /> {newCampaign.chipIds.length} chip{newCampaign.chipIds.length !== 1 ? 's' : ''}</span>
                  <span className="flex items-center gap-1"><ArrowRight className="size-3" /> {newCampaign.steps.length} mensagem{newCampaign.steps.length !== 1 ? 'ns' : ''}</span>
                  <span className="flex items-center gap-1"><Clock className="size-3" /> {newCampaign.sendIntervalMin}-{newCampaign.sendIntervalMax}s entre envios</span>
                </div>
              )}
              <div className="flex gap-2 sm:ml-auto">
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                {!editing && (
                  <Button variant="outline" onClick={() => createCampaign(true)} disabled={!newCampaign.name.trim() || saving} className="gap-1">
                    {saving ? <><RefreshCw className="size-4 animate-spin" /> Salvando...</> : <><Save className="size-4" /> Salvar Rascunho</>}
                  </Button>
                )}
                <Button onClick={() => createCampaign(false)} disabled={!canCreate || saving} className="bg-emerald-600 hover:bg-emerald-700">
                  {saving ? <><RefreshCw className="size-4 animate-spin" /> Salvando...</> : editing ? 'Salvar Alterações' : 'Criar Campanha'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nenhuma campanha criada"
          description="Crie sua primeira campanha para começar a enviar mensagens em massa via WhatsApp."
          action={{ label: 'Criar primeira campanha', onClick: () => setCreateDialogOpen(true) }}
        />
      ) : (
        <>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {[
              { value: 'all', label: 'Todas' },
              { value: 'running', label: 'Executando' },
              { value: 'paused', label: 'Pausadas' },
              { value: 'completed', label: 'Concluídas' },
              { value: 'cancelled', label: 'Canceladas' },
              { value: 'draft', label: 'Rascunhos' },
            ].map(f => {
              const count = f.value === 'all' ? campaigns.length : campaigns.filter(c => c.status === f.value).length
              return (
                <button key={f.value} onClick={() => setCampaignFilter(f.value as any)}
                  className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    campaignFilter === f.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {f.label} ({count})
                </button>
              )
            })}
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Buscar campanha por nome..." value={campaignSearch} onChange={e => setCampaignSearch(e.target.value)} className="h-9 pl-8 text-sm" />
          </div>
        </div>
        <div className="space-y-4">
          {(() => {
            const filtered = campaigns.filter(c => {
              const matchFilter = campaignFilter === 'all' || c.status === campaignFilter
              const matchSearch = !campaignSearch || c.name.toLowerCase().includes(campaignSearch.toLowerCase())
              return matchFilter && matchSearch
            })
            // Agrupar por data
            const groups: { label: string; items: typeof filtered }[] = []
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const yesterday = new Date(today.getTime() - 86400000)
            const weekAgo = new Date(today.getTime() - 7 * 86400000)
            const addToGroup = (label: string, item: typeof filtered[0]) => {
              let g = groups.find(g => g.label === label)
              if (!g) { g = { label, items: [] }; groups.push(g) }
              g.items.push(item)
            }
            for (const c of filtered) {
              const d = new Date(c.createdAt)
              if (d >= today) addToGroup('Hoje', c)
              else if (d >= yesterday) addToGroup('Ontem', c)
              else if (d >= weekAgo) addToGroup('Esta semana', c)
              else addToGroup('Mais antigas', c)
            }
            return groups.map(group => (
              <div key={group.label}>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4 first:mt-0">{group.label} ({group.items.length})</h4>
                <div className="space-y-3">
                {group.items.map((c, i) => (

            <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className={cn('shadow-lg hover:shadow-xl transition-all duration-200 border-l-4',
                c.status === 'running' ? 'border-l-emerald-500' :
                c.status === 'paused' ? 'border-l-amber-500' :
                c.status === 'completed' ? 'border-l-sky-500' :
                c.status === 'cancelled' ? 'border-l-rose-500' :
                'border-l-zinc-300 dark:border-l-zinc-700')}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
                      <Send className="size-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{c.name}</h3>
                        <StatusBadge status={c.status} />
                        {c.status === 'paused' && c.statusReason && (
                          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-3 shrink-0" />
                            <span className="truncate">{c.statusReason}</span>
                          </div>
                        )}
                        {c.antiBanEnabled && (
                          <Badge variant="outline" className="gap-1 text-xs text-emerald-600 border-emerald-300">
                            <Shield className="size-3" /> Anti-Ban
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Smartphone className="size-3" /> {c.chips?.length || 0} chips</span>
                        {c.chips && c.chips.length > 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground/70">
                            {c.chips.slice(0, 2).map((cc, idx) => (
                              <span key={cc.chipId} className="flex items-center gap-0.5">
                                {idx > 0 && <span>·</span>}
                                <span className="truncate max-w-[80px]">{cc.chip?.name || cc.chip?.phoneNumber}</span>
                              </span>
                            ))}
                            {c.chips.length > 2 && <span>+{c.chips.length - 2}</span>}
                          </span>
                        )}
                        {(() => {
                          const msc = c.messageStatusCounts || {}
                          const total = (msc.pending || 0) + (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0) + (msc.failed || 0)
                          const done = (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0)
                          const failed = msc.failed || 0
                          if (total > 0 && done + failed > 0) {
                            const successRate = Math.round((done / (done + failed)) * 100)
                            return <span className={cn('flex items-center gap-1 font-medium', successRate >= 80 ? 'text-emerald-600' : successRate >= 50 ? 'text-amber-600' : 'text-rose-600')}>{successRate}% sucesso</span>
                          }
                          return null
                        })()}
                        {c.contactList && <span className="flex items-center gap-1"><Users className="size-3" /> {c.contactList.name}</span>}
                        {c.scheduledAt && <span className="flex items-center gap-1"><CalendarDays className="size-3" /> {new Date(c.scheduledAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                        {c.sequenceSteps?.length > 0 && <span className="flex items-center gap-1"><ArrowRight className="size-3" /> {c.sequenceSteps.length} mensagens</span>}
                      </div>
                      {/* Live message progress bar */}
                      {(() => {
                        const msc = c.messageStatusCounts || {}
                        const total = (msc.pending || 0) + (msc.sending || 0) + (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0) + (msc.failed || 0)
                        const done = (msc.sent || 0) + (msc.delivered || 0) + (msc.read || 0)
                        const failed = msc.failed || 0
                        const pending = (msc.pending || 0) + (msc.sending || 0)
                        if (total === 0) return null
                        const pct = Math.round((done / total) * 100)
                        const isRunning = c.status === 'running'
                        const barColor = pct === 100 ? 'bg-emerald-500' : failed > 0 ? 'bg-amber-500' : 'bg-sky-500'
                        return (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-2">
                                {done > 0 && <span className="text-emerald-600 font-medium">{done} enviada{done !== 1 ? 's' : ''}</span>}
                                {failed > 0 && <span className="text-rose-500 font-medium">{failed} falha{failed !== 1 ? 's' : ''}</span>}
                                {pending > 0 && <span className="text-muted-foreground">{pending} pendente{pending !== 1 ? 's' : ''}</span>}
                              </span>
                              <span className="flex items-center gap-2">
                                {isRunning && pending > 0 && (() => {
                                  const avgInterval = (c.sendIntervalMin + c.sendIntervalMax) / 2
                                  const chipsCount = c.chips?.length || 1
                                  const totalSecs = (pending * avgInterval) / chipsCount
                                  const hrs = Math.floor(totalSecs / 3600)
                                  const mins = Math.ceil((totalSecs % 3600) / 60)
                                  return <span className="text-amber-600 dark:text-amber-400 font-medium">~{hrs > 0 ? `${hrs}h ` : ''}{mins}min restante</span>
                                })()}
                                <span className="font-semibold text-muted-foreground">{pct}%</span>
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
                              {done > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />}
                              {failed > 0 && <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${(failed / total) * 100}%` }} />}
                              {pending > 0 && <div className="h-full bg-muted-foreground/30 transition-all duration-500" style={{ width: `${(pending / total) * 100}%` }} />}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                    <div className="flex gap-2">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => openDetail(c)}><Eye className="size-4" /></Button>
                      </TooltipTrigger><TooltipContent>Detalhes</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400 border-sky-500/30" onClick={() => exportCampaign(c.id, c.name)} disabled={exportingId === c.id}>
                          {exportingId === c.id ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                        </Button>
                      </TooltipTrigger><TooltipContent>Exportar relatório</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => duplicateCampaign(c)}><Copy className="size-3.5" /> Duplicar</Button>
                      </TooltipTrigger><TooltipContent>Criar cópia desta campanha</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => saveCampaignAsTemplate(c)}><BookmarkPlus className="size-3.5" /> Template</Button>
                      </TooltipTrigger><TooltipContent>Salvar como template</TooltipContent></Tooltip></TooltipProvider>
                      {['draft', 'paused', 'scheduled'].includes(c.status) && <Button variant="outline" size="sm" className="gap-1" onClick={() => { setSelectedCampaign(c); startEditing(c); setCreateDialogOpen(true) }}><Pencil className="size-3.5" /> Editar</Button>}
                      {c.status === 'draft' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={startingCampaignIds.has(c.id)} onClick={() => startCampaignAction(c.id)}>{startingCampaignIds.has(c.id) ? <><Loader2 className="size-3.5 animate-spin" /> Iniciando...</> : <><Play className="size-3.5" /> Iniciar</>}</Button>}
                      {c.status === 'running' && <Button variant="outline" size="sm" className="gap-1 text-amber-600 hover:text-amber-700 border-amber-200" onClick={async () => { try { await fetch(`/api/campaigns/${c.id}/pause`, { method: 'POST' }); toast.success('Campanha pausada!'); fetchCampaigns() } catch { toast.error('Erro ao pausar') } }}><Pause className="size-3.5" /> Pausar</Button>}
                      {c.status === 'paused' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={async () => { try { await fetch(`/api/campaigns/${c.id}/resume`, { method: 'POST' }); toast.success('Campanha retomada!'); fetchCampaigns() } catch { toast.error('Erro ao retomar') } }}><Play className="size-3.5" /> Retomar</Button>}
                      {(c.status === 'running' || c.status === 'paused') && <Button variant="outline" size="sm" className="gap-1 text-rose-600 hover:text-rose-700 border-rose-200" onClick={() => setCancelConfirm(c.id)}><X className="size-3.5" /> Cancelar</Button>}
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className="text-rose-500 hover:text-rose-600" onClick={() => setDeleteConfirm(c.id)}><Trash2 className="size-3.5" /></Button></TooltipTrigger><TooltipContent>Excluir campanha</TooltipContent></Tooltip></TooltipProvider>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
                ))}
                </div>
              </div>
            ))
          })()}
        </div>
        </>
      )}

      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}
        title="Remover Campanha" description="Tem certeza? Esta ação não pode ser desfeita."
        onConfirm={() => { if (deleteConfirm) deleteCampaign(deleteConfirm) }} confirmLabel="Remover" variant="destructive" />

      <ConfirmDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}
        title="Cancelar Campanha" description="Tem certeza que deseja cancelar esta campanha? As mensagens já enviadas não serão desfeitas, mas o envio será interrompido."
        onConfirm={() => { if (cancelConfirm) updateCampaignStatus(cancelConfirm, 'cancelled'); setCancelConfirm(null) }} confirmLabel="Sim, cancelar" variant="destructive" />

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setEditing(false) }}>
        <DialogContent fullWidth className="max-h-[90vh] !p-0">
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b">
            <DialogTitle className="flex items-center justify-between gap-3">
              <span className="truncate">{selectedCampaign?.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {selectedCampaign?.status === 'draft' && (
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={startingCampaignIds.has(selectedCampaign.id)} onClick={() => startCampaignAction(selectedCampaign.id)}>
                    {startingCampaignIds.has(selectedCampaign.id) ? <><Loader2 className="size-3.5 animate-spin" /> Iniciando...</> : <><Play className="size-3.5" /> Iniciar</>}
                  </Button>
                )}
                {selectedCampaign?.status === 'running' && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { try { await fetch(`/api/campaigns/${selectedCampaign.id}/pause`, { method: 'POST' }); toast.success('Campanha pausada!'); fetchCampaigns(); if (selectedCampaign) { const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' }); if (res.ok) setSelectedCampaign(await res.json()) } } catch { toast.error('Erro ao pausar') } }}>
                    <Pause className="size-3.5" /> Pausar
                  </Button>
                )}
                {selectedCampaign?.status === 'paused' && (
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={async () => { try { await fetch(`/api/campaigns/${selectedCampaign.id}/resume`, { method: 'POST' }); toast.success('Campanha retomada!'); fetchCampaigns(); if (selectedCampaign) { const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' }); if (res.ok) setSelectedCampaign(await res.json()) } } catch { toast.error('Erro ao retomar') } }}>
                    <Play className="size-3.5" /> Retomar
                  </Button>
                )}
                {selectedCampaign && (selectedCampaign.status === 'running' || selectedCampaign.status === 'paused') && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-rose-600 hover:text-rose-700 border-rose-200" onClick={async () => { await updateCampaignStatus(selectedCampaign.id, 'cancelled'); const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' }); if (res.ok) setSelectedCampaign(await res.json()) }}>
                    <X className="size-3.5" /> Cancelar
                  </Button>
                )}
                {selectedCampaign && ['draft', 'paused', 'scheduled'].includes(selectedCampaign.status) && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-amber-500 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20" onClick={() => startEditing(selectedCampaign)}>
                    <Pencil className="size-3.5" /> Editar
                  </Button>
                )}
                {selectedCampaign && (selectedCampaign.messageStatusCounts?.failed || 0) > 0 && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                    if (!selectedCampaign) return
                    try {
                      const res = await fetch('/api/messages/resend-all-failed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: selectedCampaign.id }) })
                      const data = await res.json()
                      if (res.ok) { toast.success(`${data.resetCount || 0} mensagens reenviadas`); const msgRes = await fetch(`/api/messages?campaignId=${selectedCampaign.id}&limit=5000`, { cache: 'no-store' }); const _r = await msgRes.json(); setDetailMessages(Array.isArray(_r?.data) ? _r.data : Array.isArray(_r) ? _r : []); fetchCampaigns() }
                      else toast.error(data.error || 'Erro ao reenviar')
                    } catch { toast.error('Erro ao reenviar mensagens') }
                  }}>
                    <RotateCcw className="size-3.5" /> Reenviar falhadas ({selectedCampaign.messageStatusCounts?.failed})
                  </Button>
                )}
                {selectedCampaign?.status === 'paused' && (selectedCampaign.messageStatusCounts?.pending || 0) > 0 && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => {
                    if (!selectedCampaign) return
                    // Initialize redistribution state from current campaign chips
                    const currentDist: Record<string, number> = {}
                    for (const cc of (selectedCampaign.chips || [])) {
                      currentDist[cc.chipId] = cc.contactLimit || 0
                    }
                    setRedistributeDistribution(currentDist)
                    setDistMode('absolute')
                    setRedistributeDialogOpen(true)
                  }}>
                    <ArrowRightLeft className="size-3.5" /> Redistribuir
                  </Button>
                )}
                <Button variant="outline" size="sm" className="gap-1.5" disabled={refreshingDetail} onClick={async () => {
                  if (!selectedCampaign) return
                  setRefreshingDetail(true)
                  const startTime = Date.now()
                  try {
                    const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' })
                    if (!res.ok) throw new Error('Erro ao buscar campanha')
                    const updated = await res.json()
                    setSelectedCampaign(updated)
                    const msgRes = await fetch(`/api/messages?campaignId=${updated.id}`, { cache: 'no-store' })
                    const msgData = await msgRes.json()
                    setDetailMessages(Array.isArray(msgData?.data) ? msgData.data : Array.isArray(msgData) ? msgData : [])
                    fetchCampaigns()
                    const elapsed = Date.now() - startTime
                    if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed))
                    toast.success('Campanha atualizada!')
                  } catch { toast.error('Erro ao atualizar campanha') }
                  finally { setRefreshingDetail(false) }
                }}>
                  <RefreshCw className={`size-3.5 ${refreshingDetail ? 'animate-spin' : ''}`} /> Atualizar
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm"><MoreVertical className="size-3.5" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {selectedCampaign && (
                      <DropdownMenuItem onClick={() => exportCampaign(selectedCampaign.id, selectedCampaign.name)}>
                        <Download className="size-3.5 mr-2" /> Exportar relatório
                      </DropdownMenuItem>
                    )}
                    {selectedCampaign && (
                      <DropdownMenuItem onClick={() => duplicateCampaign(selectedCampaign)}>
                        <Copy className="size-3.5 mr-2" /> Duplicar
                      </DropdownMenuItem>
                    )}
                    {selectedCampaign && (
                      <DropdownMenuItem onClick={() => saveCampaignAsTemplate(selectedCampaign)}>
                        <BookmarkPlus className="size-3.5 mr-2" /> Salvar como template
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => { setDeleteConfirm(selectedCampaign?.id || null); setDetailDialogOpen(false) }}>
                      <Trash2 className="size-3.5 mr-2" /> Excluir campanha
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </DialogTitle>
            <DialogDescription>Detalhes da campanha</DialogDescription>
          </DialogHeader>
          {selectedCampaign && (
            <div className="flex gap-6 overflow-hidden p-6">
              {/* Left panel - Stats */}
              <div className="w-64 shrink-0 space-y-3 overflow-y-auto max-h-[65vh]">
                {/* Paused status reason alert */}
                {selectedCampaign.status === 'paused' && selectedCampaign.statusReason && (
                  <Alert className="mb-3 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                    <AlertTriangle className="size-4 text-amber-600" />
                    <AlertTitle className="text-amber-800 dark:text-amber-300">Campanha pausada</AlertTitle>
                    <AlertDescription className="text-amber-700 dark:text-amber-400">{selectedCampaign.statusReason}</AlertDescription>
                  </Alert>
                )}
                {/* Chip daily limit warning */}
                {detailMessages.some(m => m.status === 'failed' && m.error && (/limite/i.test(m.error) || /daily_limit/i.test(m.error))) && (
                  <Alert variant="destructive" className="mb-3">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Chip atingiu o limite diário</AlertTitle>
                    <AlertDescription>Um dos chips atribuídos atingiu o limite de envio do dia. As mensagens pendentes foram reatribuídas a outros chips ou aguardarão até amanhã.</AlertDescription>
                  </Alert>
                )}
                {continuousProcessing && continuousStats.remaining === 0 && continuousStats.processed === 0 && (() => {
                  // Detect if any campaign chip is in cooldown
                  const cooldownChips = (selectedCampaign?.chips || [])
                    .map((cc: any) => cc.chip)
                    .filter((c: any) => c && c.cooldownUntil && new Date(c.cooldownUntil) > new Date())
                  if (cooldownChips.length > 0) {
                    const chipNames = cooldownChips.map((c: any) => c.name).join(', ')
                    const minCooldown = Math.min(...cooldownChips.map((c: any) => Math.ceil((new Date(c.cooldownUntil).getTime() - Date.now()) / 60000)))
                    return (
                      <Alert className="mb-3 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                        <Clock className="size-4 text-amber-600" />
                        <AlertTitle className="text-amber-700">Chip em cooldown</AlertTitle>
                        <AlertDescription className="text-amber-600">
                          <span className="font-semibold">{chipNames}</span> está em pausa de segurança (cooldown). Envio retoma automaticamente em <span className="font-bold">{minCooldown}min</span>. Isso protege contra banimento do WhatsApp.
                        </AlertDescription>
                      </Alert>
                    )
                  }
                  return (
                    <Alert variant="destructive" className="mb-3">
                      <AlertCircle className="size-4" />
                      <AlertTitle>Processamento parado</AlertTitle>
                      <AlertDescription>Nenhuma mensagem está sendo processada. Verifique os chips atribuídos abaixo.</AlertDescription>
                    </Alert>
                  )
                })()}
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={selectedCampaign.status} />
                  {selectedCampaign.antiBanEnabled && <Badge variant="outline" className="gap-1 text-emerald-600"><Shield className="size-3" /> Anti-Ban</Badge>}
                  <Badge variant="outline" className="gap-1">{selectedCampaign.warmingMode === 'stealth' ? <><Snowflake className="size-3" /> Furtivo</> : selectedCampaign.warmingMode === 'agressive' ? <><Flame className="size-3" /> Agressivo</> : <><Shield className="size-3" /> Normal</>}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Pendentes</p><p className="text-lg font-bold">{detailMessageCounts.pending}</p></CardContent></Card>
                  <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Enviadas</p><p className="text-lg font-bold text-sky-600">{detailMessageCounts.sent}</p></CardContent></Card>
                  <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Entregues</p><p className="text-lg font-bold text-emerald-600">{detailMessageCounts.delivered}</p></CardContent></Card>
                  <Card className="shadow"><CardContent className="p-2 text-center"><p className="text-[10px] text-muted-foreground">Falharam</p><p className="text-lg font-bold text-rose-600">{detailMessageCounts.failed}</p></CardContent></Card>
                </div>
                {/* Chips atribuídos com status de cooldown */}
                {selectedCampaign.chips && selectedCampaign.chips.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Chips Atribuídos</Label>
                    {selectedCampaign.chips.map((cc: any) => {
                      const chip = cc.chip
                      if (!chip) return null
                      const inCooldown = chip.cooldownUntil && new Date(chip.cooldownUntil) > new Date()
                      const cooldownMin = inCooldown ? Math.ceil((new Date(chip.cooldownUntil).getTime() - Date.now()) / 60000) : 0
                      const chipInfo = getChipEffectiveInfo(chip)
                      const isPaused = chip.paused === true
                      return (
                        <div key={chip.id} className={`p-2 rounded-lg text-xs flex items-center gap-2 ${isPaused ? 'bg-zinc-100 dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-700' : inCooldown ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : chip.status === 'connected' ? 'bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'}`}>
                          <div className={`size-2.5 rounded-full shrink-0 ${isPaused ? 'bg-zinc-400' : chip.status === 'connected' ? 'bg-emerald-500' : chip.status === 'disconnected' ? 'bg-zinc-400' : 'bg-rose-500'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{chip.name}</span>
                              <span className="text-muted-foreground">{chip.phoneNumber}</span>
                              {isPaused && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-400">⏸ Pausado</Badge>}
                              {chip.status !== 'connected' && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Desconectado</Badge>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-muted-foreground">{chip.sentToday || 0}/{chipInfo.effectiveLimit} enviadas hoje</span>
                              {chipInfo.effectiveLimit < (chip.dailyLimit ?? 200) && (
                                <span className="text-[10px] text-muted-foreground">(de {chip.dailyLimit ?? 200})</span>
                              )}
                              {inCooldown && (
                                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 text-[9px] px-1.5 py-0 h-4">
                                  <Clock className="size-2.5" /> Cooldown {cooldownMin}min
                                </Badge>
                              )}
                              {chip.warmingPhase && chip.warmingPhase !== 'ready' && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                  {chip.warmingPhase === 'nursery' ? '🌿 Aquecendo' : chip.warmingPhase === 'prewarm' ? '🔥 Pré-aquecimento' : chip.warmingPhase}
                                </Badge>
                              )}
                              {isPaused && chip.pauseReason && (
                                <span className="text-[10px] text-muted-foreground italic truncate" title={chip.pauseReason}>— {chip.pauseReason}</span>
                              )}
                            </div>
                          </div>
                          {inCooldown && !isPaused && (
                            <div className="text-right shrink-0">
                              <p className="text-amber-600 font-medium text-[10px]">Retoma em</p>
                              <p className="text-amber-700 font-bold text-xs">{cooldownMin}min</p>
                            </div>
                          )}
                          {/* PROBLEMA 4: Botão de pausa individual — só para chips conectados */}
                          {chip.status === 'connected' && (
                            <button
                              onClick={() => toggleChipPause(chip.id, isPaused, chip.name)}
                              disabled={chip.status !== 'connected'}
                              title={isPaused ? 'Retomar envios deste chip' : 'Pausar envios deste chip (continua conectado ao WhatsApp)'}
                              className={`shrink-0 inline-flex items-center justify-center size-7 rounded-md transition-colors ${isPaused ? 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'}`}
                            >
                              {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {selectedCampaign.contactList && (
                  <div className="text-xs text-muted-foreground">
                    <p>Lista: <span className="font-medium text-foreground">{selectedCampaign.contactList.name}</span></p>
                    <p>Intervalo: <span className="font-medium text-foreground">{selectedCampaign.sendIntervalMin}-{selectedCampaign.sendIntervalMax}s</span></p>
                  </div>
                )}
              </div>
              {/* Right panel - Messages & Details */}
              <div className="flex-1 min-w-0 space-y-3 overflow-y-auto max-h-[65vh]">
                {detailMessages.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs font-semibold">Mensagens</Label>
                      <span className="text-[10px] text-muted-foreground">
                        {(() => {
                          const filtered = detailMessages.filter(m => {
                            const matchStatus = detailStatusFilter === 'all' || m.status === detailStatusFilter
                            const q = detailSearchQuery.toLowerCase()
                            const matchSearch = !q || m.contact?.name?.toLowerCase().includes(q) || m.contact?.phone?.includes(q)
                            return matchStatus && matchSearch
                          })
                          return `${filtered.length} de ${detailMessages.length}`
                        })()}
                      </span>
                    </div>
                    {/* Search + Sort + Status Filter Bar */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Buscar por nome ou telefone..."
                            className="pl-8 h-8 text-xs"
                            value={detailSearchQuery}
                            onChange={e => setDetailSearchQuery(e.target.value)}
                          />
                        </div>
                        <Select value={detailSortBy} onValueChange={(v: string) => setDetailSortBy(v as 'name' | 'sendOrder')}>
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="name">Ordem alfabética</SelectItem>
                            <SelectItem value="sendOrder">Ordem de envio</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-1 overflow-x-auto pb-0.5">
                        {[
                          { value: 'all', label: 'Todas' },
                          { value: 'pending', label: 'Pendentes' },
                          { value: 'sent', label: 'Enviadas' },
                          { value: 'delivered', label: 'Entregues' },
                          { value: 'failed', label: 'Falharam' },
                        ].map(tab => {
                          const count = tab.value === 'all' ? detailMessageCounts.total : (detailMessageCounts as any)[tab.value] || 0
                          const isActive = detailStatusFilter === tab.value
                          return (
                            <button
                              key={tab.value}
                              onClick={() => setDetailStatusFilter(tab.value)}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${
                                isActive
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                              }`}
                            >
                              {tab.label} {count > 0 && `(${count})`}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {/* Message List — Tree-style grouped by contact */}
                    <div className="space-y-0.5">
                      {(() => {
                        const filtered = detailMessages.filter(m => {
                          const matchStatus = detailStatusFilter === 'all' || m.status === detailStatusFilter
                          const q = detailSearchQuery.toLowerCase()
                          const matchSearch = !q || m.contact?.name?.toLowerCase().includes(q) || m.contact?.phone?.includes(q)
                          return matchStatus && matchSearch
                        })
                        const sorted = [...filtered].sort((a, b) => {
                          if (detailSortBy === 'name') {
                            const nameA = a.contact?.name || '—'
                            const nameB = b.contact?.name || '—'
                            return nameA.localeCompare(nameB, 'pt-BR')
                          }
                          const statusPriority: Record<string, number> = { sent: 0, delivered: 0, read: 0, pending: 1, failed: 2 }
                          const prioA = statusPriority[a.status] ?? 3
                          const prioB = statusPriority[b.status] ?? 3
                          if (prioA !== prioB) return prioA - prioB
                          const timeA = a.sentAt ? new Date(a.sentAt).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0
                          const timeB = b.sentAt ? new Date(b.sentAt).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0
                          return timeA - timeB
                        })

                        // Group messages by contactId, keeping stepOrder order within each group
                        const contactGroups: Map<string, typeof sorted> = new Map()
                        for (const m of sorted) {
                          const key = m.contactId
                          if (!contactGroups.has(key)) contactGroups.set(key, [])
                          contactGroups.get(key)!.push(m)
                        }
                        // Sort each group by stepOrder
                        for (const msgs of contactGroups.values()) {
                          msgs.sort((a, b) => a.stepOrder - b.stepOrder)
                        }

                        let globalIdx = 0
                        const groups = Array.from(contactGroups.entries())
                        return groups.map(([contactId, messages]) => {
                          return messages.map((m, stepIdx) => {
                            globalIdx++
                            const isFollowUp = stepIdx > 0
                            const isLastInGroup = stepIdx === messages.length - 1
                            const cardBg = m.status === 'failed' ? 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800' : m.status === 'pending' ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/50'

                            if (isFollowUp) {
                              return (
                                <div key={m.id} className="flex">
                                  {/* Tree connector column — horizontal line points right toward the message card */}
                                  <div className="w-8 shrink-0 flex flex-col">
                                    <div className="w-px flex-1 bg-emerald-300 dark:bg-emerald-700 mx-auto" />
                                    <div className="flex h-px">
                                      <div className="w-1/2" />
                                      <div className="w-1/2 h-px bg-emerald-300 dark:bg-emerald-700" />
                                    </div>
                                    {!isLastInGroup && (
                                      <div className="w-px flex-1 bg-emerald-300 dark:bg-emerald-700 mx-auto" />
                                    )}
                                    {isLastInGroup && <div className="flex-1" />}
                                  </div>
                                  {/* Follow-up card */}
                                  <div className={`flex-1 flex items-center gap-2 p-2 rounded-lg text-xs ${cardBg} ml-0.5`}>
                                    <span className="flex items-center justify-center size-4 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[8px] font-bold shrink-0">{m.stepOrder}</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium truncate text-emerald-700 dark:text-emerald-400">Segunda mensagem</span>
                                        <span className="text-muted-foreground truncate">{m.contact?.phone || ''}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <StatusBadge status={m.status} />
                                        {m.chip?.name && <span className="text-muted-foreground">via {m.chip.name}</span>}
                                      </div>
                                      {m.error && <p className="text-rose-600 mt-0.5 font-medium truncate">Erro: {m.error}</p>}
                                    </div>
                                    <div className="text-right shrink-0 text-[10px]">
                                      {m.sentAt && <p className="text-muted-foreground">{new Date(m.sentAt).toLocaleString('pt-BR')}</p>}
                                      {m.deliveredAt && <p className="text-emerald-600">{new Date(m.deliveredAt).toLocaleString('pt-BR')}</p>}
                                      {m.status === 'failed' && !m.sentAt && m.updatedAt && <p className="text-rose-600">{new Date(m.updatedAt).toLocaleString('pt-BR')}</p>}
                                      {m.status === 'failed' && !m.sentAt && !m.updatedAt && m.createdAt && <p className="text-rose-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</p>}
                                      {m.status === 'pending' && !m.sentAt && <p className="text-amber-600 font-medium">Aguardando</p>}
                                    </div>
                                  </div>
                                </div>
                              )
                            }

                            // First step (stepOrder === 1) — normal card
                            return (
                              <div key={m.id} className={`p-2 rounded-lg text-xs flex items-center gap-2 ${cardBg}`}>
                                <span className="font-mono text-muted-foreground w-4 text-center">{globalIdx}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium truncate">{m.contact?.name || '—'}</span>
                                    <span className="text-muted-foreground truncate">{m.contact?.phone || ''}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="flex items-center gap-1 text-[10px] font-medium">
                                      {m.status === 'delivered' || m.status === 'read' ? <CheckCircle2 className="size-3 text-emerald-500" /> :
                                       m.status === 'sent' ? <Check className="size-3 text-sky-500" /> :
                                       m.status === 'failed' ? <XCircle className="size-3 text-rose-500" /> :
                                       m.status === 'pending' ? <Clock className="size-3 text-amber-500" /> : null}
                                      <StatusBadge status={m.status} />
                                    </span>
                                    {m.chip?.name && <span className="text-muted-foreground">via {m.chip.name}</span>}
                                  </div>
                                  {m.error && <p className="text-rose-600 mt-0.5 font-medium truncate">Erro: {m.error}</p>}
                                </div>
                                <div className="text-right shrink-0 text-[10px]">
                                  {m.sentAt && <p className="text-muted-foreground">{new Date(m.sentAt).toLocaleString('pt-BR')}</p>}
                                  {m.deliveredAt && <p className="text-emerald-600">{new Date(m.deliveredAt).toLocaleString('pt-BR')}</p>}
                                  {m.status === 'failed' && !m.sentAt && m.updatedAt && <p className="text-rose-600">{new Date(m.updatedAt).toLocaleString('pt-BR')}</p>}
                                  {m.status === 'failed' && !m.sentAt && !m.updatedAt && m.createdAt && <p className="text-rose-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</p>}
                                  {m.status === 'pending' && !m.sentAt && <p className="text-amber-600 font-medium">Aguardando</p>}
                                </div>
                              </div>
                            )
                          })
                        })
                      })()}
                    </div>
                  </div>
                )}
                {selectedCampaign.sequenceSteps?.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Mensagens & Variações</Label>
                    {selectedCampaign.sequenceSteps.sort((a, b) => a.stepOrder - b.stepOrder).map((step, idx) => {
                      let parsedVars: Array<{content: string; mediaUrl?: string; mediatype?: string}> = []
                      try { parsedVars = JSON.parse(step.variations || '[]') } catch { /* ignore */ }
                      return (
                        <div key={step.id} className="p-2.5 rounded-lg bg-muted/50 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">{step.stepOrder}</span>
                            <p className="flex-1 text-xs whitespace-pre-wrap break-words min-w-0">{step.content}</p>
                            {step.delayMinutes > 0 && <Badge variant="secondary" className="text-[10px] gap-1 shrink-0"><Clock className="size-2.5" />{step.delayMinutes}{step.delayUnit === 'seconds' ? 'seg' : 'min'}</Badge>}
                          </div>
                          {parsedVars.length > 0 && (
                            <div className="ml-8 space-y-0.5">
                              <p className="text-[10px] text-muted-foreground font-medium">Variações ({parsedVars.length}):</p>
                              {parsedVars.map((v, vi) => (
                                <div key={vi} className="flex items-start gap-1.5 text-[11px]">
                                  <Shuffle className="size-3 text-emerald-500 shrink-0 mt-0.5" />
                                  <span className="whitespace-pre-wrap break-words min-w-0">{v.content}</span>
                                  {v.mediatype && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{v.mediatype}</Badge>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Redistribute Dialog — visual slider-based redistribution */}
      <Dialog open={redistributeDialogOpen} onOpenChange={setRedistributeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="size-5 text-blue-600" />
              Redistribuir Contatos
            </DialogTitle>
            <DialogDescription>
              Ajuste a distribuição de {selectedCampaign?.messageStatusCounts?.pending || 0} mensagens pendentes entre os chips
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Button variant="outline" size="sm" className="w-full gap-2 text-xs" onClick={() => {
              const pending = selectedCampaign?.messageStatusCounts?.pending || 0
              const connectedChips = (selectedCampaign?.chips || []).filter((cc: any) => cc.chip?.status === 'connected' && !cc.chip?.paused)
              if (connectedChips.length === 0) return
              const perChip = Math.floor(pending / connectedChips.length)
              const remainder = pending % connectedChips.length
              const newDist: Record<string, number> = {}
              connectedChips.forEach((cc: any, i: number) => {
                newDist[cc.chipId] = perChip + (i < remainder ? 1 : 0)
              })
              setRedistributeDistribution(newDist)
            }}>
              <ArrowRightLeft className="size-3.5" /> Distribuir igualmente entre chips conectados
            </Button>

            {/* Mode toggle */}
            <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-md">
              <button type="button" onClick={() => setDistMode('absolute')} className={`flex-1 text-xs py-1 rounded transition-all ${distMode === 'absolute' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                Número absoluto
              </button>
              <button type="button" onClick={() => setDistMode('percentage')} className={`flex-1 text-xs py-1 rounded transition-all ${distMode === 'percentage' ? 'bg-emerald-500 text-white font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                Porcentagem %
              </button>
            </div>

            {/* Chip sliders */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {(selectedCampaign?.chips || []).map((cc: any) => {
                const chip = cc.chip
                if (!chip) return null
                const pendingCount = selectedCampaign?.messageStatusCounts?.pending || 0
                const chipEffectiveInfo = getChipEffectiveInfo(chip)
                const chipCapacity = Math.max(0, chipEffectiveInfo.effectiveLimit - (chip.sentToday || 0))
                const maxForChip = pendingCount > 0 ? Math.min(chipCapacity, pendingCount) : chipCapacity
                // Calculate what other chips have already allocated
                const otherChipsTotal = Object.entries(redistributeDistribution)
                  .filter(([id]) => id !== cc.chipId)
                  .reduce((sum, [, v]) => sum + (v || 0), 0)
                const effectiveMaxForChip = pendingCount > 0 ? Math.min(maxForChip, Math.max(0, pendingCount - otherChipsTotal)) : maxForChip
                const distValue = redistributeDistribution[cc.chipId] || 0
                const distPct = pendingCount > 0 && distValue > 0 ? Math.round(distValue / pendingCount * 100) : 0
                const maxPct = pendingCount > 0 ? Math.round(effectiveMaxForChip / pendingCount * 100) : 100
                const sliderValue = distMode === 'percentage' ? distPct : distValue
                const sliderMax = distMode === 'percentage' ? maxPct : effectiveMaxForChip

                return (
                  <div key={cc.chipId} className="space-y-1.5 p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Smartphone className="size-3.5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{chip.name}</p>
                          <p className="text-[10px] text-muted-foreground">{chip.phoneNumber} · Capacidade: {chipCapacity}/dia{chipEffectiveInfo.effectiveLimit < (chip.dailyLimit || 200) ? ` (de ${chip.dailyLimit || 200})` : ''}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-emerald-600">
                          {distValue > 0
                            ? (distMode === 'percentage'
                                ? `${distPct}%`
                                : `${distValue}`)
                            : 'Auto'}
                        </span>
                        {distValue > 0 && distMode === 'absolute' && pendingCount > 0 && (
                          <p className="text-[10px] text-muted-foreground">{distPct}%</p>
                        )}
                        {distValue > 0 && distMode === 'percentage' && (
                          <p className="text-[10px] text-muted-foreground">{distValue} contatos</p>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={sliderMax}
                      value={sliderValue}
                      onChange={e => {
                        const rawVal = parseInt(e.target.value, 10)
                        const absVal = distMode === 'percentage'
                          ? Math.min(Math.round(rawVal / 100 * pendingCount), effectiveMaxForChip)
                          : Math.min(rawVal, effectiveMaxForChip)
                        setRedistributeDistribution(prev => ({ ...prev, [cc.chipId]: absVal }))
                      }}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Auto (igualitário)</span>
                      <span>{distMode === 'percentage' ? `${maxPct}%` : `${effectiveMaxForChip} contatos`}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            {(() => {
              const pendingCount = selectedCampaign?.messageStatusCounts?.pending || 0
              const manualTotal = Object.values(redistributeDistribution).reduce((sum: number, v: number) => sum + (v || 0), 0)
              const autoChips = (selectedCampaign?.chips || []).filter((cc: any) => !redistributeDistribution[cc.chipId] || redistributeDistribution[cc.chipId] === 0)
              const remaining = pendingCount - manualTotal
              const exceedsTotal = manualTotal > pendingCount
              return (
                <div className="p-2.5 bg-muted/30 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mensagens pendentes:</span>
                    <span className="font-medium">{pendingCount}</span>
                  </div>
                  {manualTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Alocados manualmente:</span>
                      <span className={`font-medium ${exceedsTotal ? 'text-red-500' : ''}`}>{manualTotal} ({Math.round(manualTotal / pendingCount * 100)}%)</span>
                    </div>
                  )}
                  {autoChips.length > 0 && remaining > 0 && !exceedsTotal && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Auto ({autoChips.length} chip{autoChips.length > 1 ? 's' : ''}, ~{Math.ceil(remaining / autoChips.length)} cada):</span>
                      <span className="font-medium">{remaining}</span>
                    </div>
                  )}
                  {exceedsTotal && (
                    <p className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle className="size-3" /> Total alocado excede mensagens pendentes!</p>
                  )}
                </div>
              )
            })()}
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              className="bg-blue-600 hover:bg-blue-700 gap-1.5"
              disabled={!!(() => {
                const pendingCount = selectedCampaign?.messageStatusCounts?.pending || 0
                const manualTotal = Object.values(redistributeDistribution).reduce((sum: number, v: number) => sum + (v || 0), 0)
                return manualTotal > pendingCount
              })()}
              onClick={async () => {
                if (!selectedCampaign) return
                try {
                  const res = await fetch(`/api/campaigns/${selectedCampaign.id}/redistribute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chipDistribution: redistributeDistribution }),
                  })
                  const data = await res.json()
                  if (res.ok) {
                    toast.success(data.message || 'Mensagens redistribuídas!')
                    setRedistributeDialogOpen(false)
                    // Refresh campaign data
                    const campRes = await fetch(`/api/campaigns/${selectedCampaign.id}`, { cache: 'no-store' })
                    if (campRes.ok) setSelectedCampaign(await campRes.json())
                    fetchCampaigns()
                  } else {
                    toast.error(data.error || 'Erro ao redistribuir')
                  }
                } catch { toast.error('Erro ao redistribuir mensagens') }
              }}
            >
              <ArrowRightLeft className="size-3.5" /> Redistribuir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

