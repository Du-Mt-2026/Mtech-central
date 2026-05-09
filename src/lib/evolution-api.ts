// Evolution API Service Layer
// Handles all communication with the Evolution API (WhatsApp Baileys)
// Credentials are stored in the database (Settings table) with env var fallback

import { db } from './db'

// Prefix for all OctupusZap instances — only instances with this prefix are managed by the site
export const INSTANCE_PREFIX = 'OctupusZap_';

// ============ Credential Management (DB-first with env var fallback) ============

interface EvolutionCredentials {
  apiUrl: string
  apiKey: string
}

// In-memory cache with TTL to avoid hitting DB on every API call
let cachedCredentials: EvolutionCredentials | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000 // 60 seconds

/**
 * Get Evolution API credentials from DB Settings table.
 * Falls back to environment variables if not found in DB.
 * Uses in-memory cache with 60s TTL to avoid excessive DB queries.
 */
async function getCredentials(): Promise<EvolutionCredentials> {
  const now = Date.now()
  if (cachedCredentials && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedCredentials
  }

  try {
    const settings = await db.settings.findMany({
      where: {
        key: { in: ['evolution_api_url', 'evolution_api_key'] }
      }
    })

    const settingsMap = new Map(settings.map(s => [s.key, s.value]))
    const apiUrl = settingsMap.get('evolution_api_url') || process.env.EVOLUTION_API_URL || ''
    const apiKey = settingsMap.get('evolution_api_key') || process.env.EVOLUTION_API_KEY || ''

    if (apiUrl && apiKey) {
      cachedCredentials = { apiUrl, apiKey }
      cacheTimestamp = now
      return cachedCredentials
    }
  } catch {
    // DB not available yet, fall through to env vars
  }

  // Fallback to environment variables
  const creds = {
    apiUrl: process.env.EVOLUTION_API_URL || '',
    apiKey: process.env.EVOLUTION_API_KEY || '',
  }

  if (creds.apiUrl && creds.apiKey) {
    cachedCredentials = creds
    cacheTimestamp = now
  }

  return creds
}

/**
 * Clear the credentials cache — call after saving new settings
 */
export function clearCredentialsCache(): void {
  cachedCredentials = null
  cacheTimestamp = 0
}

/**
 * Test Evolution API connection — returns true if credentials are valid
 */
export async function testConnection(): Promise<{ success: boolean; error?: string; instanceCount?: number }> {
  try {
    const creds = await getCredentials()
    if (!creds.apiUrl || !creds.apiKey) {
      return { success: false, error: 'URL ou API Key não configurados' }
    }
    const response = await fetch(`${creds.apiUrl}/instance/fetchInstances`, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': creds.apiKey,
      },
    })
    if (!response.ok) {
      const text = await response.text()
      return { success: false, error: `API retornou ${response.status}: ${text.substring(0, 200)}` }
    }
    const instances = await response.json()
    return { success: true, instanceCount: Array.isArray(instances) ? instances.length : 0 }
  } catch (error: any) {
    return { success: false, error: error.message || 'Erro ao conectar' }
  }
}

// ============ Evolution API Types ============

interface EvolutionInstance {
  id: string;
  name: string;
  connectionStatus: 'open' | 'close' | 'connecting';
  ownerJid: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  integration: string;
  number: string | null;
  token: string;
  disconnectionReasonCode: number | null;
  disconnectionAt: string | null;
  createdAt: string;
  updatedAt: string;
  Proxy: {
    enabled: boolean;
    host: string;
    port: string;
    username: string;
    password: string;
  } | null;
}

interface QRCodeResponse {
  code: string;
  base64: string;
}

interface ConnectionState {
  instance: {
    instanceName: string;
    state: 'open' | 'close' | 'connecting';
  };
}

interface SendMessageResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  message: any;
  status: string;
}

// ============ Core API Client ============

async function evolutionFetch(endpoint: string, options: RequestInit = {}) {
  const creds = await getCredentials()
  const url = `${creds.apiUrl}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': creds.apiKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Evolution API error (${response.status}): ${error}`);
  }

  return response;
}

// ============ Instance Management ============

export async function createInstance(instanceName: string): Promise<EvolutionInstance> {
  const response = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
    }),
  });
  return response.json();
}

export async function fetchInstances(): Promise<EvolutionInstance[]> {
  const response = await evolutionFetch('/instance/fetchInstances');
  return response.json();
}

/**
 * Fetch only OctupusZap instances (filtered by INSTANCE_PREFIX).
 * Other instances on the same Evolution API server are ignored.
 */
export async function fetchOctupusZapInstances(): Promise<EvolutionInstance[]> {
  const all = await fetchInstances();
  return all.filter(inst => inst.name.startsWith(INSTANCE_PREFIX));
}

