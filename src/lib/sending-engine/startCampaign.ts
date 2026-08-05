// Campaign start logic — spintax/template resolution helpers and the
// startCampaign() entry point that creates pending messages and atomically
// transitions a campaign from draft/scheduled to running.
//
// CRITICAL ORDER: Messages are created BEFORE the campaign status is set to
// 'running' so the auto-processing loop cannot prematurely complete the campaign.

import { db } from '../db'

// ============================================================
// CAMPAIGN MANAGEMENT
// ============================================================

/**
 * Resolve {{KEY: var1 | var2 | var3}} blocks in text.
 * For each KEY block, pick a random variation.
 * Supports nested {{variable}} inside variations (e.g., {{KEY: Meu nome é {{vendedor}}... | ...}})
 *
 * ANTI-BAN: Consecutive dedup — if the same KEY block appears in messages
 * sent one after another, avoid picking the same variation twice in a row.
 * This prevents the pattern where a bot sends identical phrasing to multiple
 * contacts, which is detectable. Uses a simple static cache keyed by block content.
 */
// Cache of last-used variation index per KEY block content
// C4/C5 FIX: Cap the variation cache to prevent unbounded memory growth
const MAX_SPINTAX_CACHE_SIZE = 500
const lastUsedVariation = new Map<string, number>()

function evictSpintaxCacheIfNeeded(): void {
  if (lastUsedVariation.size <= MAX_SPINTAX_CACHE_SIZE) return
  const keysIter = lastUsedVariation.keys()
  for (let i = 0; i < MAX_SPINTAX_CACHE_SIZE / 2; i++) {
    const oldest = keysIter.next().value
    if (oldest !== undefined) lastUsedVariation.delete(oldest)
  }
}

function resolveKeyBlocks(text: string): string {
  // C4/C5 FIX: Evict old entries before potentially adding new ones
  evictSpintaxCacheIfNeeded()

  // Use a custom parser to handle nested {{ }} inside KEY blocks
  let result = ''
  let i = 0
  while (i < text.length) {
    // Look for {{KEY:
    if (text.slice(i, i + 7) === '{{KEY: ') {
      // Find the matching }}
      let depth = 0
      let j = i + 7
      let found = false
      for (; j < text.length - 1; j++) {
        if (text[j] === '{' && text[j + 1] === '{') {
          depth++
          j++ // skip next {
        } else if (text[j] === '}' && text[j + 1] === '}') {
          if (depth > 0) {
            depth--
            j++ // skip next }
          } else {
            // Found the closing }}
            const innerContent = text.slice(i + 7, j)
            const variations = innerContent.split('|').map(s => s.trim()).filter(Boolean)
            if (variations.length > 0) {
              // ANTI-BAN: Consecutive dedup — avoid same variation twice in a row
              let chosenIdx: number
              const cacheKey = innerContent
              const lastIdx = lastUsedVariation.get(cacheKey)

              if (variations.length > 1 && lastIdx !== undefined) {
                // Pick a different variation than last time
                const availableIndices = variations.map((_, idx) => idx).filter(idx => idx !== lastIdx)
                chosenIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)]
              } else {
                chosenIdx = Math.floor(Math.random() * variations.length)
              }

              lastUsedVariation.set(cacheKey, chosenIdx)
              result += variations[chosenIdx]
            }
            i = j + 2
            found = true
            break
          }
        }
      }
      if (!found) {
        // No matching }}, keep as-is
        result += text[i]
        i++
      }
    } else {
      result += text[i]
      i++
    }
  }
  return result
}

/**
 * Resolve old-style {{KEY_NAME}} markers using MessageKey records from the database.
 * - For "random" resolutionType: pick a random variation
 * - For "time_based" resolutionType: resolve based on current time of day using timeSlots config
 *   The timeSlots reference other MessageKey names, which are then resolved recursively.
 */
