// Evolution API v2 (Baileys/Node.js) Service Layer
// Handles communication with the legacy Evolution API v2 server.
// Credentials are stored in the database (Settings table) with env var fallback.

import { db } from './db'

// ============ Credential Management ============

interface EvolutionV2Credentials {
  apiUrl: string
  apiKey: string
}

let cachedV2Credentials: EvolutionV2Credentials | null = null
let v2CacheTimestamp = 0
const V2_CACHE_TTL_MS = 60_000

async function getV2Credentials(): Promise<EvolutionV2Credentials> {
  const now = Date.now()
  if (cachedV2Credentials && (now - v2CacheTimestamp) < V2_CACHE_TTL_MS) {
    return cachedV2Credentials
  }

  try {
    const settings = await db.settings.findMany({
      where: {
        key: { in: ['evolution_v2_api_url', 'evolution_v2_api_key'] }
      }
    })
    const settingsMap = new Map(settings.map(s => [s.key, s.value]))
    const apiUrl = settingsMap.get('evolution_v2_api_url') || process.env.EVOLUTION_V2_API_URL || ''
    const apiKey = settingsMap.get('evolution_v2_api_key') || process.env.EVOLUTION_V2_API_KEY || ''

    if (apiUrl && apiKey) {
      cachedV2Credentials = { apiUrl, apiKey }
      v2CacheTimestamp = now
      return cachedV2Credentials
    }
  } catch {
    // DB not available, fall through to env vars
  }

  const creds = {
    apiUrl: process.env.EVOLUTION_V2_API_URL || '',
    apiKey: process.env.EVOLUTION_V2_API_KEY || '',
  }

  if (creds.apiUrl && creds.apiKey) {
    cachedV2Credentials = creds
    v2CacheTimestamp = now
  }

  return creds
}

export function clearV2CredentialsCache(): void {
  cachedV2Credentials = null
  v2CacheTimestamp = 0
}

// ============ Core API Client ============

async function v2Fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const creds = await getV2Credentials()

  if (!creds.apiUrl || !creds.apiKey) {
    throw new Error('Evolution v2 API não configurada. Defina a URL e API Key nas configurações.')
  }

  const url = `${creds.apiUrl}${endpoint}`

  // Use AbortController with a 15s timeout to avoid hanging when the API server is down
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'apikey': creds.apiKey,
        ...(options.headers as Record<string, string> || {}),
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Evolution v2 API error (${response.status}): ${error}`)
    }

    return response
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Evolution v2 API não respondeu (timeout de 15s). O servidor pode estar offline.`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============ Instance Types ============

export interface V2Instance {
  id: string
  name: string
  connectionStatus: 'open' | 'close' | 'connecting'
  ownerJid: string | null
  profileName: string | null
  profilePicUrl: string | null
  integration: string
  token: string
  number: string | null
  disconnectionReasonCode: number | null
  disconnectionAt: string | null
  createdAt: string
  updatedAt: string
}

// ============ Instance Management ============

/**
 * Fetch all instances from Evolution v2.
 * GET /instance/fetchInstances
 */
export async function fetchV2Instances(): Promise<V2Instance[]> {
  const response = await v2Fetch('/instance/fetchInstances')
  const data = await response.json()
  return Array.isArray(data) ? data : (data.data || [])
}

/**
 * Fetch instances that belong to OctupusZap (MTech_ prefix or linked in DB).
 * In v2, instances don't have the OctupusZap_ prefix — they use names like "MTech_Bibi".
 * We fetch all instances and the caller filters as needed.
 */
export async function fetchV2OctupusZapInstances(): Promise<V2Instance[]> {
  // Return all v2 instances — the chips route will match them by DB
  return fetchV2Instances()
}

/**
 * Create a new instance in Evolution v2.
 * POST /instance/create with { instanceName, integration, qrcode, token }
 */
export async function createV2Instance(
  instanceName: string,
): Promise<V2Instance> {
  const response = await v2Fetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      token: `oz_v2_${instanceName}_${Date.now()}`,
    }),
  })
  const data = await response.json()
  return data.instance || data
}

/**
 * Delete an instance from Evolution v2.
 * DELETE /instance/delete/{instanceName}
 */
export async function deleteV2Instance(instanceName: string): Promise<void> {
  await v2Fetch(`/instance/delete/${instanceName}`, {
    method: 'DELETE',
  })
}

// ============ Connection ============

export interface V2ConnectResult {
  qrcode?: { code: string; base64: string } | null
  code?: string | null
  pairingCode?: string | null
  state?: 'open' | 'close' | 'connecting'
  instanceName?: string
}

/**
 * Connect to an instance in v2.
 * POST /instance/connect/{instanceName}
 * Returns QR code in the response body (unlike v3 which sends it via webhook).
 */
export async function connectV2Instance(
  instanceName: string,
): Promise<V2ConnectResult> {
  try {
    const response = await v2Fetch(`/instance/connect/${instanceName}`, {
      method: 'POST',
    })
    const data = await response.json()

    // v2 returns QR code directly in the response
    const code = data.code || data.pairingCode || null
    const qrcode = data.qrcode || (data.base64 ? { code: data.code || '', base64: data.base64 } : null)

    return {
      qrcode,
      code,
      pairingCode: code,
      state: data.state || (data.status === 'CONNECTED' ? 'open' : 'close'),
      instanceName,
    }
  } catch (error: any) {
    // If instance doesn't exist, try creating it first
    if (error.message?.includes('not found') || error.message?.includes('404')) {
      await createV2Instance(instanceName)
      // Retry connect after creating
      const retryResponse = await v2Fetch(`/instance/connect/${instanceName}`, {
        method: 'POST',
      })
      const retryData = await retryResponse.json()
      const code = retryData.code || retryData.pairingCode || null
      const qrcode = retryData.qrcode || (retryData.base64 ? { code: retryData.code || '', base64: retryData.base64 } : null)
      return {
        qrcode,
        code,
        pairingCode: code,
        state: retryData.state || 'close',
        instanceName,
      }
    }
    throw error
  }
}

