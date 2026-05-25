// Evolution API Router — Unified interface that directs API calls
// to either v2 (Baileys) or v3 (Go) based on the chip's evolutionApiVersion.
//
// Usage: All API routes should call this router instead of directly
// calling evolution-api.ts or evolution-api-v2.ts.

import { db } from './db'
import * as v3 from './evolution-api'
import * as v2 from './evolution-api-v2'

// ============ Re-exports from v3 (for backward compatibility) ============
// These are v3-specific helpers that routes import from the router
// for convenience. They always route to v3 behavior.

export const getInstanceName = v3.getInstanceName
export const INSTANCE_PREFIX = v3.INSTANCE_PREFIX
export const isOctupusZapInstance = v3.isOctupusZapInstance
export const toEvolutionGoProxy = v3.toEvolutionGoProxy
export const resolveChipProxy = v3.resolveChipProxy
export const getGlobalProxy = v3.getGlobalProxy
export const findInstanceByName = v3.findInstanceByName
export const formatPhoneNumber = v3.formatPhoneNumber

// ============ Types ============

export type ApiVersion = 'v2' | 'v3'

export interface UnifiedInstance {
  name: string
  id: string
  connected: boolean
  connectionStatus: 'open' | 'close' | 'connecting'
  ownerJid: string | null
  profileName: string | null
  profilePicUrl: string | null
  integration: string
  apiVersion: ApiVersion
  // v2 specific
  number?: string | null
  disconnectionReasonCode?: number | null
  disconnectionAt?: string | null
}

export interface UnifiedConnectResult {
  qrcode: string | null          // base64 QR code image (data URI)
  code: string | null            // pairing code
  pairingCode: string | null
  state: 'open' | 'close' | 'connecting'
  instanceName: string
  instanceId?: string
  apiVersion: ApiVersion
}

// ============ Version Resolution ============

/**
 * Get the API version for a chip.
 * Defaults to v3 if not set.
 */
export function getApiVersion(chip: { evolutionApiVersion?: string }): ApiVersion {
  return chip.evolutionApiVersion === 'v2' ? 'v2' : 'v3'
}

/**
 * Determine API version from instance name.
 * OctupusZap_ prefix = v3 (new convention).
 * No prefix = could be v2 (legacy) or v3 without prefix.
 * Best effort — prefer DB record over name heuristics.
 */
export function inferApiVersionFromName(instanceName: string): ApiVersion {
  if (instanceName.startsWith('OctupusZap_')) return 'v3'
  // Could be v2 or v3 — default to v3
  return 'v3'
}

// ============ Fetch Instances ============

/**
 * Fetch all instances from both v2 and v3 APIs.
 * Returns a unified list.
 */
export async function fetchAllInstances(): Promise<UnifiedInstance[]> {
  const results: UnifiedInstance[] = []

  // Fetch v3 instances
  try {
    const v3Instances = await v3.fetchInstances()
    for (const inst of v3Instances) {
      results.push({
        name: inst.name,
        id: inst.id,
        connected: inst.connected || false,
        connectionStatus: inst.connected ? 'open' : (inst.connectionStatus || 'close'),
        ownerJid: inst.jid || inst.ownerJid || null,
        profileName: inst.profileName || null,
        profilePicUrl: inst.profilePicUrl || null,
        integration: inst.integration || 'WHATSAPP-GO',
        apiVersion: 'v3',
      })
    }
  } catch (err) {
    console.error('[Router] Failed to fetch v3 instances:', err)
  }

  // Fetch v2 instances
  try {
    const v2Instances = await v2.fetchV2Instances()
    for (const inst of v2Instances) {
      results.push({
        name: inst.name,
        id: inst.id,
        connected: inst.connectionStatus === 'open',
        connectionStatus: inst.connectionStatus || 'close',
        ownerJid: inst.ownerJid || null,
        profileName: inst.profileName || null,
        profilePicUrl: inst.profilePicUrl || null,
        integration: inst.integration || 'WHATSAPP-BAILEYS',
        apiVersion: 'v2',
        number: inst.number || null,
        disconnectionReasonCode: inst.disconnectionReasonCode || null,
        disconnectionAt: inst.disconnectionAt || null,
      })
    }
  } catch (err) {
    console.error('[Router] Failed to fetch v2 instances:', err)
  }

  return results
}

/**
 * Build a status map from all instances (both APIs).
 * Maps instance name → { status, profileName, profilePicUrl, ownerJid, apiVersion }
 */