async function resolveMessageKeyMarkers(text: string): Promise<string> {
  // Find remaining {{SOME_NAME}} patterns that are NOT {{KEY:...}}
  // After contact variable resolution, any remaining {{var}} is either a MessageKey or an unknown variable
  const markerRegex = /\{\{([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*)\}\}/g
  let match
  const markers = new Set<string>()
  while ((match = markerRegex.exec(text)) !== null) {
    const name = match[1]
    if (!name.startsWith('KEY:')) {
      markers.add(name)
    }
  }

  if (markers.size === 0) return text

  // Look up message keys from the database
  const keys = await db.messageKey.findMany({
    where: { name: { in: Array.from(markers) } },
  })

  // For time_based keys, we may need to resolve referenced key names
  const referencedKeyNames = new Set<string>()
  for (const key of keys) {
    if (key.resolutionType === 'time_based' && key.timeSlots) {
      try {
        const slots = JSON.parse(key.timeSlots)
        for (const slot of slots) {
          if (slot.key) referencedKeyNames.add(slot.key)
        }
      } catch { /* ignore */ }
    }
  }

  // Fetch any referenced keys that aren't already loaded
  let allKeys = keys
  if (referencedKeyNames.size > 0) {
    const existingNames = new Set(keys.map(k => k.name))
    const missingNames = Array.from(referencedKeyNames).filter(n => !existingNames.has(n))
    if (missingNames.length > 0) {
      const extraKeys = await db.messageKey.findMany({
        where: { name: { in: missingNames } },
      })
      allKeys = [...keys, ...extraKeys]
    }
  }

  const keyMap = new Map(allKeys.map(k => [k.name, k]))

  let result = text
  for (const key of keys) {
    try {
      const escapedName = key.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      if (key.resolutionType === 'time_based' && key.timeSlots) {
        // Time-based resolution: determine which slot matches current time
        const slots = JSON.parse(key.timeSlots)
        const now = new Date()
        // Use Brazil timezone (America/Sao_Paulo)
        const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
        const currentMinutes = brazilTime.getHours() * 60 + brazilTime.getMinutes()

        let matchedKeyName: string | null = null
        for (const slot of slots) {
          const [startH, startM] = slot.start.split(':').map(Number)
          const [endH, endM] = slot.end.split(':').map(Number)
          const startMinutes = startH * 60 + startM
          const endMinutes = endH * 60 + endM

          if (startMinutes <= endMinutes) {
            // Normal range (e.g., 06:01-12:00)
            if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
              matchedKeyName = slot.key
              break
            }
          } else {
            // Overnight range (e.g., 19:01-06:00)
            if (currentMinutes >= startMinutes || currentMinutes <= endMinutes) {
              matchedKeyName = slot.key
              break
            }
          }
        }

        if (matchedKeyName) {
          // Resolve the referenced key
          const refKey = keyMap.get(matchedKeyName)
          if (refKey) {
            const variations: string[] = JSON.parse(refKey.variations)
            if (variations.length > 0) {
              const chosen = variations[Math.floor(Math.random() * variations.length)]
              result = result.replace(new RegExp(`\\{\\{${escapedName}\\}\\}`, 'g'), chosen)
            }
          } else {
            // Referenced key not found — leave as the referenced key marker
            result = result.replace(new RegExp(`\\{\\{${escapedName}\\}\\}`, 'g'), `{{${matchedKeyName}}}`)
          }
        }
      } else {
        // Default: random resolution
        const variations: string[] = JSON.parse(key.variations)
        if (variations.length > 0) {
          const chosen = variations[Math.floor(Math.random() * variations.length)]
          result = result.replace(new RegExp(`\\{\\{${escapedName}\\}\\}`, 'g'), chosen)
        }
      }
    } catch { /* ignore */ }
  }
  return result
}

/**
 * Start a campaign: create pending messages and set status to running.
 *
 * CRITICAL ORDER: Messages MUST be created BEFORE the campaign status is set to 'running'.
 * If we set status='running' first, the processing loop (auto-process every 60s) can
 * pick up the campaign, find 0 pending messages, and immediately mark it as completed.
 *
 * Uses a database transaction with row-level lock on the Campaign row to prevent
 * race conditions. Two concurrent calls to startCampaign for the same campaign will
 * serialize — the second will see that messages already exist and skip.
 *
 * Additionally, a @@unique([campaignId, contactId, stepOrder]) constraint on Message
 * prevents duplicate records at the database level.
 */
