export interface Chip {
  id: string
  name: string
  phoneNumber: string
  wireguardIp: string
  wireguardPrivKey: string
  wireguardPubKey: string
  socksPort: number
  status: string
  lastSeen: string | null
  createdAt: string
  updatedAt: string
  dailyLimit: number
  sentToday: number
  lastResetAt: string
  warmingEnabled: boolean
  warmingStage: number
  warmingPhase?: string
  warmingStartedAt?: string | null
  prewarmStartedAt?: string | null
  isQrPaired: boolean
  qrPairingCode: string | null
  proxyMode: string
  socks5Host: string
  socks5Port: number
  socks5User: string
  socks5Pass: string
  evolutionInstance?: string | null
  profileName?: string | null
  profilePicUrl?: string | null
  disconnectionReasonCode?: number | null
  cooldownUntil?: string | null
  hourlySent?: number
}

export interface SequenceStep {
  id: string
  campaignId: string
  stepOrder: number
  content: string
  delayMinutes: number
  delayUnit?: string
  mediaUrl?: string | null
  mediatype?: string | null
  variations?: string
  createdAt: string
}

export interface Campaign {
  id: string
  name: string
  status: string
  sendIntervalMin: number
  sendIntervalMax: number
  contactListId: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  antiBanEnabled: boolean
  warmingMode: string
  statusReason?: string | null
  pausedAt?: string | null
  chips: { id: string; chipId: string; contactLimit?: number | null; chip: Chip }[]
  sequenceSteps: SequenceStep[]
  contactList: { id: string; name: string } | null
  _count?: { messages: number }
  messageStatusCounts?: Record<string, number>
}

export interface ContactItem {
  id: string
  name: string
  phone: string
  position: number
  contactListId: string | null
  chipId: string | null
  customFields: string | null
  createdAt: string
}

export interface ContactList {
  id: string
  name: string
  columns?: string | null
  createdAt: string
  updatedAt: string
  _count?: { contacts: number; campaigns: number }
}

export interface MessageItem {
  id: string
  campaignId: string | null
  chipId: string
  contactId: string
  content: string
  status: string
  stepOrder: number
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  error: string | null
  evolutionMessageId: string | null
  createdAt: string
  updatedAt?: string | null
  chip: { name: string; phoneNumber: string }
  contact: { name: string; phone: string }
}

export interface Stats {
  totalChips: number
  connectedChips: number
  disconnectedChips: number
  errorChips: number
  totalCampaigns: number
  activeCampaigns: number
  totalMessages: number
  sentMessages: number
  deliveredMessages: number
  readMessages: number
  failedMessages: number
  pendingMessages: number
  deliveryRate: number
  totalContacts: number
  totalSent: number
  recentMessages: MessageItem[]
  runningCampaigns: Campaign[]
  chipStatuses: { id: string; name: string; phoneNumber: string; status: string; sentToday: number; dailyLimit: number }[]
}

export interface MessageTemplate {
  id: string
  name: string
  content: string
  category: string
  mediatype: string
  mediaDescription: string
  linkUrl: string
  linkPreview: boolean
  createdAt: string
  updatedAt: string
}

export type StepForm = {
  content: string
  delayMinutes: number
  delayUnit: string
  mediaFile: File | null
  mediaUrl: string
  mediatype: string
  audioMode: 'whatsapp' | 'original'
  caption: string
  linkUrl: string
  linkPreview: boolean
  contactName: string
  contactPhone: string
  locationLat: string
  locationLng: string
  locationName: string
  variations: Array<{
    content: string
    mediaFile: File | null
    mediaUrl: string
    mediatype: string
    audioMode: 'whatsapp' | 'original'
    caption: string
    linkUrl: string
    linkPreview: boolean
    contactName: string
    contactPhone: string
    locationLat: string
    locationLng: string
    locationName: string
  }>
}
