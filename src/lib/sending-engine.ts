// Sending Engine with Anti-Ban Protection
// Serverless-compatible: processes ONE message per invocation
// Vercel Cron calls /api/campaigns/process-all every minute

import { sendTextMessage, sendMediaMessage, setPresence, formatPhoneNumber } from './evolution-api'
import { db } from './db'

interface AntiBanConfig {
  typingMinDelay: number
  typingMaxDelay: number
  messageIntervalMin: number
  messageIntervalMax: number
  dailyLimitPerChip: number
  warmingEnabled: boolean
  warmingDays: number
  cooldownMinutes: number
  cooldownAfterMessages: number
  stopOnWarning: boolean
}

// Warming schedule: stage -> daily limit
const WARMING_LIMITS = [10, 30, 80, 150, 200]

const DEFAULT_SETTINGS: AntiBanConfig = {
  typingMinDelay: 500,
  typingMaxDelay: 2000,
  messageIntervalMin: 30,
  messageIntervalMax: 90,
  dailyLimitPerChip: 200,
  warmingEnabled: true,
  warmingDays: 7,
  cooldownMinutes: 30,
  cooldownAfterMessages: 50,
  stopOnWarning: true,
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function getEffectiveDailyLimit(chip: { dailyLimit: number; warmingEnabled: boolean; warmingStage: number }, settings: AntiBanConfig): number {
  if (!chip.warmingEnabled || !settings.warmingEnabled) return chip.dailyLimit || settings.dailyLimitPerChip
  const stage = Math.min(chip.warmingStage, WARMING_LIMITS.length - 1)
  return Math.min(WARMING_LIMITS[stage], chip.dailyLimit || settings.dailyLimitPerChip)
}

/**
 * Get anti-ban settings from DB or defaults
 */
async function getAntiBanSettings(): Promise<AntiBanConfig> {
  try {
    const saved = await db.antiBanSettings.findFirst()
    if (saved) {
      return {
        typingMinDelay: saved.typingMinDelay,
        typingMaxDelay: saved.typingMaxDelay,
        messageIntervalMin: saved.messageIntervalMin,
        messageIntervalMax: saved.messageIntervalMax,
        dailyLimitPerChip: saved.dailyLimitPerChip,
        warmingEnabled: saved.warmingEnabled,
        warmingDays: saved.warmingDays,
        cooldownMinutes: saved.cooldownMinutes,
        cooldownAfterMessages: saved.cooldownAfterMessages,
        stopOnWarning: saved.stopOnWarning,
      }
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_SETTINGS
}

/**
 * Reset chip daily counter if a new day has started
 */
async function resetDailyIfNeeded(chipId: string): Promise<void> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return
  const now = new Date()
  const lastReset = new Date(chip.lastResetAt)
  if (now.getDate() !== lastReset.getDate() || now.getMonth() !== lastReset.getMonth()) {
    await db.chip.update({
      where: { id: chipId },
      data: { sentToday: 0, lastResetAt: now },
    })
  }
}

/**
 * Check if chip is in cooldown period
 */
async function isInCooldown(chipId: string, settings: AntiBanConfig): Promise<boolean> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return true

  if (chip.sentToday > 0 && chip.sentToday % settings.cooldownAfterMessages === 0) {
    // Simple cooldown: skip this chip for now (next cron will retry)
    console.log(`[SendingEngine] Chip ${chipId} in cooldown after ${chip.sentToday} messages`)
    return true
  }
  return false
}

/**
 * Start a campaign: create pending messages and set status to running
 */
export async function startCampaign(campaignId: string): Promise<{ messageCount: number }> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      chips: { include: { chip: true } },
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      contactList: { include: { contacts: true } },
    },
  })

  if (!campaign) throw new Error('Campanha não encontrada')
  if (!campaign.contactList) throw new Error('Campanha não tem lista de contatos')
  if (campaign.chips.length === 0) throw new Error('Campanha não tem chips atribuídos')

  // Derive message content from sequence steps (each step may have variations)
  const hasSteps = campaign.sequenceSteps.length > 0

  // Parse steps and their variations
  type VariationObj = { content: string; mediaUrl?: string; mediatype?: string }
  type StepWithVariations = {
    stepOrder: number
    content: string
    mediaUrl: string | null
    mediatype: string | null
    delayMinutes: number
    variations: VariationObj[]
  }

  const parsedSteps: StepWithVariations[] = campaign.sequenceSteps.map(s => {
    let stepVariations: VariationObj[] = []
    try {
      const raw = JSON.parse(s.variations || '[]')
      if (Array.isArray(raw) && raw.length > 0) {
        stepVariations = raw.filter((v: VariationObj) => v.content && v.content.trim())
      }
    } catch { /* ignore */ }
    return {
      stepOrder: s.stepOrder,
      content: s.content,
      mediaUrl: s.mediaUrl || null,
      mediatype: s.mediatype || null,
      delayMinutes: s.delayMinutes,
      variations: stepVariations,
    }
  })

  if (!hasSteps || parsedSteps.length === 0) {
    throw new Error('Campanha não tem mensagens configuradas. Adicione etapas com mensagens.')
  }

  // Build all possible message items grouped by step
  type MessageItem = { content: string; mediaUrl: string | null; mediatype: string | null; stepOrder: number }
  const stepsMap = new Map<number, MessageItem[]>()
  for (const step of parsedSteps) {
    if (!stepsMap.has(step.stepOrder)) stepsMap.set(step.stepOrder, [])
    const items = stepsMap.get(step.stepOrder)!

    if (step.variations.length > 0) {
      for (const v of step.variations) {
        items.push({
          content: v.content,
          mediaUrl: v.mediaUrl || step.mediaUrl || null,
          mediatype: v.mediatype || step.mediatype || null,
          stepOrder: step.stepOrder,
        })
      }
    } else {
      items.push({
        content: step.content,
        mediaUrl: step.mediaUrl || null,
        mediatype: step.mediatype || null,
        stepOrder: step.stepOrder,
      })
    }
  }

  const contacts = campaign.contactList.contacts
  const chips = campaign.chips.map(cc => cc.chip).filter(c => c.evolutionInstance)

  if (chips.length === 0) throw new Error('Nenhum chip com instância WhatsApp conectada')
  if (contacts.length === 0) throw new Error('Lista de contatos vazia')

  // Create messages: for single-step campaigns, random variation selection
  // For multi-step campaigns, start with step 1 only
  const isMultiStep = stepsMap.size > 1
  const step1Items = stepsMap.get(1) || []
  const singleStepItems = Array.from(stepsMap.values()).flat()

  const messagesToCreate = []
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]
    const chip = chips[i % chips.length]
    const itemsPool = isMultiStep ? step1Items : singleStepItems
    const messageItem = itemsPool[Math.floor(Math.random() * itemsPool.length)]

    // Replace template variables
    const content = messageItem.content
      .replace(/\{nome\}/g, contact.name)
      .replace(/\{telefone\}/g, contact.phone)

    messagesToCreate.push({
      campaignId: campaign.id,
      chipId: chip.id,
      contactId: contact.id,
      content,
      status: 'pending' as const,
      mediaUrl: messageItem.mediaUrl,
      mediatype: messageItem.mediatype,
    })
  }

  await db.message.createMany({ data: messagesToCreate })

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'running',
      startedAt: new Date(),
    },
  })

  return { messageCount: messagesToCreate.length }
}

