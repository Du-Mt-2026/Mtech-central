'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Send, RefreshCw, Check, X, Clock, Users, MessageSquare,
  MessageCircle, Search, Smartphone, Inbox as InboxIcon,
  FileText, File as FileIcon, ImageIcon, Video, Mic, User, Smile,
  MapPin, BarChart3, Heart, Paperclip, ArrowDownToLine, Eraser,
  Megaphone, MoreVertical, Phone, Filter
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ExtractMembersDialog } from '@/components/inbox/extract-members-dialog'

// ===== Types =====
interface InboxChip {
  id: string
  name: string
  phoneNumber: string
  status: string
  profilePicUrl: string | null
  profileName: string | null
  evolutionInstance: string | null
  conversationCount: number
  unreadCount: number
  lastMessageAt: string | null
}

interface InboxConversation {
  chipId: string | null
  remoteJid: string
  remotePhone: string
  contactName: string
  pushName: string | null
  groupName: string | null
  lastMessage: { content: string; type: string; fromMe: boolean; senderName: string | null; isCampaign?: boolean; status?: string; ack?: number }
  lastMessageAt: string
  unreadCount: number
  totalMessages: number
  isGroup: boolean
  hasCampaignMessages: boolean
  participantCount: number | null
  profilePicUrl: string | null
  chip: { id: string; name: string; phoneNumber: string; profilePicUrl: string | null; status: string } | null
}

interface InboxMsg {
  id: string
  instanceName: string
  chipId: string | null
  remoteJid: string
  remotePhone: string
  fromMe: boolean
  messageContent: string
  messageType: string
  mediaUrl: string | null
  pushName: string | null
  contactName: string | null
  evolutionMsgId: string | null
  isRead: boolean
  isGroup: boolean
  isCampaign: boolean
  createdAt: string
  ack: number
  status: string
  deliveredAt: string | null
  readAt: string | null
  quotedMsgId: string | null
  quotedContent: string | null
  quotedType: string | null
  quotedPushName: string | null
  reactionEmoji: string | null
  fileName: string | null
  mimeType: string | null
  mediaCaption: string | null
  mediaDuration: number | null
}

// ===== Helper: Avatar color palette (Chatwoot-style) =====
const AVATAR_COLORS = [
  'bg-violet-600', 'bg-cyan-600', 'bg-amber-600', 'bg-emerald-600',
  'bg-rose-600', 'bg-blue-600', 'bg-orange-600', 'bg-teal-600',
  'bg-pink-600', 'bg-indigo-600', 'bg-lime-600', 'bg-fuchsia-600',
]
function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// ===== Helper: Is a string a JID-like numeric ID? =====
function isJidLike(name: string): boolean {
  // Matches pure numeric strings of 10+ digits (WhatsApp group/user JIDs)
  return /^\d{10,}$/.test(name.trim())
}

// ===== Helper: Is a name the "Grupo XXXX" fallback pattern? =====
function isGrupoFallback(name: string): boolean {
  return /^Grupo\s+\d{3,}$/i.test(name.trim())
}

// ===== Helper: Group name display =====
function displayName(conv: InboxConversation): string {
  if (conv.isGroup) {
    // Try groupName first, then contactName — skip JID-like and "Grupo XXXX" patterns
    const candidates = [conv.groupName, conv.contactName]
    for (const name of candidates) {
      if (!name) continue
      if (isJidLike(name)) continue
      if (isGrupoFallback(name)) continue
      if (name === 'unknown') continue
      return name
    }
    // Fallback: show partial JID (e.g., "Grupo ...326") — never just "Grupo"
    const jidNum = conv.remoteJid.split('@')[0]
    const shortId = jidNum.length > 6 ? `...${jidNum.slice(-6)}` : jidNum
    return `Grupo ${shortId}`
  }
  return conv.contactName || conv.pushName || conv.remotePhone || 'Desconhecido'
}

// ===== Helper: Media preview text for conversation list =====
function mediaPreviewText(type: string, content: string): string {
  const labels: Record<string, string> = {
    image: 'Foto',
    video: 'Video',
    audio: 'Audio',
    document: 'Documento',
    sticker: 'Figurinha',
    location: 'Localizacao',
    contact: 'Contato',
    template: 'Template',
    reaction: 'Reacao',
    poll: 'Enquete',
    group_invite: 'Convite de grupo',
    deleted: 'Mensagem apagada',
  }
  const label = labels[type]
  if (!label) return content || ''
  // If there's caption/text content, show it alongside the media type
  const cleanContent = content?.trim()
  if (cleanContent && !cleanContent.startsWith('{') && !cleanContent.startsWith('[')) {
    return `${label}: ${cleanContent}`
  }
  return label
}

// ===== WhatsApp Check Marks Component =====
function WhatsAppChecks({ ack, status }: { ack?: number; status?: string }) {
  const ackVal = ack ?? 0
  const statusVal = status ?? ''

  if (statusVal === 'read' || ackVal >= 4) {
    return (
      <span className="relative inline-flex items-center shrink-0 ml-0.5">
        <Check className="size-3.5 text-sky-400 absolute left-[3px]" strokeWidth={2.5} />
        <Check className="size-3.5 text-sky-400" strokeWidth={2.5} />
      </span>
    )
  }
  if (statusVal === 'delivered' || ackVal === 3) {
    return (
      <span className="relative inline-flex items-center shrink-0 ml-0.5">
        <Check className="size-3.5 text-muted-foreground/60 absolute left-[3px]" strokeWidth={2.5} />
        <Check className="size-3.5 text-muted-foreground/60" strokeWidth={2.5} />
      </span>
    )
  }
  if (statusVal === 'sent' || ackVal === 1 || ackVal === 2) {
    return <Check className="size-3.5 text-muted-foreground/60 shrink-0 ml-0.5" strokeWidth={2.5} />
  }
  return <Clock className="size-3 text-muted-foreground/40 shrink-0 ml-0.5" />
}