export async function deleteInstance(instanceName: string): Promise<void> {
  await evolutionFetch(`/instance/delete/${instanceName}`, {
    method: 'DELETE',
  });
}

// ============ Connection ============

export async function connectInstance(instanceName: string): Promise<{ qrcode?: QRCodeResponse; base64?: string; code?: string }> {
  const response = await evolutionFetch(`/instance/connect/${instanceName}`, {
    method: 'POST',
  });
  return response.json();
}

export async function disconnectInstance(instanceName: string): Promise<void> {
  await evolutionFetch(`/instance/disconnect/${instanceName}`, {
    method: 'POST',
  });
}

export async function getConnectionState(instanceName: string): Promise<ConnectionState> {
  const response = await evolutionFetch(`/instance/connectionState/${instanceName}`);
  return response.json();
}

// ============ Messaging ============

export async function sendTextMessage(
  instanceName: string,
  number: string,
  text: string,
  options?: {
    delay?: number;
    linkPreview?: boolean;
  }
): Promise<SendMessageResponse> {
  const body: any = {
    number,
    text,
    options: {
      delay: options?.delay || 0,
      linkPreview: options?.linkPreview ?? false,
    },
  };

  const response = await evolutionFetch(`/message/sendText/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function sendMediaMessage(
  instanceName: string,
  number: string,
  media: string,
  mediatype: 'image' | 'document' | 'video' | 'audio',
  options?: {
    caption?: string;
    fileName?: string;
    delay?: number;
  }
): Promise<SendMessageResponse> {
  const body: any = {
    number,
    media,
    mediatype,
    options: {
      delay: options?.delay || 0,
    },
    caption: options?.caption || '',
    fileName: options?.fileName || '',
  };

  const response = await evolutionFetch(`/message/sendMedia/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.json();
}

// ============ Presence (typing simulation) ============

export async function setPresence(
  instanceName: string,
  number: string,
  presence: 'composing' | 'available' | 'unavailable' | 'recording',
  delay: number = 2000
): Promise<void> {
  await evolutionFetch(`/chat/setPresence/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      presence,
      delay,
    }),
  });
}

// ============ Proxy Configuration ============

export async function setProxy(
  instanceName: string,
  proxy: {
    enabled: boolean;
    host: string;
    port: string;
    username: string;
    password: string;
  }
): Promise<void> {
  await evolutionFetch(`/proxy/set/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify(proxy),
  });
}

// ============ Webhook Configuration ============

export async function setWebhook(
  instanceName: string,
  webhookUrl: string,
  events: string[] = [
    'MESSAGES_UPSERT',
    'MESSAGES_UPDATE',
    'SEND_MESSAGE',
    'CONNECTION_UPDATE',
  ]
): Promise<void> {
  await evolutionFetch(`/webhook/set/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      enabled: true,
      url: webhookUrl,
      webhookByEvents: true,
      events,
    }),
  });
}

// ============ Helper Functions ============

/**
 * Format phone number for WhatsApp API
 * Accepts formats like: 11999990001, 5511999990001, +5511999990001
 * Returns: 5511999990001
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, '');

  // If it starts with 0, remove it
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // If it doesn't start with 55, add it (Brazil)
  if (!cleaned.startsWith('55')) {
    cleaned = '55' + cleaned;
  }

  return cleaned;
}

/**
 * Get instance name from chip ID - creates a consistent naming convention
 */
export function getInstanceName(chipId: string, chipName: string): string {
  // Use a sanitized version of chip name + last 8 chars of ID
  const sanitizedName = chipName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
  const shortId = chipId.substring(chipId.length - 8);
  return `${INSTANCE_PREFIX}${sanitizedName}_${shortId}`;
}

/**
 * Check if an instance name belongs to OctupusZap
 */
export function isOctupusZapInstance(instanceName: string): boolean {
  return instanceName.startsWith(INSTANCE_PREFIX);
}

/**
 * Find existing Evolution instance by chip's instance name
 */
export async function findInstanceByName(instanceName: string): Promise<EvolutionInstance | null> {
  const instances = await fetchInstances();
  return instances.find(i => i.name === instanceName) || null;
}

/**
 * Get all Evolution instances with their connection status as a map
 */
export async function getInstancesStatusMap(): Promise<Map<string, { status: string; profileName: string | null; profilePicUrl: string | null; ownerJid: string | null }>> {
  const instances = await fetchOctupusZapInstances();
  const map = new Map();
  for (const inst of instances) {
    map.set(inst.name, {
      status: inst.connectionStatus,
      profileName: inst.profileName,
      profilePicUrl: inst.profilePicUrl,
      ownerJid: inst.ownerJid,
    });
  }
  return map;
}