/**
 * Get QR code for an instance.
 * GET /instance/qr/{instanceName}
 */
export async function getV2QRCode(instanceName: string): Promise<V2ConnectResult> {
  try {
    const response = await v2Fetch(`/instance/qr/${instanceName}`, {})
    const data = await response.json()

    const code = data.code || data.pairingCode || null
    const qrcode = data.qrcode || (data.base64 ? { code: data.code || '', base64: data.base64 } : null)

    return {
      qrcode,
      code,
      pairingCode: code,
      state: 'close',
      instanceName,
    }
  } catch {
    return {
      qrcode: null,
      code: null,
      pairingCode: null,
      state: 'close',
      instanceName,
    }
  }
}

/**
 * Disconnect an instance in v2.
 * POST /instance/disconnect/{instanceName}
 */
export async function disconnectV2Instance(instanceName: string): Promise<void> {
  await v2Fetch(`/instance/disconnect/${instanceName}`, {
    method: 'POST',
  })
}

/**
 * Get connection state of an instance in v2.
 * GET /instance/connectionState/{instanceName}
 */
export async function getV2ConnectionState(instanceName: string): Promise<{
  state: 'open' | 'close' | 'connecting'
  instanceName: string
}> {
  try {
    const response = await v2Fetch(`/instance/connectionState/${instanceName}`)
    const data = await response.json()
    const state = data.instance?.state || data.state || 'close'
    return {
      state,
      instanceName,
    }
  } catch {
    return { state: 'close', instanceName }
  }
}

// ============ Messaging ============

/**
 * Send a text message via v2.
 * POST /message/sendText/{instanceName} with { number, text, delay }
 */
export async function sendV2TextMessage(
  instanceName: string,
  number: string,
  text: string,
  options?: { delay?: number; linkPreview?: boolean }
): Promise<{ key?: { remoteJid: string; fromMe: boolean; id: string }; message?: any; status?: string }> {
  const response = await v2Fetch(`/message/sendText/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      text,
      delay: options?.delay || 0,
      linkPreview: options?.linkPreview ?? false,
    }),
  })
  const data = await response.json()
  return {
    key: data.key || { remoteJid: '', fromMe: true, id: data.messageId || '' },
    message: data.message,
    status: data.status || 'sent',
  }
}

/**
 * Send a media message via v2.
 * POST /message/sendMedia/{instanceName}
 */
export async function sendV2MediaMessage(
  instanceName: string,
  number: string,
  media: string,
  mediatype: 'image' | 'document' | 'video' | 'audio',
  options?: { caption?: string; fileName?: string; delay?: number }
): Promise<{ key?: { remoteJid: string; fromMe: boolean; id: string }; message?: any; status?: string }> {
  const response = await v2Fetch(`/message/sendMedia/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      media: { type: mediatype, media },
      caption: options?.caption || '',
      fileName: options?.fileName || '',
      delay: options?.delay || 0,
    }),
  })
  const data = await response.json()
  return {
    key: data.key || { remoteJid: '', fromMe: true, id: data.messageId || '' },
    message: data.message,
    status: data.status || 'sent',
  }
}

/**
 * Set presence (typing simulation) via v2.
 * POST /chat/presence/{instanceName}
 */
export async function setV2Presence(
  instanceName: string,
  number: string,
  presence: 'composing' | 'available' | 'unavailable' | 'recording',
  delay: number = 2000
): Promise<void> {
  try {
    await v2Fetch(`/chat/presence/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        number,
        presence,
        delay,
      }),
    })
  } catch {
    // Best-effort — presence is not critical
  }
}

// ============ Webhook ============

/**
 * Set webhook for an instance in v2.
 * POST /webhook/set/{instanceName}
 */
export async function setV2Webhook(
  instanceName: string,
  webhookUrl: string,
  events: string[] = ['APPLICATION_STARTUP', 'QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'MESSAGE_READ']
): Promise<void> {
  try {
    await v2Fetch(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        webhookByEvents: true,
        events,
      }),
    })
  } catch (err) {
    console.error('[V2 Webhook] Failed to set webhook:', err)
  }
}

// ============ Number Verification ============

/**
 * Check if phone numbers exist on WhatsApp via v2.
 * POST /chat/whatsappNumbers/{instanceName}
 */
export async function checkV2WhatsAppNumbers(
  instanceName: string,
  numbers: string[]
): Promise<Array<{ query: string; exists: boolean; jid: string }>> {
  try {
    const response = await v2Fetch(`/chat/whatsappNumbers/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ numbers }),
    })
    const data = await response.json()
    if (Array.isArray(data)) {
      return data.map((u: any) => ({
        query: u.query || '',
        exists: u.exists || false,
        jid: u.jid || '',
      }))
    }
    return []
  } catch {
    return []
  }
}

// ============ Test Connection ============

export async function testV2Connection(): Promise<{ success: boolean; error?: string; instanceCount?: number }> {
  try {
    const creds = await getV2Credentials()
    if (!creds.apiUrl || !creds.apiKey) {
      return { success: false, error: 'URL ou API Key v2 não configurados' }
    }
    const instances = await fetchV2Instances()
    return { success: true, instanceCount: instances.length }
  } catch (error: any) {
    return { success: false, error: error.message || 'Erro ao conectar v2' }
  }
}
