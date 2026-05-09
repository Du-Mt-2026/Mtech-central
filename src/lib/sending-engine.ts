// Sending Engine with Anti-Ban Protection
// Processes campaign message queues with delay, typing simulation, and rate limiting

import { sendTextMessage, setPresence, formatPhoneNumber } from './evolution-api'
import { db } from './db'

interface SendJob {
  messageId: string
  chipId: string
  contactId: string
  campaignId: string
  content: string
  phoneNumber: string
  evolutionInstance: string
}

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

/**
 * Get the daily limit for a chip considering warming stage
 */
function getEffectiveDailyLimit(chip: { dailyLimit: number; warmingEnabled: boolean; warmingStage: number }, settings: AntiBanConfig): number {
  if (!chip.warmingEnabled || !settings.warmingEnabled) return chip.dailyLimit || settings.dailyLimitPerChip
  const stage = Math.min(chip.warmingStage, WARMING_LIMITS.length - 1)
  return Math.min(WARMING_LIMITS[stage], chip.dailyLimit || settings.dailyLimitPerChip)
}

/**
 * Random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Sleep for ms milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Check if chip can send more messages today
 */
async function canSendMore(chipId: string, effectiveLimit: number): Promise<boolean> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return false

  // Check if daily limit reset is needed
  const now = new Date()
  const lastReset = new Date(chip.lastResetAt)
  if (now.getDate() !== lastReset.getDate() || now.getMonth() !== lastReset.getMonth()) {
    await db.chip.update({
      where: { id: chipId },
      data: { sentToday: 0, lastResetAt: now },
    })
    return true
  }

  return chip.sentToday < effectiveLimit
}

/**
 * Apply cooldown if chip has sent too many messages
 */
async function applyCooldown(chipId: string, settings: AntiBanConfig): Promise<void> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return

  if (chip.sentToday > 0 && chip.sentToday % settings.cooldownAfterMessages === 0) {
    const cooldownMs = settings.cooldownMinutes * 60 * 1000
    console.log(`[SendingEngine] Cooldown ${settings.cooldownMinutes}min for chip ${chipId} after ${chip.sentToday} messages`)
    await sleep(cooldownMs)
  }
}

/**
 * Process a single message send with anti-ban delays
 */
async function processMessage(job: SendJob, settings: AntiBanConfig): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Simulate typing presence
    const typingDelay = randomInt(settings.typingMinDelay, settings.typingMaxDelay)
    try {
      await setPresence(job.evolutionInstance, `${job.phoneNumber}@s.whatsapp.net`, 'composing', typingDelay)
    } catch (e) {
      console.warn(`[SendingEngine] Typing simulation failed for ${job.evolutionInstance}:`, e)
      // Non-fatal, continue sending
    }

    // Wait for typing delay
    await sleep(typingDelay)

    // 2. Send the message
    const formattedNumber = formatPhoneNumber(job.phoneNumber)
    const result = await sendTextMessage(job.evolutionInstance, formattedNumber, job.content, {
      delay: randomInt(settings.messageIntervalMin * 1000, settings.messageIntervalMax * 1000),
    })

    // 3. Update message status
    await db.message.update({
      where: { id: job.messageId },
      data: {
        status: 'sent',
        sentAt: new Date(),
      },
    })

    // 4. Increment chip's sentToday counter
    await db.chip.update({
      where: { id: job.chipId },
      data: {
        sentToday: { increment: 1 },
        lastSeen: new Date(),
      },
    })

    // 5. Apply cooldown if needed
    await applyCooldown(job.chipId, settings)

    console.log(`[SendingEngine] Message sent: ${job.messageId} to ${formattedNumber}`)
    return { success: true }

  } catch (error: any) {
    console.error(`[SendingEngine] Failed to send message ${job.messageId}:`, error.message)

    // Update message with error
    await db.message.update({
      where: { id: job.messageId },
      data: {
        status: 'failed',
        error: error.message?.substring(0, 500),
      },
    })

    return { success: false, error: error.message }
  }
}

/**
 * Get pending messages for a campaign, organized by chip
 */
