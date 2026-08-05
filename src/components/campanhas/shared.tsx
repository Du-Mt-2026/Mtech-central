'use client'

// Shared constants, helper functions, exported utility functions, and shared
// types for the campanhas (campaigns) tab.
//
// These pieces were extracted verbatim from the original `campanhas-tab.tsx`
// during the P2.1-split-3 refactor. No logic was changed — this file is a
// pure mechanical extraction of the module-level (non-component) code.

import { toast } from 'sonner'
import { type Chip } from '@/lib/types'
import { type StepForm } from '@/lib/types'
import { WARMING_MODE_MULTIPLIERS, type AntiBanSettings } from '@/lib/constants'

// ─── Shared types ───────────────────────────────────────────────────────────
// These mirror the inline shapes used throughout the original component so
// that the extracted sub-components can type their props without re-declaring
// the shapes.

export type MessageKey = {
  id: string
  name: string
  label: string
  category: string
  variations: string
  resolutionType?: string
  timeSlots?: string | null
}

export type ContactVariable = { tag: string; label: string; source: string }

export type PreviewContact = { name: string; phone: string; customFields?: string }

export type CampaignFormData = {
  name: string
  sendIntervalMin: number
  sendIntervalMax: number
  chipIds: string[]
  contactListId: string
  scheduledAt: string
  steps: StepForm[]
  antiBanEnabled: boolean
  warmingMode: string
  chipDistribution: Record<string, number> // chipId → contactLimit (0 = auto)
}

// ─── Module-level variables for audio conversion ────────────────────────────
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

export { CONTACT_VARIABLES, EMOJI_LIST }

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

export { parseKeyBlocksFromText, generatePreviewText }

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