export async function getAllInstancesStatusMap(): Promise<Map<string, {
  status: string;
  profileName: string | null;
  profilePicUrl: string | null;
  ownerJid: string | null;
  apiVersion: ApiVersion;
}>> {
  const instances = await fetchAllInstances()
  const map = new Map()

  for (const inst of instances) {
    map.set(inst.name, {
      status: inst.connectionStatus || (inst.connected ? 'open' : 'close'),
      profileName: inst.profileName,
      profilePicUrl: inst.profilePicUrl,
      ownerJid: inst.ownerJid,
      apiVersion: inst.apiVersion,
    })
  }

  return map
}

// ============ Instance Operations ============

/**
 * Create an instance on the correct API version.
 */
export async function createInstance(
  instanceName: string,
  apiVersion: ApiVersion,
  proxyConfig?: { address: string; port: string; username: string; password: string }
): Promise<UnifiedInstance> {
  if (apiVersion === 'v2') {
    const inst = await v2.createV2Instance(instanceName)
    return {
      name: inst.name,
      id: inst.id,
      connected: false,
      connectionStatus: 'close',
      ownerJid: null,
      profileName: null,
      profilePicUrl: null,
      integration: 'WHATSAPP-BAILEYS',
      apiVersion: 'v2',
    }
  } else {
    const inst = await v3.createInstance(instanceName, proxyConfig)
    return {
      name: inst.name,
      id: inst.id,
      connected: inst.connected || false,
      connectionStatus: inst.connected ? 'open' : 'close',
      ownerJid: inst.jid || inst.ownerJid || null,
      profileName: inst.profileName || null,
      profilePicUrl: inst.profilePicUrl || null,
      integration: 'WHATSAPP-GO',
      apiVersion: 'v3',
    }
  }
}

/**
 * Delete an instance from the correct API.
 */
export async function deleteInstance(
  instanceName: string,
  apiVersion: ApiVersion,
): Promise<void> {
  if (apiVersion === 'v2') {
    await v2.deleteV2Instance(instanceName)
  } else {
    await v3.deleteInstance(instanceName)
  }
}

/**
 * Connect an instance and return QR code.
 */
export async function connectInstance(
  instanceName: string,
  apiVersion: ApiVersion,
  webhookUrl?: string,
): Promise<UnifiedConnectResult> {
  if (apiVersion === 'v2') {
    // Set webhook first if provided
    if (webhookUrl) {
      await v2.setV2Webhook(instanceName, webhookUrl)
    }
    const result = await v2.connectV2Instance(instanceName)

    // Normalize QR code format from v2
    let qrcode: string | null | undefined = null
    if (result.qrcode?.base64) {
      qrcode = result.qrcode.base64.startsWith('data:')
        ? result.qrcode.base64
        : `data:image/png;base64,${result.qrcode.base64}`
    }

    return {
      qrcode: qrcode ?? null,
      code: result.code || result.pairingCode || null,
      pairingCode: result.pairingCode || result.code || null,
      state: (result.state || 'close') as 'open' | 'close' | 'connecting',
      instanceName,
      apiVersion: 'v2',
    }
  } else {
    const result = await v3.connectInstance(instanceName, webhookUrl)

    // If not connected yet, try to fetch QR code
    let qrcode = result.qrcode
    if (!qrcode && result.state !== 'open') {
      try {
        const qrResult = await v3.getInstanceQRCode(instanceName)
        qrcode = qrResult.qrcode
        if (qrResult.code && !result.code) {
          result.code = qrResult.code
        }
      } catch {
        // QR not available yet
      }
    }

    return {
      qrcode: qrcode ?? null,
      code: result.code || null,
      pairingCode: result.pairingCode || result.code || null,
      state: (result.state || 'close') as 'open' | 'close' | 'connecting',
      instanceName,
      instanceId: result.instanceId,
      apiVersion: 'v3',
    }
  }
}

/**
 * Get QR code for an instance.
 */