// ===== Audio Player Component (WhatsApp-style) =====
function AudioPlayer({ src, duration, isMe }: { src: string; duration: number | null; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(duration ?? 0)

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.play().catch(() => {})
    }
    setPlaying(!playing)
  }

  const formatDuration = (secs: number) => {
    if (!secs || secs <= 0) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className={cn(
      'flex items-center gap-2.5 min-w-[200px] max-w-[280px] py-1 px-0.5',
    )}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0) }}
        onTimeUpdate={() => {
          const audio = audioRef.current
          if (!audio) return
          setCurrentTime(audio.currentTime)
          setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0)
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current
          if (audio && audio.duration && isFinite(audio.duration)) {
            setAudioDuration(audio.duration)
          }
        }}
      />
      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className={cn(
          'size-9 rounded-full flex items-center justify-center shrink-0 transition-colors',
          isMe ? 'bg-foreground/15 hover:bg-foreground/25' : 'bg-primary/15 hover:bg-primary/25'
        )}
      >
        {playing ? (
          <span className="size-3 rounded-sm bg-foreground/70" />
        ) : (
          <span className="ml-0.5 border-l-[7px] border-y-[5px] border-l-foreground/70 border-y-transparent" />
        )}
      </button>
      {/* Waveform / Progress bar */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="relative h-5 flex items-center gap-px">
          {/* Fake waveform bars */}
          {Array.from({ length: 32 }).map((_, i) => {
            const barHeight = 15 + Math.abs(Math.sin(i * 0.8 + 3)) * 70 + Math.random() * 15
            const filled = (i / 32) * 100 <= progress
            return (
              <div
                key={i}
                className={cn(
                  'w-[3px] rounded-full shrink-0 transition-colors',
                  filled
                    ? (isMe ? 'bg-foreground/50' : 'bg-primary/50')
                    : (isMe ? 'bg-foreground/15' : 'bg-primary/15')
                )}
                style={{ height: `${barHeight}%` }}
              />
            )
          })}
        </div>
        {/* Time */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {playing ? formatDuration(currentTime) : '0:00'}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(audioDuration)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ===== Reaction Badges Component (WhatsApp-style) =====
function ReactionBadges({ reactions, isMe }: { reactions: { emoji: string; from: string; fromJid: string }[]; isMe: boolean }) {
  // Aggregate same emojis and count them
  const emojiCounts = new Map<string, number>()
  for (const r of reactions) {
    const emoji = r.emoji || '👍'
    emojiCounts.set(emoji, (emojiCounts.get(emoji) || 0) + 1)
  }
  return (
    <div className={cn('flex flex-wrap gap-1 -mt-1.5', isMe ? 'justify-end mr-2' : 'justify-start ml-2')}>
      {Array.from(emojiCounts.entries()).map(([emoji, count], ri) => (
        <span key={ri} className="inline-flex items-center gap-0.5 bg-background/80 border border-border/30 rounded-full px-2 py-0.5 text-sm shadow-sm hover:bg-background transition-colors cursor-default">
          <span className="text-base leading-none">{emoji}</span>
          {count > 1 && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        </span>
      ))}
    </div>
  )
}

// ===== Main Component =====
export function InboxTab() {
  // State
  const [chips, setChips] = useState<InboxChip[]>([])
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<InboxConversation | null>(null)
  const [messages, setMessages] = useState<InboxMsg[]>([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingChips, setLoadingChips] = useState(true)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [searchChips, setSearchChips] = useState('')
  const [searchConversations, setSearchConversations] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const lastSyncRef = useRef<string>(new Date().toISOString())
  const syncingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [profilePics, setProfilePics] = useState<Record<string, string>>({})
  const [attachedFile, setAttachedFile] = useState<{ file: File; preview: string; dataUrl: string; type: string } | null>(null)
  const [replyingTo, setReplyingTo] = useState<InboxMsg | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [convStatus, setConvStatus] = useState<string>('open')
  // Status filter for conversations
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [extractDialogOpen, setExtractDialogOpen] = useState(false)

  // ===== Data fetching callbacks (same logic as before) =====
  const fetchChips = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (searchChips) params.set('search', searchChips)
      const res = await fetch(`/api/inbox?${params}`)
      const data = await res.json()
      setChips(data.chips || [])
    } catch { toast.error('Erro ao carregar chips') }
    finally { setLoadingChips(false) }
  }, [searchChips])

  const fetchConversations = useCallback(async (silent = false) => {
    if (!selectedChipId) { setConversations([]); return }
    if (!silent) setLoadingConversations(true)
    try {
      const params = new URLSearchParams({ chipId: selectedChipId })
      if (searchConversations) params.set('search', searchConversations)
      const res = await fetch(`/api/inbox/conversations?${params}`)
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch { if (!silent) toast.error('Erro ao carregar conversas') }
    finally { setLoadingConversations(false) }
  }, [selectedChipId, searchConversations])

  const fetchMessages = useCallback(async (conv: InboxConversation | null, silent = false) => {
    if (!conv || !conv.chipId || !conv.remoteJid) { setMessages([]); return }
    if (!silent) setLoadingMessages(true)
    try {
      const params = new URLSearchParams({ chipId: conv.chipId, remoteJid: conv.remoteJid, limit: '100' })
      const res = await fetch(`/api/inbox/messages?${params}`)
      const data = await res.json()
      setMessages(data.messages || [])
      setHasMore(data.hasMore || false)
    } catch { if (!silent) toast.error('Erro ao carregar mensagens') }
    finally { setLoadingMessages(false) }
  }, [])

  const autoSync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      const res = await fetch('/api/inbox/auto-sync', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.synced > 0) {
          fetchChips()
          fetchConversations(true)
          if (selectedConversation) fetchMessages(selectedConversation, true)
        }
      }
    } catch { /* silent */ }
    finally { syncingRef.current = false }
  }, [fetchChips, fetchConversations, fetchMessages, selectedConversation])

  // ===== Effects =====
  useEffect(() => {
    fetchChips()
    const interval = setInterval(fetchChips, 10000)
    return () => clearInterval(interval)
  }, [fetchChips])
  useEffect(() => { fetchConversations() }, [fetchConversations])

  useEffect(() => {
    if (!selectedChipId) return
    const interval = setInterval(() => fetchConversations(true), 10000)
    return () => clearInterval(interval)
  }, [selectedChipId, fetchConversations])

  useEffect(() => { fetchMessages(selectedConversation) }, [selectedConversation, fetchMessages])

  useEffect(() => {
    if (!chatScrollRef.current || messages.length === 0) return
    const viewport = chatScrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
    if (viewport) {
      setTimeout(() => { viewport.scrollTop = viewport.scrollHeight }, 150)
    }
  }, [messages])

  useEffect(() => {
    const interval = setInterval(autoSync, 10000)
    return () => clearInterval(interval)
  }, [autoSync])

  // Quick polling for new messages + ack changes
  // Uses a ref to always access latest messages without re-creating the interval
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (!selectedConversation) return
    const interval = setInterval(async () => {
      try {
        const params = new URLSearchParams({
          chipId: selectedConversation.chipId || '',
          remoteJid: selectedConversation.remoteJid,
          limit: '100',
        })
        const res = await fetch(`/api/inbox/messages?${params}`)
        const data = await res.json()
        const newMsgs = data.messages || []
        const currentMessages = messagesRef.current
        if (newMsgs.length !== currentMessages.length) {
          setMessages(newMsgs)
        } else {
          let statusChanged = false
          for (const nm of newMsgs) {
            if (!nm.fromMe) continue
            const existing = currentMessages.find(m => m.id === nm.id)
            if (existing && (existing.ack !== nm.ack || existing.status !== nm.status)) {
              statusChanged = true; break
            }
          }
          if (statusChanged) setMessages(newMsgs)
        }
      } catch { /* silent */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [selectedConversation]) // Removed 'messages' from deps — uses ref instead

  // ===== Action handlers =====
  const handleReply = async () => {
    if ((!replyText.trim() && !attachedFile) || !selectedConversation) return
    setSending(true)
    try {
      // If there's an attached file, use FormData for proper upload instead of sending base64 as mediaUrl
      let res: Response
      if (attachedFile?.file) {
        const formData = new FormData()
        formData.append('chipId', selectedConversation.chipId || '')
        formData.append('remoteJid', selectedConversation.remoteJid || '')
        formData.append('content', replyText.trim())
        formData.append('mediatype', attachedFile.type || 'document')
        formData.append('file', attachedFile.file)
        if (replyingTo?.evolutionMsgId) {
          formData.append('quotedMsgId', replyingTo.evolutionMsgId)
        }
        res = await fetch('/api/inbox/reply', {
          method: 'POST',
          body: formData,
        })
      } else {
        res = await fetch('/api/inbox/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chipId: selectedConversation.chipId,
            remoteJid: selectedConversation.remoteJid,
            content: replyText.trim(),
            quotedMsgId: replyingTo?.evolutionMsgId || undefined,
          }),
        })
      }
      const data = await res.json()
      if (data.success) {
        setReplyText('')
        setAttachedFile(null)
        setReplyingTo(null)
        if (data.message) setMessages(prev => [...prev, data.message])
        toast.success('Mensagem enviada')
      } else {
        toast.error(data.error || 'Erro ao enviar')
      }
    } catch { toast.error('Erro ao enviar mensagem') }
    finally { setSending(false) }
  }

  const loadMoreMessages = useCallback(async () => {
    if (!selectedConversation || loadingMore || messages.length === 0) return
    setLoadingMore(true)
    try {
      const viewport = chatScrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      const prevScrollTop = viewport?.scrollTop || 0
      const prevScrollHeight = viewport?.scrollHeight || 0
      const params = new URLSearchParams({
        chipId: selectedConversation.chipId || '',
        remoteJid: selectedConversation.remoteJid,
        before: messages[0].createdAt,
        limit: '50',
      })
      const res = await fetch(`/api/inbox/messages?${params}`)
      const data = await res.json()
      if (data.messages?.length > 0) {
        setMessages(prev => [...data.messages, ...prev])
        setHasMore(data.hasMore || false)
        requestAnimationFrame(() => {
          if (viewport) {
            const newScrollHeight = viewport.scrollHeight
            viewport.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)
          }
        })
      } else { setHasMore(false) }
    } catch { toast.error('Erro ao carregar mensagens anteriores') }
    finally { setLoadingMore(false) }
  }, [selectedConversation, loadingMore, messages])

  const fetchProfilePic = useCallback(async (chipId: string, phone: string, key: string) => {
    // Prevent refetch if already fetched or currently fetching
    if (profilePics[key]) return
    try {
      const res = await fetch(`/api/inbox/profile-pic?chipId=${chipId}&phone=${encodeURIComponent(phone)}`)
      const data = await res.json()
      if (data.profilePicUrl) {
        setProfilePics(prev => ({ ...prev, [key]: data.profilePicUrl }))
      }
    } catch { /* silent */ }
  }, []) // Removed profilePics from deps to prevent infinite loop

  const updateConvStatus = useCallback(async (status: string) => {
    if (!selectedConversation?.chipId || !selectedConversation?.remoteJid) return
    try {
      await fetch('/api/inbox/conversations/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chipId: selectedConversation.chipId, remoteJid: selectedConversation.remoteJid, status }),
      })
      setConvStatus(status)
      toast.success('Status atualizado')
    } catch { toast.error('Erro ao atualizar status') }
  }, [selectedConversation])

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const mediaType = file.type.startsWith('image') ? 'image'
        : file.type.startsWith('video') ? 'video'
        : file.type.startsWith('audio') ? 'audio'
        : 'document'
      const preview = mediaType === 'image' ? dataUrl : ''
      setAttachedFile({ file, preview, dataUrl, type: mediaType })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  useEffect(() => {
    if (selectedConversation?.chipId && selectedConversation?.remotePhone) {
      const key = `${selectedConversation.chipId}-${selectedConversation.remotePhone}`
      fetchProfilePic(selectedConversation.chipId, selectedConversation.remotePhone, key)
    }
    setConvStatus('open')
    setReplyingTo(null)
    setAttachedFile(null)
  }, [selectedConversation, fetchProfilePic])

  // ===== Formatting helpers =====
  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    if (days === 1) return 'Ontem'
    if (days < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' })
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-emerald-500'
      case 'connecting': return 'bg-yellow-500 animate-pulse'
      case 'banned': return 'bg-red-500'
      default: return 'bg-zinc-500'
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'connected': return 'Conectado'
      case 'connecting': return 'Conectando'
      case 'banned': return 'Banido'
      case 'disconnected': return 'Desconectado'
      default: return status
    }
  }

  // Filter conversations by status
  const filteredConversations = conversations.filter(conv => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'unread') return conv.unreadCount > 0
    if (statusFilter === 'groups') return conv.isGroup
    if (statusFilter === 'campaigns') return conv.hasCampaignMessages
    return true
  })

  // ===== Message type icon for conversation list =====
  const MsgTypeIcon = ({ type }: { type: string }) => {
    const cls = 'size-3.5 shrink-0'
    switch (type) {
      case 'image': return <ImageIcon className={cls} />
      case 'video': return <Video className={cls} />
      case 'audio': return <Mic className={cls} />
      case 'document': return <FileIcon className={cls} />
      case 'sticker': return <Smile className={cls} />
      case 'location': return <MapPin className={cls} />
      case 'contact': return <User className={cls} />
      case 'template': return <FileText className={cls} />
      case 'reaction': return <Heart className={cls} />
      case 'poll': return <BarChart3 className={cls} />
      case 'group_invite': return <Users className={cls} />
      case 'deleted': return <X className={cls} />
      default: return <MessageSquare className={cls} />
    }
  }

  // ===== RENDER =====
  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-border/50 bg-background">
      <ResizablePanelGroup direction="horizontal" className="flex h-full">

        {/* ====== PANEL 1: Chip / Inbox Selector ====== */}
        <ResizablePanel defaultSize={20} minSize={14} maxSize={28}>
          <div className="h-full flex flex-col border-r border-border/40">
            {/* Header */}
            <div className="px-3 py-3 border-b border-border/40">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold tracking-tight">Caixa de Entrada</h2>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => fetchChips()}>
                        <RefreshCw className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Atualizar</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar chip..."
                  className="pl-7 h-8 text-xs"
                  value={searchChips}
                  onChange={e => setSearchChips(e.target.value)}
                />
              </div>
            </div>

            {/* Chip List */}
            <ScrollArea className="flex-1 min-h-0">
              {loadingChips ? (
                <div className="flex items-center justify-center py-10">
                  <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : chips.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4">
                  <Smartphone className="size-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs text-muted-foreground text-center">Nenhum chip encontrado</p>
                </div>
              ) : (
                <div className="py-1">
                  {chips.map(chip => (
                    <button
                      key={chip.id}
                      onClick={() => { setSelectedChipId(chip.id); setSelectedConversation(null); setMessages([]) }}
                      className={cn(
                        'w-full flex items-center gap-3 px-3.5 py-3 transition-colors text-left',
                        selectedChipId === chip.id
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-muted/50'
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="size-10">
                          {chip.profilePicUrl && <AvatarImage src={chip.profilePicUrl} alt={chip.name} />}
                          <AvatarFallback className={cn(avatarColor(chip.name), 'text-white text-xs font-semibold')}>
                            {chip.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className={cn(
                          'absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background',
                          statusColor(chip.status)
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className={cn(
                            'text-sm truncate',
                            selectedChipId === chip.id ? 'font-semibold' : 'font-medium'
                          )}>{chip.name}</p>
                          {chip.unreadCount > 0 && (
                            <Badge className="size-5 p-0 flex items-center justify-center text-xs bg-emerald-600 text-white rounded-full shrink-0">
                              {chip.unreadCount > 99 ? '99+' : chip.unreadCount}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{chip.phoneNumber}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Footer actions */}
            <div className="px-3 py-2 border-t border-border/40">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  try {
                    toast.loading('Limpando mensagens de aquecimento...')
                    const res = await fetch('/api/admin/migrate', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'mark-warming-inbox' }),
                    })
                    const data = await res.json()
                    toast.dismiss()
                    if (data.success) {
                      toast.success(`${data.inboxMessagesUpdated || 0} mensagens de aquecimento removidas`)
                      fetchChips()
                      fetchConversations(true)
                    } else {
                      toast.error(data.error || 'Erro ao limpar')
                    }
                  } catch {
                    toast.dismiss()
                    toast.error('Erro ao conectar ao servidor')
                  }
                }}
              >
                <Eraser className="size-3 mr-1" />
                Limpar Aquecimento
              </Button>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* ====== PANEL 2: Conversations ====== */}
        <ResizablePanel defaultSize={30} minSize={22} maxSize={45}>
          <div className="h-full flex flex-col border-r border-border/40">
            {/* Header */}
            <div className="px-3 py-3 border-b border-border/40">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold tracking-tight truncate">
                  {selectedChipId ? chips.find(c => c.id === selectedChipId)?.name || 'Conversas' : 'Conversas'}
                </h3>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-xs font-normal">
                    {filteredConversations.length}
                  </Badge>
                </div>
              </div>
              {selectedChipId && (
                <>
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar contato..."
                      className="pl-7 h-8 text-xs"
                      value={searchConversations}
                      onChange={e => setSearchConversations(e.target.value)}
                    />
                  </div>
                  {/* Status filter tabs */}
                  <div className="flex items-center gap-1">
                    {[
                      { key: 'all', label: 'Todas' },
                      { key: 'unread', label: 'Nao lidas' },
                      { key: 'groups', label: 'Grupos' },
                      { key: 'campaigns', label: 'Campanhas' },
                    ].map(f => (
                      <Button
                        key={f.key}
                        variant={statusFilter === f.key ? 'secondary' : 'ghost'}
                        size="sm"
                        className={cn(
                          'h-7 px-2 text-xs',
                          statusFilter === f.key && 'bg-primary/10 text-primary font-semibold'
                        )}
                        onClick={() => setStatusFilter(f.key)}
                      >
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Conversation List */}
            <ScrollArea className="flex-1 min-h-0">
              {!selectedChipId ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <MessageCircle className="size-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground text-center">Selecione um chip para ver as conversas</p>
                </div>
              ) : loadingConversations ? (
                <div className="flex items-center justify-center py-10">
                  <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <InboxIcon className="size-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground text-center">
                    {statusFilter !== 'all' ? 'Nenhuma conversa com esse filtro' : 'Nenhuma conversa encontrada'}
                  </p>
                  <p className="text-xs text-muted-foreground/60 text-center mt-1">As mensagens trocadas aparecerão aqui</p>
                </div>
              ) : (
                <div className="py-0.5">
                  {filteredConversations.map(conv => {
                    const isSelected = selectedConversation?.remoteJid === conv.remoteJid && selectedConversation?.chipId === conv.chipId
                    const name = displayName(conv)
                    const picKey = `${conv.chipId}-${conv.remotePhone}`
                    const picUrl = profilePics[picKey] || conv.profilePicUrl

                    return (
                      <button
                        key={`${conv.chipId}-${conv.remoteJid}`}
                        onClick={() => setSelectedConversation(conv)}
                        className={cn(
                          'w-full flex items-start gap-3 px-3.5 py-3 transition-colors text-left',
                          isSelected
                            ? 'bg-primary/8 border-l-2 border-primary'
                            : 'hover:bg-muted/40 border-l-2 border-transparent',
                          conv.unreadCount > 0 && !isSelected && 'bg-muted/20'
                        )}
                      >
                        {/* Avatar */}
                        <div className="shrink-0 mt-0.5">
                          {conv.isGroup ? (
                            <Avatar className="size-10">
                              <AvatarFallback className="bg-emerald-600/20 text-emerald-500 text-sm">
                                <Users className="size-4.5" />
                              </AvatarFallback>
                            </Avatar>
                          ) : (
                            <Avatar className="size-10">
                              {picUrl && <AvatarImage src={picUrl} alt={name} />}
                              <AvatarFallback className={cn(avatarColor(name), 'text-white text-sm font-semibold')}>
                                {name.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className={cn(
                                'text-sm truncate',
                                conv.unreadCount > 0 ? 'font-bold text-foreground' : 'font-medium text-foreground/90'
                              )}>
                                {name}
                              </p>
                              {conv.isGroup && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                                  {conv.participantCount || '?'} pes.
                                </span>
                              )}
                            </div>
                            <span className={cn(
                              'text-xs shrink-0 tabular-nums',
                              conv.unreadCount > 0 ? 'text-emerald-600 font-semibold' : 'text-muted-foreground'
                            )}>
                              {formatTime(conv.lastMessageAt)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 mt-0.5">
                            {/* Campaign icon */}
                            {conv.lastMessage.isCampaign && (
                              <Megaphone className="size-3 text-amber-500 shrink-0" />
                            )}
                            {/* Check marks for fromMe messages */}
                            {conv.lastMessage.fromMe && !conv.lastMessage.isCampaign && (
                              <WhatsAppChecks ack={conv.lastMessage.ack} status={conv.lastMessage.status} />
                            )}
                            {/* Media type icon */}
                            {conv.lastMessage.type !== 'text' && (
                              <span className="text-muted-foreground shrink-0">
                                <MsgTypeIcon type={conv.lastMessage.type} />
                              </span>
                            )}
                            {/* Preview text */}
                            <p className={cn(
                              'text-xs truncate',
                              conv.unreadCount > 0 ? 'text-foreground/80 font-medium' : 'text-muted-foreground'
                            )}>
                              {(() => {
                                if (conv.isGroup && conv.lastMessage.senderName && conv.lastMessage.senderName !== 'unknown') {
                                  const previewContent = mediaPreviewText(conv.lastMessage.type, conv.lastMessage.content)
                                  return `${conv.lastMessage.senderName}: ${previewContent || `Mensagem de ${conv.lastMessage.type}`}`
                                }
                                const c = conv.lastMessage.content || ''
                                if (c.startsWith('{') || c.startsWith('[')) {
                                  return mediaPreviewText(conv.lastMessage.type, '')
                                }
                                return mediaPreviewText(conv.lastMessage.type, c) || `Mensagem de ${conv.lastMessage.type}`
                              })()}
                            </p>
                          </div>

                          {/* Unread badge */}
                          {conv.unreadCount > 0 && (
                            <div className="mt-1">
                              <Badge className="size-5 p-0 flex items-center justify-center text-xs bg-emerald-600 text-white rounded-full font-semibold">
                                {conv.unreadCount}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* ====== PANEL 3: Chat View ====== */}
        <ResizablePanel defaultSize={50} minSize={30}>
          <div className="h-full flex flex-col bg-background">
            {!selectedConversation ? (
              /* Empty State */
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <div className="flex size-20 items-center justify-center rounded-full bg-muted/50 mb-5">
                  <MessageCircle className="size-10 text-muted-foreground/40" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Bem-vindo à Caixa de Entrada</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Selecione um chip à esquerda e uma conversa para começar a responder mensagens dos seus contatos.
                </p>
              </div>
            ) : (
              <>
                {/* ===== Chat Header ===== */}
                <div className="px-4 py-2.5 border-b border-border/40 flex items-center gap-3">
                  {/* Contact avatar */}
                  {(() => {
                    const name = displayName(selectedConversation)
                    const picKey = `${selectedConversation.chipId}-${selectedConversation.remotePhone}`
                    const picUrl = profilePics[picKey] || selectedConversation.profilePicUrl
                    return selectedConversation.isGroup ? (
                      <Avatar className="size-10">
                        <AvatarFallback className="bg-emerald-600/20 text-emerald-500">
                          <Users className="size-5" />
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <Avatar className="size-10">
                        {picUrl && <AvatarImage src={picUrl} alt={name} />}
                        <AvatarFallback className={cn(avatarColor(name), 'text-white font-semibold')}>
                          {name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )
                  })()}

                  {/* Contact info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">
                        {displayName(selectedConversation)}
                      </p>
                      {selectedConversation.isGroup && !displayName(selectedConversation).startsWith('Grupo') && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                          Grupo
                        </Badge>
                      )}
                      {/* Conversation status */}
                      <Select value={convStatus} onValueChange={updateConvStatus}>
                        <SelectTrigger className="h-6 w-auto border-0 p-0 gap-0.5 text-xs focus:ring-0 focus:ring-offset-0 text-muted-foreground hover:text-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Aberta</Badge>
                          </SelectItem>
                          <SelectItem value="pending">
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Pendente</Badge>
                          </SelectItem>
                          <SelectItem value="resolved">
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Resolvida</Badge>
                          </SelectItem>
                          <SelectItem value="snoozed">
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400">Adiada</Badge>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedConversation.isGroup
                        ? `${selectedConversation.participantCount || '?'} participantes`
                        : selectedConversation.remotePhone
                      }
                      {selectedConversation.chip && ` · via ${selectedConversation.chip.name}`}
                    </p>
                  </div>

                  {/* Header actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-xs font-normal">
                      {selectedConversation.totalMessages} msg
                    </Badge>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => fetchMessages(selectedConversation)}>
                            <RefreshCw className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Atualizar mensagens</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => setExtractDialogOpen(true)} disabled={!selectedConversation?.isGroup}>
                            <Users className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Extrair membros do grupo</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                {/* ===== Messages Area ===== */}
                <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="px-4 py-3">
                      {loadingMessages ? (
                        <div className="flex items-center justify-center py-10">
                          <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <MessageSquare className="size-10 text-muted-foreground/30 mb-3" />
                          <p className="text-sm text-muted-foreground">Nenhuma mensagem nesta conversa</p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-w-3xl mx-auto">
                          {/* Load more button */}
                          {hasMore && (
                            <div className="flex items-center justify-center py-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-muted-foreground"
                                onClick={loadMoreMessages}
                                disabled={loadingMore}
                              >
                                {loadingMore ? <RefreshCw className="size-3.5 animate-spin mr-1" /> : <ArrowDownToLine className="size-3.5 mr-1" />}
                                Carregar anteriores
                              </Button>
                            </div>
                          )}

                          {messages.map((msg, idx) => {
                            const isMe = msg.fromMe
                            const showDate = idx === 0 || (() => {
                              const prevDate = new Date(messages[idx - 1].createdAt).toDateString()
                              const currDate = new Date(msg.createdAt).toDateString()
                              return prevDate !== currDate
                            })()

                            // Skip reaction messages entirely — they appear as badges on the original message
                            if (msg.messageType === 'reaction') return null

                            const hasContent = msg.messageContent || msg.mediaUrl || ['deleted', 'sticker', 'image', 'video', 'audio', 'document'].includes(msg.messageType)
                            if (!hasContent) return null

                            const reactions: { emoji: string; from: string; fromJid: string }[] = (() => {
                              if (!msg.reactionEmoji) return []
                              try { return JSON.parse(msg.reactionEmoji) } catch { return [] }
                            })()

                            const isGroupMsg = selectedConversation.isGroup && !isMe
                            const senderDisplayName = msg.pushName || msg.contactName || null

                            const ackStatus = (() => {
                              if (!isMe) return null
                              const ack = msg.ack ?? 0
                              const status = msg.status
                              if (status === 'read' || ack >= 4) return 'read' as const
                              if (status === 'delivered' || ack === 3) return 'delivered' as const
                              if (status === 'sent' || ack === 1 || ack === 2) return 'sent' as const
                              return 'pending' as const
                            })()

                            return (
                              <React.Fragment key={msg.id}>
                                {/* Date separator */}
                                {showDate && (
                                  <div className="flex items-center justify-center py-3">
                                    <span className="text-xs text-muted-foreground/70 bg-muted/50 rounded-full px-3 py-1">
                                      {new Date(msg.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                                    </span>
                                  </div>
                                )}

                                {/* Group sender name */}
                                {isGroupMsg && senderDisplayName && senderDisplayName !== 'unknown' && (
                                  <p className={cn(
                                    'text-xs font-semibold ml-3 mb-0.5',
                                    ['a','e','i','o','u'].some(v => senderDisplayName[0]?.toLowerCase() === v)
                                      ? 'text-violet-400'
                                      : 'text-sky-400'
                                  )}>
                                    {senderDisplayName}
                                  </p>
                                )}

                                {/* Message bubble */}
                                <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                                  <div
                                    className={cn(
                                      'max-w-[70%] rounded-2xl px-3 py-2 shadow-sm relative group',
                                      isMe
                                        ? msg.isCampaign
                                          ? 'bg-emerald-950/80 text-foreground rounded-br-md border-l-[3px] border-emerald-500'
                                          : 'bg-primary/15 text-foreground rounded-br-md'
                                        : 'bg-muted/80 text-foreground rounded-bl-md'
                                    )}
                                    onDoubleClick={() => setReplyingTo(msg)}
                                    title="Duplo clique para responder"
                                  >
                                    {/* Campaign badge */}
                                    {msg.isCampaign && isMe && (
                                      <div className="flex items-center gap-1 mb-1">
                                        <Megaphone className="size-3 text-emerald-400" />
                                        <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Campanha</span>
                                      </div>
                                    )}

                                    {/* Quoted reply preview */}
                                    {msg.quotedMsgId && (
                                      <div className="bg-foreground/5 dark:bg-foreground/10 rounded-lg p-2 mb-1.5 border-l-[3px] border-primary/60 text-xs">
                                        {msg.quotedPushName && (
                                          <p className="font-semibold text-primary truncate">{msg.quotedPushName}</p>
                                        )}
                                        <p className="text-muted-foreground truncate">
                                          {msg.quotedType === 'image' ? (
                                            <span className="inline-flex items-center gap-1"><ImageIcon className="size-3" />Foto</span>
                                          ) : msg.quotedContent ? (
                                            msg.quotedContent.length > 80 ? msg.quotedContent.substring(0, 80) + '...' : msg.quotedContent
                                          ) : msg.quotedType ? (
                                            mediaPreviewText(msg.quotedType, '')
                                          ) : 'Mensagem'}
                                        </p>
                                      </div>
                                    )}

                                    {/* Sticker */}
                                    {msg.mediaUrl && msg.messageType === 'sticker' && (
                                      <div className="mb-1.5 rounded-lg overflow-hidden max-w-48">
                                        <img src={msg.mediaUrl} alt="Figurinha" className="max-w-full max-h-48 object-contain rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                      </div>
                                    )}

                                    {/* Image */}
                                    {msg.mediaUrl && msg.messageType === 'image' && (
                                      <div className="mb-1.5 rounded-xl overflow-hidden">
                                        <img src={msg.mediaUrl} alt={msg.mediaCaption || 'Imagem'} className="max-w-full max-h-72 object-cover rounded-xl cursor-pointer" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                        {msg.mediaCaption && <p className="text-xs mt-1.5 opacity-80">{msg.mediaCaption}</p>}
                                      </div>
                                    )}

                                    {/* Video */}
                                    {msg.mediaUrl && msg.messageType === 'video' && (
                                      <div className="mb-1.5 rounded-xl overflow-hidden">
                                        <video controls className="max-w-full max-h-72 rounded-xl" src={msg.mediaUrl} preload="metadata">Seu navegador nao suporta video.</video>
                                        {msg.mediaCaption && <p className="text-xs mt-1.5 opacity-80">{msg.mediaCaption}</p>}
                                      </div>
                                    )}

                                    {/* Audio / Voice message — WhatsApp-style player */}
                                    {msg.mediaUrl && msg.messageType === 'audio' && (
                                      <AudioPlayer src={msg.mediaUrl} duration={msg.mediaDuration} isMe={isMe} />
                                    )}

                                    {/* Document */}
                                    {msg.mediaUrl && msg.messageType === 'document' && (
                                      <div className="mb-1.5 flex items-center gap-2.5 px-1 py-1.5 bg-foreground/5 dark:bg-foreground/10 rounded-lg">
                                        <div className="size-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                                          <FileIcon className="size-4 text-primary" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <span className="text-xs block truncate font-medium">{msg.fileName || 'Documento'}</span>
                                          {msg.mimeType && <span className="text-xs text-muted-foreground">{msg.mimeType}</span>}
                                        </div>
                                      </div>
                                    )}

                                    {/* Template */}
                                    {msg.messageType === 'template' && !msg.messageContent && (
                                      <div className="mb-1.5 flex items-center gap-2 px-1 py-1.5">
                                        <FileText className="size-4 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">Mensagem de template</span>
                                      </div>
                                    )}

                                    {/* Reactions are handled as badges below the bubble — skip standalone rendering */}

                                    {/* Contact */}
                                    {msg.messageType === 'contact' && (
                                      <div className="mb-1.5 flex items-center gap-2 px-1 py-1.5 bg-foreground/5 dark:bg-foreground/10 rounded-lg">
                                        <div className="size-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                                          <User className="size-3.5 text-primary" />
                                        </div>
                                        <span className="text-xs">{msg.messageContent}</span>
                                      </div>
                                    )}

                                    {/* Location */}
                                    {msg.messageType === 'location' && (
                                      <div className="mb-1.5 flex items-center gap-2 px-1 py-1.5 bg-foreground/5 dark:bg-foreground/10 rounded-lg">
                                        <div className="size-8 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                                          <MapPin className="size-3.5 text-red-400" />
                                        </div>
                                        <span className="text-xs">{msg.messageContent}</span>
                                      </div>
                                    )}

                                    {/* Group invite */}
                                    {msg.messageType === 'group_invite' && (
                                      <div className="mb-1.5 flex items-center gap-2 px-1 py-1.5 bg-foreground/5 dark:bg-foreground/10 rounded-lg">
                                        <div className="size-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                                          <Users className="size-3.5 text-emerald-400" />
                                        </div>
                                        <span className="text-xs">{msg.messageContent}</span>
                                      </div>
                                    )}

                                    {/* Poll */}
                                    {msg.messageType === 'poll' && (
                                      <div className="mb-1.5 flex items-center gap-2 px-1 py-1.5 bg-foreground/5 dark:bg-foreground/10 rounded-lg">
                                        <div className="size-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
                                          <BarChart3 className="size-3.5 text-blue-400" />
                                        </div>
                                        <span className="text-xs">{msg.messageContent}</span>
                                      </div>
                                    )}

                                    {/* Deleted */}
                                    {msg.messageType === 'deleted' && (
                                      <p className="text-sm italic text-muted-foreground">Mensagem apagada</p>
                                    )}

                                    {/* Text content */}
                                    {msg.messageContent && msg.messageType !== 'deleted' && (() => {
                                      const c = msg.messageContent
                                      if (c.startsWith('{') || c.startsWith('[')) {
                                        // Try to parse reaction emoji from JSON
                                        const reactionMatch = c.match(/"text"\s*:\s*"([^"]+)"/)
                                        if (reactionMatch && (msg.messageType === 'unknown' || msg.messageType === 'reaction')) {
                                          // Show as a small reaction bubble
                                          return (
                                            <div className="flex items-center gap-1.5 py-0.5">
                                              <span className="text-lg">{reactionMatch[1]}</span>
                                            </div>
                                          )
                                        }
                                        return <p className="text-sm italic text-muted-foreground">Mensagem nao suportada</p>
                                      }
                                      return <p className={cn(
                                        'text-sm whitespace-pre-wrap break-words leading-relaxed',
                                        msg.messageType === 'template' ? 'italic text-muted-foreground' : ''
                                      )}>{c}</p>
                                    })()}

                                    {/* Time + Delivery receipt */}
                                    <div className={cn(
                                      'flex items-center gap-1 mt-1',
                                      isMe ? 'justify-end' : 'justify-start'
                                    )}>
                                      <span className="text-xs text-muted-foreground/70 tabular-nums">
                                        {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                      {/* Media type label for non-standard types */}
                                      {msg.messageType !== 'text' && msg.messageType !== 'image' && msg.messageType !== 'video' && msg.messageType !== 'audio' && msg.messageType !== 'document' && msg.messageType !== 'sticker' && msg.messageType !== 'deleted' && msg.messageType !== 'reaction' && msg.messageType !== 'unknown' && msg.messageType !== 'system' && msg.messageType !== 'contact' && msg.messageType !== 'location' && (
                                        <span className="text-xs text-muted-foreground/50">
                                          {msg.messageType === 'template' ? 'template' : msg.messageType === 'button_response' ? 'botao' : msg.messageType === 'list_response' ? 'lista' : msg.messageType === 'poll' ? 'enquete' : msg.messageType === 'group_invite' ? 'convite' : msg.messageType}
                                        </span>
                                      )}
                                      {/* WhatsApp check marks */}
                                      {isMe && ackStatus && (
                                        <WhatsAppChecks ack={msg.ack} status={msg.status} />
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Reactions — WhatsApp-style badges below the bubble */}
                                {reactions.length > 0 && <ReactionBadges reactions={reactions} isMe={isMe} />}
                              </React.Fragment>
                            )
                          })}
                          <div ref={messagesEndRef} />
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* ===== Reply Input ===== */}
                {selectedConversation.chip?.status === 'connected' ? (
                  <div className="px-4 py-3 border-t border-border/40">
                    <div className="max-w-3xl mx-auto">
                      {/* Reply-to preview */}
                      {replyingTo && (
                        <div className="flex items-center gap-2 mb-2 p-2 bg-muted/50 rounded-lg border-l-[3px] border-primary">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold text-primary">
                              {replyingTo.pushName || replyingTo.contactName || 'Voce'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {replyingTo.messageContent
                                ? (replyingTo.messageContent.length > 80 ? replyingTo.messageContent.substring(0, 80) + '...' : replyingTo.messageContent)
                                : mediaPreviewText(replyingTo.messageType, '')}
                            </p>
                          </div>
                          <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => setReplyingTo(null)}>
                            <X className="size-3" />
                          </Button>
                        </div>
                      )}

                      {/* Attached file preview */}
                      {attachedFile && (
                        <div className="flex items-center gap-2 mb-2 p-2 bg-muted/50 rounded-lg">
                          {attachedFile.type === 'image' && attachedFile.preview ? (
                            <img src={attachedFile.preview} alt="Preview" className="size-10 rounded object-cover" />
                          ) : (
                            <div className="size-10 rounded bg-muted flex items-center justify-center">
                              {attachedFile.type === 'video' ? <Video className="size-4" /> :
                               attachedFile.type === 'audio' ? <Mic className="size-4" /> :
                               <FileIcon className="size-4" />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{attachedFile.file.name}</p>
                            <p className="text-[10px] text-muted-foreground">{(attachedFile.file.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => setAttachedFile(null)}>
                            <X className="size-3" />
                          </Button>
                        </div>
                      )}

                      {/* Input bar */}
                      <div className="flex items-end gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                          onChange={handleFileAttach}
                        />
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-10 shrink-0"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={sending}
                              >
                                <Paperclip className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Anexar arquivo</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <div className="flex-1">
                          <Textarea
                            placeholder={replyingTo ? `Respondendo ${replyingTo.pushName || replyingTo.contactName || 'mensagem'}...` : "Digite uma mensagem..."}
                            className="min-h-[42px] max-h-32 resize-none text-sm"
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleReply()
                              }
                            }}
                            disabled={sending}
                          />
                        </div>
                        <Button
                          size="icon"
                          className="size-10 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
                          onClick={handleReply}
                          disabled={(!replyText.trim() && !attachedFile) || sending}
                        >
                          {sending ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3 border-t border-border/40 bg-muted/30">
                    <p className="text-xs text-muted-foreground text-center">
                      Este chip esta {statusLabel(selectedConversation.chip?.status || 'disconnected')}. Conecte o chip para responder.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {selectedConversation?.isGroup && selectedChipId && (
        <ExtractMembersDialog
          open={extractDialogOpen}
          onOpenChange={setExtractDialogOpen}
          chipId={selectedChipId}
          chipName={chips.find(c => c.id === selectedChipId)?.name || ''}
          groupJid={selectedConversation.remoteJid}
          groupName={selectedConversation.groupName || selectedConversation.contactName || 'Grupo'}
          onExtracted={() => {
            toast.success('Lista criada! Acesse pela aba Lista de Contatos.')
          }}
        />
      )}

    </div>
  )
}