/**
 * Process the NEXT pending message for a campaign.
 * Serverless-friendly: processes exactly ONE message per call.
 * Returns the delay (ms) the caller should wait before processing the next one.
 */
export async function processNextMessage(campaignId: string): Promise<{
  processed: boolean
  delayMs: number
  remaining: number
  completed: boolean
}> {
  // Check if campaign is paused — if so, skip processing
  const campaignStatus = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  })
  if (!campaignStatus) {
    return { processed: false, delayMs: 0, remaining: 0, completed: true }
  }
  if (campaignStatus.status === 'paused') {
    return { processed: false, delayMs: 0, remaining: -1, completed: false }
  }

  // Check if anti-ban is enabled for this campaign
  const campaignInfo = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { antiBanEnabled: true },
  })
  const antiBanEnabled = campaignInfo?.antiBanEnabled ?? true

  const settings = await getAntiBanSettings()

  // Find the next pending message
  const message = await db.message.findFirst({
    where: { campaignId, status: 'pending' },
    include: { chip: true, contact: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!message) {
    // No more pending messages — check if campaign is done
    const stillPending = await db.message.count({
      where: { campaignId, status: { in: ['pending', 'sending'] } },
    })

    if (stillPending === 0) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date() },
      })
      return { processed: false, delayMs: 0, remaining: 0, completed: true }
    }

    return { processed: false, delayMs: 5000, remaining: stillPending, completed: false }
  }

  // Check chip exists and has evolution instance
  if (!message.chip.evolutionInstance) {
    await db.message.update({
      where: { id: message.id },
      data: { status: 'failed', error: 'Chip sem instância Evolution API' },
    })
    return { processed: true, delayMs: 1000, remaining: -1, completed: false }
  }

  // Reset daily counter if needed
  await resetDailyIfNeeded(message.chipId)

  // Check daily limit
  const chip = await db.chip.findUnique({ where: { id: message.chipId } })
  if (!chip) {
    await db.message.update({
      where: { id: message.id },
      data: { status: 'failed', error: 'Chip não encontrado' },
    })
    return { processed: true, delayMs: 1000, remaining: -1, completed: false }
  }

  const effectiveLimit = getEffectiveDailyLimit(chip, settings)
  if (antiBanEnabled && chip.sentToday >= effectiveLimit) {
    // Skip this chip's messages — mark as skipped (will retry next day via auto-reset)
    console.log(`[SendingEngine] Chip ${chip.name} hit daily limit (${chip.sentToday}/${effectiveLimit})`)
    // Don't fail the message, just skip it for now
    return { processed: false, delayMs: 2000, remaining: -1, completed: false }
  }

  // Check cooldown (skip if anti-ban disabled)
  if (antiBanEnabled && await isInCooldown(message.chipId, settings)) {
    return { processed: false, delayMs: settings.cooldownMinutes * 60 * 1000, remaining: -1, completed: false }
  }

  // Mark as sending
  await db.message.update({
    where: { id: message.id },
    data: { status: 'sending' },
  })

  try {
    const instanceName = message.chip.evolutionInstance
    const formattedPhone = formatPhoneNumber(message.contact.phone)

    // Simulate typing (skip if anti-ban disabled)
    if (antiBanEnabled) {
      const typingDelay = randomInt(settings.typingMinDelay, settings.typingMaxDelay)
      try {
        await setPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'composing', typingDelay)
      } catch {
        // Non-fatal
      }
      // Small delay for typing
      await new Promise(resolve => setTimeout(resolve, Math.min(typingDelay, 2000)))
    }

    // Send the message — use media or text depending on message fields
    let result
    if (message.mediaUrl && message.mediatype) {
      const validMediaTypes = ['image', 'document', 'video', 'audio']
      const mt = message.mediatype as 'image' | 'document' | 'video' | 'audio'
      if (validMediaTypes.includes(mt)) {
        // Audio doesn't support captions on WhatsApp
        const caption = mt === 'audio' ? '' : (message.content || '')
        result = await sendMediaMessage(instanceName, formattedPhone, message.mediaUrl, mt, {
          caption,
          delay: 0,
        })
      } else {
        // Fallback to text if mediatype is invalid
        result = await sendTextMessage(instanceName, formattedPhone, message.content, {
          delay: 0,
        })
      }
    } else {
      result = await sendTextMessage(instanceName, formattedPhone, message.content, {
        delay: 0, // We handle delays ourselves via cron intervals
      })
    }

    // Update message status
    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        evolutionMessageId: result.key?.id || null,
      },
    })

    // Increment chip counter
    await db.chip.update({
      where: { id: message.chipId },
      data: { sentToday: { increment: 1 }, lastSeen: new Date() },
    })

    console.log(`[SendingEngine] Sent message ${message.id} to ${formattedPhone} via ${instanceName}`)

    // Calculate delay before next message (anti-ban interval)
    const nextDelay = randomInt(settings.messageIntervalMin, settings.messageIntervalMax) * 1000
    const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })

    return { processed: true, delayMs: nextDelay, remaining, completed: remaining === 0 }

  } catch (error: any) {
    console.error(`[SendingEngine] Failed to send message ${message.id}:`, error.message)

    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'failed',
        error: error.message?.substring(0, 500),
      },
    })

    const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
    return { processed: true, delayMs: 5000, remaining, completed: remaining === 0 }
  }
}

/**
 * Legacy function kept for backwards compatibility.
 * Now processes just ONE message per call (serverless-safe).
 */
export async function processCampaign(campaignId: string): Promise<{
  processed: number
  succeeded: number
  failed: number
  skipped: number
}> {
  const result = await processNextMessage(campaignId)
  return {
    processed: result.processed ? 1 : 0,
    succeeded: result.processed ? 1 : 0,
    failed: 0,
    skipped: 0,
  }
}

/**
 * Get all running campaigns that need processing
 */
export async function getRunningCampaigns(): Promise<string[]> {
  const campaigns = await db.campaign.findMany({
    where: { status: 'running' },
    select: { id: true },
  })
  return campaigns.map(c => c.id)
}