export async function getInstanceQRCode(
  instanceName: string,
  apiVersion: ApiVersion,
): Promise<UnifiedConnectResult> {
  if (apiVersion === 'v2') {
    const result = await v2.getV2QRCode(instanceName)
    let qrcode: string | null | undefined = null
    if (result.qrcode?.base64) {
      qrcode = result.qrcode.base64.startsWith('data:')
        ? result.qrcode.base64
        : `data:image/png;base64,${result.qrcode.base64}`
    }
    return {
      qrcode: qrcode ?? null,
      code: result.code || null,
      pairingCode: result.pairingCode || null,
      state: (result.state || 'close') as 'open' | 'close' | 'connecting',
      instanceName,
      apiVersion: 'v2',
    }
  } else {
    const result = await v3.getInstanceQRCode(instanceName)
    return {
      qrcode: result.qrcode ?? null,
      code: result.code || null,
      pairingCode: result.pairingCode || null,
      state: (result.state || 'close') as 'open' | 'close' | 'connecting',
      instanceName,
      instanceId: result.instanceId,
      apiVersion: 'v3',
    }
  }
}

/**
 * Disconnect an instance.
 */
export async function disconnectInstance(
  instanceName: string,
  apiVersion: ApiVersion,
): Promise<void> {
  if (apiVersion === 'v2') {
    await v2.disconnectV2Instance(instanceName)
  } else {
    await v3.disconnectInstance(instanceName)
  }
}

/**
 * Get connection state.
 */
export async function getConnectionState(
  instanceName: string,
  apiVersion: ApiVersion,
): Promise<{ state: 'open' | 'close' | 'connecting'; instanceName: string }> {
  if (apiVersion === 'v2') {
    const v2result = await v2.getV2ConnectionState(instanceName)
    return { state: v2result.state as 'open' | 'close' | 'connecting', instanceName }
  } else {
    const result = await v3.getConnectionState(instanceName)
    return {
      state: (result.state || 'close') as 'open' | 'close' | 'connecting',
      instanceName,
    }
  }
}

// ============ Messaging ============

/**
 * Send a text message via the correct API.
 */
export async function sendTextMessage(
  instanceName: string,
  apiVersion: ApiVersion,
  number: string,
  text: string,
  options?: { delay?: number; linkPreview?: boolean }
): Promise<{ key?: { remoteJid: string; fromMe: boolean; id: string }; message?: any; status?: string }> {
  if (apiVersion === 'v2') {
    return v2.sendV2TextMessage(instanceName, number, text, options)
  } else {
    return v3.sendTextMessage(instanceName, number, text, options)
  }
}

/**
 * Send a media message via the correct API.
 */
export async function sendMediaMessage(
  instanceName: string,
  apiVersion: ApiVersion,
  number: string,
  media: string,
  mediatype: 'image' | 'document' | 'video' | 'audio',
  options?: { caption?: string; fileName?: string; delay?: number }
): Promise<{ key?: { remoteJid: string; fromMe: boolean; id: string }; message?: any; status?: string }> {
  if (apiVersion === 'v2') {
    return v2.sendV2MediaMessage(instanceName, number, media, mediatype, options)
  } else {
    return v3.sendMediaMessage(instanceName, number, media, mediatype, options)
  }
}

/**
 * Set presence (typing simulation).
 */
export async function setPresence(
  instanceName: string,
  apiVersion: ApiVersion,
  number: string,
  presence: 'composing' | 'available' | 'unavailable' | 'recording',
  delay: number = 2000
): Promise<void> {
  if (apiVersion === 'v2') {
    await v2.setV2Presence(instanceName, number, presence, delay)
  } else {
    await v3.setPresence(instanceName, number, presence, delay)
  }
}

// ============ Webhook ============

/**
 * Set webhook for an instance.
 */
export async function setWebhook(
  instanceName: string,
  apiVersion: ApiVersion,
  webhookUrl: string,
): Promise<void> {
  if (apiVersion === 'v2') {
    await v2.setV2Webhook(instanceName, webhookUrl)
  } else {
    await v3.setWebhook(instanceName, webhookUrl)
  }
}

// ============ Test Connection ============

/**
 * Test connection to both APIs.
 */
export async function testAllConnections(): Promise<{
  v2: { success: boolean; error?: string; instanceCount?: number }
  v3: { success: boolean; error?: string; instanceCount?: number }
}> {
  const [v2Result, v3Result] = await Promise.allSettled([
    v2.testV2Connection(),
    v3.testConnection(),
  ])

  return {
    v2: v2Result.status === 'fulfilled' ? v2Result.value : { success: false, error: v2Result.reason?.message },
    v3: v3Result.status === 'fulfilled' ? v3Result.value : { success: false, error: v3Result.reason?.message },
  }
}
