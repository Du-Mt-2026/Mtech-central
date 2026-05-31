// Evolution API Router — v3-only (Evolution Go / whatsmeow)
// All v2 (Baileys) support has been removed.

import * as v3 from './evolution-api'

// ============ Re-exports from v3 ============

export const getInstanceName = v3.getInstanceName
export const INSTANCE_PREFIX = v3.INSTANCE_PREFIX
export const isOctupusZapInstance = v3.isOctupusZapInstance
export const toEvolutionGoProxy = v3.toEvolutionGoProxy
export const resolveChipProxy = v3.resolveChipProxy
export const getGlobalProxy = v3.getGlobalProxy
export const findInstanceByName = v3.findInstanceByName
export const formatPhoneNumber = v3.formatPhoneNumber

// ============ Types ============

export interface UnifiedInstance {
  name: string
  id: string
  connected: boolean
  connectionStatus: 'open' | 'close' | 'connecting'
  ownerJid: string | null
  profileName: string | null
  profilePicUrl: string | null
  integration: string
}

export interface UnifiedConnectResult {
  qrcode: string | null
  code: string | null
  pairingCode: string | null
  state: 'open' | 'close' | 'connecting'
  instanceName: string
  instanceId?: string
}

// ============ Fetch Instances ============

/**
 * Fetch all instances from Evolution Go API.
 */
export async function fetchAllInstances(): Promise<UnifiedInstance[]> {
  const instances = await v3.fetchInstances()
  return instances.map(inst => ({
    name: inst.name,
    id: inst.id,
    connected: inst.connected || false,
    connectionStatus: inst.connected ? 'open' : (inst.connectionStatus || 'close'),
    ownerJid: inst.jid || inst.ownerJid || null,
    profileName: inst.profileName || null,
    profilePicUrl: inst.profilePicUrl || null,
    integration: inst.integration || 'WHATSAPP-GO',
  }))
}

/**
 * Build a status map from all instances.
 */
export async function getAllInstancesStatusMap(): Promise<Map<string, {
  status: string;
  profileName: string | null;
  profilePicUrl: string | null;
  ownerJid: string | null;
}>> {
  const instances = await fetchAllInstances()
  const map = new Map()
  for (const inst of instances) {
    map.set(inst.name, {
      status: inst.connectionStatus || (inst.connected ? 'open' : 'close'),
      profileName: inst.profileName,
      profilePicUrl: inst.profilePicUrl,
      ownerJid: inst.ownerJid,
    })
  }
  return map
}

// ============ Instance Operations ============

export async function createInstance(
  instanceName: string,
  proxyConfig?: { host: string; port: string; username: string; password: string; protocol?: string }
): Promise<UnifiedInstance> {
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
  }
}

export async function deleteInstance(
  instanceName: string,
): Promise<void> {
  await v3.deleteInstance(instanceName)
}

export async function connectInstance(
  instanceName: string,
  webhookUrl?: string,
): Promise<UnifiedConnectResult> {
  const result = await v3.connectInstance(instanceName, webhookUrl)

  // CRITICAL FIX: Do NOT fetch QR code here!
  //
  // Previously this function called v3.getInstanceQRCode() IMMEDIATELY after
  // v3.connectInstance() with NO delay. This caused a critical race condition:
  //
  // 1. POST /instance/connect starts a goroutine to connect to WhatsApp (Client #1)
  // 2. GET /instance/qr is called immediately — Evolution Go's GetQr sees client==nil
  //    (because the goroutine hasn't finished yet) and calls StartInstance(),
  //    starting a SECOND WhatsApp client (Client #2)
  // 3. Client #2 generates a QR code, but Client #1 is also running
  // 4. The two clients conflict, causing the session to become unstable
  // 5. After scanning the QR code (from Client #2), the session goes into
  //    a "Reconnecting" loop because Client #1 keeps interfering
  //
  // The QR code fetch MUST be done by the calling code (connect/route.ts)
  // with a proper delay (4+ seconds) to give Evolution Go time to start
  // the client goroutine before requesting the QR code.
  //
  // This was the root cause of: "QR codes from OctupusZap don't work for
  // connection, but QR codes from the Evolution API dashboard do work."

  return {
    qrcode: result.qrcode ?? null,
    code: result.code || null,
    pairingCode: result.pairingCode || result.code || null,
    state: (result.state || 'close') as 'open' | 'close' | 'connecting',
    instanceName,
    instanceId: result.instanceId,
  }
}

export async function getInstanceQRCode(
  instanceName: string,
): Promise<UnifiedConnectResult> {
  const result = await v3.getInstanceQRCode(instanceName)
  return {
    qrcode: result.qrcode ?? null,
    code: result.code || null,
    pairingCode: result.pairingCode || null,
    state: (result.state || 'close') as 'open' | 'close' | 'connecting',
    instanceName,
    instanceId: result.instanceId,
  }
}

export async function disconnectInstance(
  instanceName: string,
): Promise<void> {
  await v3.disconnectInstance(instanceName)
}

export async function getConnectionState(
  instanceName: string,
): Promise<{ state: 'open' | 'close' | 'connecting'; instanceName: string }> {
  const result = await v3.getConnectionState(instanceName)
  return {
    state: (result.state || 'close') as 'open' | 'close' | 'connecting',
    instanceName,
  }
}

// ============ Messaging ============

export async function sendTextMessage(
  instanceName: string,
  number: string,
  text: string,
  options?: { delay?: number; linkPreview?: boolean }
): Promise<{ key?: { remoteJid: string; fromMe: boolean; id: string }; message?: any; status?: string }> {
  return v3.sendTextMessage(instanceName, number, text, options)
}

export async function sendMediaMessage(
  instanceName: string,
  number: string,
  media: string,
  mediatype: 'image' | 'document' | 'video' | 'audio',
  options?: { caption?: string; fileName?: string; delay?: number }
): Promise<{ key?: { remoteJid: string; fromMe: boolean; id: string }; message?: any; status?: string }> {
  return v3.sendMediaMessage(instanceName, number, media, mediatype, options)
}

export async function setPresence(
  instanceName: string,
  number: string,
  presence: 'composing' | 'available' | 'unavailable' | 'recording',
  delay: number = 2000
): Promise<void> {
  await v3.setPresence(instanceName, number, presence, delay)
}

// ============ Webhook ============

export async function setWebhook(
  instanceName: string,
  webhookUrl: string,
): Promise<void> {
  await v3.setWebhook(instanceName, webhookUrl)
}

// ============ Number Verification ============

/**
 * Check if phone numbers exist on WhatsApp.
 * Uses Evolution Go v3 endpoint: POST /user/check with { number: [...] }
 */
export async function checkWhatsAppNumbers(
  instanceName: string,
  numbers: string[]
): Promise<Array<{ query: string; exists: boolean; jid: string }>> {
  return v3.checkWhatsAppNumbers(instanceName, numbers)
}

// ============ Test Connection ============

export async function testAllConnections(): Promise<{
  success: boolean;
  error?: string;
  instanceCount?: number
}> {
  return v3.testConnection()
}