export async function startCampaign(campaignId: string): Promise<{ messageCount: number }> {
  // ============================================================
  // PHASE 1: Atomic status check + lock
  // Use a transaction with row-level lock to prevent race conditions.
  // Two concurrent calls will serialize — only one proceeds to create messages.
  // IMPORTANT: Do NOT set status='running' here — that happens AFTER messages exist.
  // ============================================================
  const startResult = await db.$transaction(async (tx) => {
    // Lock the campaign row to prevent concurrent start attempts
    const campaign = await tx.$queryRaw<Array<{id: string, status: string}>>`
      SELECT id, status FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE
    `

    if (campaign.length === 0) {
      throw new Error('Campanha não encontrada')
    }

    const currentStatus = campaign[0].status

    // If already running with messages, skip
    if (currentStatus === 'running') {
      const existingCount = await tx.message.count({ where: { campaignId } })
      if (existingCount > 0) {
        console.debug(`[SendingEngine] Campaign ${campaignId} already running with ${existingCount} messages — skipping`)
        return { canProceed: false, messageCount: existingCount }
      }
    }

    // If already completed/cancelled, cannot start
    if (currentStatus === 'completed' || currentStatus === 'cancelled') {
      throw new Error(`Campanha não pode ser iniciada no status "${currentStatus}"`)
    }

    // If not draft/scheduled, cannot start
    if (currentStatus !== 'draft' && currentStatus !== 'scheduled') {
      throw new Error(`Campanha não pode ser iniciada no status "${currentStatus}"`)
    }

    // Check for existing messages (in case a previous attempt partially succeeded)
    const existingMessages = await tx.message.count({ where: { campaignId } })
    if (existingMessages > 0) {
      // Messages exist from a previous attempt — just mark as running
      console.debug(`[SendingEngine] Campaign ${campaignId} already has ${existingMessages} messages — marking as running`)
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: 'running', startedAt: new Date(), nextSendAt: null },
      })
      return { canProceed: false, messageCount: existingMessages }
    }

    // Campaign is draft/scheduled with no messages — we can proceed
    // DO NOT set status='running' here! Wait until messages are created.
    return { canProceed: true, messageCount: 0 }
  }, {
    maxWait: 10000,
    timeout: 30000,
  })

  if (!startResult.canProceed) {
    return { messageCount: startResult.messageCount }
  }

  // ============================================================
  // PHASE 2: Create messages (campaign is still in 'draft' status)
  // The processing loop only picks up 'running' campaigns, so there's
  // no risk of premature processing while we're creating messages.
  // ============================================================
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      chips: { include: { chip: true } },
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      contactList: { include: { contacts: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } },
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
    delayUnit: string
    variations: VariationObj[]
  }

  const parsedSteps: StepWithVariations[] = campaign.sequenceSteps.map(s => {
    let stepVariations: VariationObj[] = []
    try {
      const raw = JSON.parse(s.variations || '[]')
      if (Array.isArray(raw) && raw.length > 0) {
        stepVariations = raw.filter((v: VariationObj) =>
          (v.content && v.content.trim()) || v.mediaUrl || v.mediatype
        )
      }
    } catch { /* ignore */ }
    return {
      stepOrder: s.stepOrder,
      content: s.content,
      mediaUrl: s.mediaUrl || null,
      mediatype: s.mediatype || null,
      delayMinutes: s.delayMinutes,
      delayUnit: s.delayUnit || 'minutes',
      variations: stepVariations,
    }
  })

  if (!hasSteps || parsedSteps.length === 0) {
    // Revert to draft since there are no messages
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', startedAt: null } })
    throw new Error('Campanha não tem mensagens configuradas. Adicione etapas com mensagens.')
  }

  // Sort steps by stepOrder to ensure correct ordering
  parsedSteps.sort((a, b) => a.stepOrder - b.stepOrder)

  // DIAGNOSTIC: Log parsed step data to help debug media issues
  for (const ps of parsedSteps) {
    console.debug(`[SendingEngine] Parsed step ${ps.stepOrder}: content="${ps.content?.substring(0, 50)}...", mediaUrl=${ps.mediaUrl || 'null'}, mediatype=${ps.mediatype || 'null'}, variations=${ps.variations.length}`)
  }

  const contacts = campaign.contactList.contacts
  const chips = campaign.chips.map(cc => cc.chip).filter(c => c.evolutionInstance)

  // Build chip assignment list respecting contactLimit from CampaignChip
  // If a chip has contactLimit set (>0), it will be assigned exactly that many contacts.
  // If contactLimit is null/0, it gets an equal share of the remaining contacts.
  // When the total exceeds the number of contacts, we scale down proportionally,
  // and when there's a remainder from rounding, we prioritize chips with more
  // remaining daily capacity (and random tie-breaking).
  const chipLimits = new Map<string, number>() // chipId → max contacts
  let fixedTotal = 0 // total contacts already allocated by explicit limits
  const chipsWithAutoLimit: string[] = [] // chips without explicit limit

  for (const cc of campaign.chips) {
    const chipId = cc.chipId
    const limit = cc.contactLimit
    if (limit && limit > 0) {
      chipLimits.set(chipId, limit)
      fixedTotal += limit
    } else {
      chipsWithAutoLimit.push(chipId)
    }
  }

  // If fixedTotal exceeds total contacts, scale down proportionally
  if (fixedTotal > contacts.length && fixedTotal > 0) {
    const scaleFactor = contacts.length / fixedTotal
    let distributed = 0
    // Sort chip IDs with explicit limits: chips with more remaining capacity get priority
    const sortedChipIdsWithLimits = [...chipLimits.keys()].sort((a, b) => {
      const chipA = chips.find(c => c.id === a)
      const chipB = chips.find(c => c.id === b)
      const capA = chipA ? (chipA.dailyLimit || 200) - (chipA.sentToday || 0) : 0
      const capB = chipB ? (chipB.dailyLimit || 200) - (chipB.sentToday || 0) : 0
      if (capA !== capB) return capB - capA // higher capacity first
      return Math.random() > 0.5 ? 1 : -1 // random tie-breaker
    })
    for (const chipId of sortedChipIdsWithLimits) {
      const scaledLimit = Math.floor((chipLimits.get(chipId) || 0) * scaleFactor)
      chipLimits.set(chipId, scaledLimit)
      distributed += scaledLimit
    }
    // Distribute remaining contacts (from rounding) to chips with most capacity
    const remainder = contacts.length - distributed
    for (let i = 0; i < remainder; i++) {
      const chipId = sortedChipIdsWithLimits[i % sortedChipIdsWithLimits.length]
      chipLimits.set(chipId, (chipLimits.get(chipId) || 0) + 1)
    }
    fixedTotal = contacts.length
  }

  // For auto chips: distribute remaining contacts equally
  const remainingContacts = Math.max(0, contacts.length - fixedTotal)
  if (chipsWithAutoLimit.length > 0 && remainingContacts > 0) {
    const basePerChip = Math.floor(remainingContacts / chipsWithAutoLimit.length)
    let extra = remainingContacts - basePerChip * chipsWithAutoLimit.length
    // Sort auto chips by remaining capacity (higher capacity gets extra contacts)
    const sortedAutoChips = [...chipsWithAutoLimit].sort((a, b) => {
      const chipA = chips.find(c => c.id === a)
      const chipB = chips.find(c => c.id === b)
      const capA = chipA ? (chipA.dailyLimit || 200) - (chipA.sentToday || 0) : 0
      const capB = chipB ? (chipB.dailyLimit || 200) - (chipB.sentToday || 0) : 0
      if (capA !== capB) return capB - capA
      return Math.random() > 0.5 ? 1 : -1
    })
    for (const chipId of sortedAutoChips) {
      const limit = basePerChip + (extra > 0 ? 1 : 0)
      chipLimits.set(chipId, limit)
      if (extra > 0) extra--
    }
  }

  // Build assignment plan: list of { chipId, count } in order
  const assignmentPlan: { chipId: string; count: number }[] = []
  // First: chips with explicit limits (in the order they appear in campaign.chips)
  for (const cc of campaign.chips) {
    const chip = cc.chip
    if (!chip.evolutionInstance) continue // skip disconnected
    const limit = chipLimits.get(chip.id) || 0
    if (limit > 0) {
      assignmentPlan.push({ chipId: chip.id, count: limit })
    }
  }

  // Build a contact-to-chip mapping based on assignment plan
  const contactChipAssignments: string[] = [] // index = contact index, value = chipId
  let contactIdx = 0
  for (const plan of assignmentPlan) {
    const assignCount = Math.min(plan.count, contacts.length - contactIdx)
    for (let j = 0; j < assignCount; j++) {
      contactChipAssignments.push(plan.chipId)
      contactIdx++
    }
  }
  // If there are remaining contacts (due to rounding), assign to chips with most capacity
  if (contactIdx < contacts.length) {
    const chipsByCapacity = [...chips].sort((a, b) => {
      const capA = (a.dailyLimit || 200) - (a.sentToday || 0)
      const capB = (b.dailyLimit || 200) - (b.sentToday || 0)
      if (capA !== capB) return capB - capA
      return Math.random() > 0.5 ? 1 : -1
    })
    while (contactIdx < contacts.length) {
      contactChipAssignments.push(chipsByCapacity[contactIdx % chipsByCapacity.length].id)
      contactIdx++
    }
  }

  console.log(`[SendingEngine] Campaign ${campaignId}: distribution plan = ${assignmentPlan.map(p => `${p.chipId.substring(0,8)}:${p.count}`).join(', ')}, total contacts = ${contacts.length}`)

  if (chips.length === 0) {
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', startedAt: null } })
    throw new Error('Nenhum chip com instância WhatsApp conectada')
  }
  if (contacts.length === 0) {
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', startedAt: null } })
    throw new Error('Lista de contatos vazia')
  }

  // ============================================================
  // FILTER OUT BLOCKED CONTACTS
  // Contacts who blocked the sender chip are auto-skipped.
  // This prevents wasting campaign quota and avoids ban risk
  // (sending to blocked contacts is a spam signal for Meta).
  // ============================================================
  const chipIds = chips.map(c => c.id)
  const blockedContacts = await db.blockedContact.findMany({
    where: {
      chipId: { in: chipIds },
      unblockedAt: null, // Only active blocks
    },
    select: { chipId: true, contactPhone: true, contactId: true },
  })

  // Create a Set of blocked phone numbers per chip for fast lookup
  const blockedPerChip = new Map<string, Set<string>>()
  for (const bc of blockedContacts) {
    if (!blockedPerChip.has(bc.chipId)) {
      blockedPerChip.set(bc.chipId, new Set())
    }
    blockedPerChip.get(bc.chipId)!.add(bc.contactPhone)
  }

  // Also create a global set of blocked contact IDs (for quick filtering)
  const blockedContactIds = new Set(
    blockedContacts.filter(bc => bc.contactId).map(bc => bc.contactId!)
  )

  // Filter contacts: remove those who are blocked on ANY campaign chip
  const filteredContacts = contacts.filter(contact => {
    // Check by contact ID first (fast path)
    if (blockedContactIds.has(contact.id)) return false
    // Check by phone number against each chip's block list
    for (const chipId of chipIds) {
      const blockedPhones = blockedPerChip.get(chipId)
      if (blockedPhones && blockedPhones.has(contact.phone)) return false
    }
    return true
  })

  const skippedCount = contacts.length - filteredContacts.length
  if (skippedCount > 0) {
    console.log(`[SendingEngine] Campaign ${campaignId}: filtered out ${skippedCount} blocked contacts (${filteredContacts.length} remaining)`)
  }

  // Create messages for ALL steps in the sequence
  // For multi-step: each contact gets one message per step, processed in order
  const messagesToCreate: { campaignId: string; chipId: string; contactId: string; content: string; status: "pending"; stepOrder: number; mediaUrl: string | null; mediatype: string | null }[] = []
  for (let i = 0; i < filteredContacts.length; i++) {
    const contact = filteredContacts[i]
    // Use contactLimit-based assignment if available, fall back to round-robin
    const assignedChipId = contactChipAssignments[i]
    const chip = assignedChipId
      ? chips.find(c => c.id === assignedChipId) || chips[i % chips.length]
      : chips[i % chips.length]

    for (const step of parsedSteps) {
      // Build the items pool for this step (main content + variations)
      const stepItems: { content: string; mediaUrl: string | null; mediatype: string | null }[] = []
      if (step.variations.length > 0) {
        for (const v of step.variations) {
          stepItems.push({
            content: v.content,
            mediaUrl: v.mediaUrl || step.mediaUrl || null,
            mediatype: v.mediatype || step.mediatype || null,
          })
        }
      } else {
        stepItems.push({
          content: step.content,
          mediaUrl: step.mediaUrl || null,
          mediatype: step.mediatype || null,
        })
      }

      // Pick a random variation for this contact
      const messageItem = stepItems[Math.floor(Math.random() * stepItems.length)]

      // Replace template variables — resolve KEY blocks first, then contact variables, then message key markers
      // Step 1: Resolve inline {{KEY: var1 | var2 | var3}} blocks (random variation per contact)
      let content = resolveKeyBlocks(messageItem.content)

      // Step 2: Replace contact variables from customFields
      let customData: Record<string, string> = {}
      try {
        if (contact.customFields) {
          customData = JSON.parse(contact.customFields)
        }
      } catch { /* ignore invalid JSON */ }

      const allFields: Record<string, string> = {
        nome: contact.name,
        telefone: contact.phone,
        ...customData,
      }

      // Resolve all {{variable}} patterns
      content = content.replace(/\{\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}\}/g, (match, varName) => {
        const key = varName.toLowerCase()
        if (allFields[key] !== undefined) {
          return allFields[key]
        }
        return match
      })

      // Legacy single-brace format
      content = content.replace(/\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}/g, (match, varName) => {
        const key = varName.toLowerCase()
        if (allFields[key] !== undefined) {
          return allFields[key]
        }
        return match
      })

      // Step 3: Resolve old-style {{KEY_NAME}} markers
      content = await resolveMessageKeyMarkers(content)

      console.debug(`[SendingEngine] Creating message for campaign ${campaignId}, contact ${contact.id}, step ${step.stepOrder}: content="${content.substring(0, 50)}...", mediaUrl=${messageItem.mediaUrl || 'null'}, mediatype=${messageItem.mediatype || 'null'}`)

      messagesToCreate.push({
        campaignId: campaign.id,
        chipId: chip.id,
        contactId: contact.id,
        content,
        status: 'pending' as const,
        stepOrder: step.stepOrder,
        mediaUrl: messageItem.mediaUrl || null,
        mediatype: messageItem.mediatype || null,
      })
    }
  }

  // Create messages with skipDuplicates — if the unique constraint (campaignId, contactId, stepOrder)
  // is violated, skip that record instead of failing. This is the FINAL safety net against duplicates.
  const createResult = await db.message.createMany({
    data: messagesToCreate,
    skipDuplicates: true,
  })

  console.debug(`[SendingEngine] Created ${createResult.count} messages for campaign ${campaignId} (requested ${messagesToCreate.length})`)

  // ============================================================
  // PHASE 3: NOW set campaign to 'running' — AFTER messages exist
  // This is the critical ordering: the processing loop will only
  // pick up 'running' campaigns, and by now messages are guaranteed
  // to exist, so processNextMessage won't prematurely complete it.
  // ============================================================
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: 'running', startedAt: new Date(), nextSendAt: null },
  })

  console.debug(`[SendingEngine] Campaign ${campaignId} is now RUNNING with ${createResult.count} messages`)

  return { messageCount: createResult.count }
}