async function getPendingMessages(campaignId: string): Promise<SendJob[]> {
  const messages = await db.message.findMany({
    where: {
      campaignId,
      status: 'pending',
    },
    include: {
      chip: true,
      contact: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return messages
    .filter(msg => msg.chip.evolutionInstance)
    .map(msg => ({
      messageId: msg.id,
      chipId: msg.chipId,
      contactId: msg.contactId,
      campaignId: msg.campaignId!,
      content: msg.content,
      phoneNumber: msg.contact.phone,
      evolutionInstance: msg.chip.evolutionInstance!,
    }))
}

/**
 * Process a campaign's message queue
 */
export async function processCampaign(campaignId: string): Promise<{
  processed: number
  succeeded: number
  failed: number
  skipped: number
}> {
  console.log(`[SendingEngine] Processing campaign: ${campaignId}`)

  // Get anti-ban settings
  let settings: AntiBanConfig = {
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

  try {
    const savedSettings = await db.antiBanSettings.findFirst()
    if (savedSettings) {
      settings = {
        typingMinDelay: savedSettings.typingMinDelay,
        typingMaxDelay: savedSettings.typingMaxDelay,
        messageIntervalMin: savedSettings.messageIntervalMin,
        messageIntervalMax: savedSettings.messageIntervalMax,
        dailyLimitPerChip: savedSettings.dailyLimitPerChip,
        warmingEnabled: savedSettings.warmingEnabled,
        warmingDays: savedSettings.warmingDays,
        cooldownMinutes: savedSettings.cooldownMinutes,
        cooldownAfterMessages: savedSettings.cooldownAfterMessages,
        stopOnWarning: savedSettings.stopOnWarning,
      }
    }
  } catch (e) {
    console.warn('[SendingEngine] Could not load anti-ban settings, using defaults')
  }

  // Get pending messages
  const jobs = await getPendingMessages(campaignId)
  if (jobs.length === 0) {
    console.log(`[SendingEngine] No pending messages for campaign ${campaignId}`)
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 }
  }

  // Group by chip to distribute load
  const jobsByChip = new Map<string, SendJob[]>()
  for (const job of jobs) {
    if (!jobsByChip.has(job.chipId)) jobsByChip.set(job.chipId, [])
    jobsByChip.get(job.chipId)!.push(job)
  }

  let processed = 0
  let succeeded = 0
  let failed = 0
  let skipped = 0

  // Process messages round-robin across chips to spread the load
  const chipIds = Array.from(jobsByChip.keys())
  const chipQueues = new Map(chipIds.map(id => [id, jobsByChip.get(id)!]))

  while (true) {
    let allEmpty = true
    for (const chipId of chipIds) {
      const queue = chipQueues.get(chipId)!
      if (queue.length === 0) continue

      allEmpty = false
      const job = queue.shift()!

      // Check daily limit
      const chip = await db.chip.findUnique({ where: { id: chipId } })
      if (!chip) continue

      const effectiveLimit = getEffectiveDailyLimit(chip, settings)
      if (!(await canSendMore(chipId, effectiveLimit))) {
        console.log(`[SendingEngine] Chip ${chipId} hit daily limit (${effectiveLimit}), skipping remaining messages`)
        skipped += queue.length + 1
        queue.length = 0
        continue
      }

      // Apply inter-message delay
      const delay = randomInt(settings.messageIntervalMin, settings.messageIntervalMax) * 1000
      await sleep(delay)

      // Process the message
      const result = await processMessage(job, settings)
      processed++
      if (result.success) succeeded++
      else failed++

      // Update campaign progress
      await db.campaign.update({
        where: { id: campaignId },
        data: { updatedAt: new Date() },
      })
    }

    if (allEmpty) break
  }

  // Check if campaign is complete
  const remaining = await db.message.count({
    where: { campaignId, status: 'pending' },
  })

  if (remaining === 0) {
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    })
    console.log(`[SendingEngine] Campaign ${campaignId} completed!`)
  }

  console.log(`[SendingEngine] Campaign ${campaignId} batch done: ${processed} processed, ${succeeded} sent, ${failed} failed, ${skipped} skipped`)
  return { processed, succeeded, failed, skipped }
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
  if (campaign.sequenceSteps.length === 0) throw new Error('Campanha não tem etapas de mensagem')

  const contacts = campaign.contactList.contacts
  const chips = campaign.chips.map(cc => cc.chip).filter(c => c.evolutionInstance)

  if (chips.length === 0) throw new Error('Nenhum chip com instância WhatsApp conectada')
  if (contacts.length === 0) throw new Error('Lista de contatos vazia')

  // Create messages: each contact gets the first step from a rotating chip
  const messagesToCreate = []
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]
    const chip = chips[i % chips.length] // Round-robin assignment
    const firstStep = campaign.sequenceSteps[0] // Start with first step

    // Replace template variables
    const content = firstStep.content
      .replace(/\{nome\}/g, contact.name)
      .replace(/\{telefone\}/g, contact.phone)

    messagesToCreate.push({
      campaignId: campaign.id,
      chipId: chip.id,
      contactId: contact.id,
      content,
      status: 'pending',
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
 * Get all running campaigns that need processing
 */
export async function getRunningCampaigns(): Promise<string[]> {
  const campaigns = await db.campaign.findMany({
    where: { status: 'running' },
    select: { id: true },
  })
  return campaigns.map(c => c.id)
}
