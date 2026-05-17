// Evolution API Service Layer
// Handles all communication with the Evolution API (WhatsApp Baileys)
// Credentials are stored in the database (Settings table) with env var fallback

import { db } from './db'
import { normalizePhone } from './phone-utils'

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

interface ConnectionState {
  instance: {
    instanceName: string;
    state: 'open' | 'close' | 'connecting';
  };
}

/** Result from connectInstance — handles both QR code and already-connected responses */
export interface ConnectResult {
  qrcode?: string | null;   // base64 QR code image (data URI or raw base64)
  code?: string | null;     // pairing code
  pairingCode?: string | null;
  state?: string;           // connection state ("open" if already connected)
  instanceName?: string;
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

export async function evolutionFetch(endpoint: string, options: RequestInit = {}) {
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
  const data = await response.json();

  // Evolution API v2.x returns: { instance: { instanceName, instanceId, status, ... }, hash: "...", ... }
  // Normalize to our flat EvolutionInstance format so .name and .connectionStatus work correctly
  if (data.instance) {
    const inst = data.instance;
    return {
      id: inst.instanceId || '',
      name: inst.instanceName || instanceName,
      connectionStatus: inst.status === 'open' ? 'open' : inst.status === 'connecting' ? 'connecting' : 'close',
      ownerJid: null,
      profileName: null,
      profilePicUrl: null,
      integration: inst.integration || 'WHATSAPP-BAILEYS',
      number: null,
      token: data.hash || '',
      disconnectionReasonCode: null,
      disconnectionAt: null,
      createdAt: inst.createdAt || new Date().toISOString(),
      updatedAt: inst.updatedAt || new Date().toISOString(),
      Proxy: null,
    };
  }

  // Fallback: response might already be flat format
  return data as EvolutionInstance;
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

export async function connectInstance(instanceName: string): Promise<ConnectResult> {
  // Evolution API v2.x: GET /instance/connect/{instanceName}
  // - If already connected: returns { instance: { instanceName, state: "open" } }
  // - If disconnected/connecting: returns { pairingCode, code, base64 }
  const response = await evolutionFetch(`/instance/connect/${instanceName}`);
  const data = await response.json();

  // Case 1: Already connected — { instance: { instanceName, state: "open" } }
  if (data.instance?.state) {
    return {
      state: data.instance.state,
      instanceName: data.instance.instanceName || instanceName,
      qrcode: null,
      code: null,
      pairingCode: null,
    };
  }

  // Case 2: Disconnected — returns QR code { pairingCode, code, base64 }
  return {
    qrcode: data.base64 || null,
    code: data.code || null,
    pairingCode: data.pairingCode || null,
    state: 'close',
    instanceName,
  };
}

export async function disconnectInstance(instanceName: string): Promise<void> {
  // Evolution API v2.x: restart instance to disconnect (generates new QR code)
  // The /instance/disconnect endpoint doesn't exist in v2.3.7
  // Instead, use /instance/restart which disconnects and returns a new QR code
  await evolutionFetch(`/instance/restart/${instanceName}`, {
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
  // Evolution API v2.x: may not support /chat/setPresence
  // This is best-effort — if it fails, the sending engine still works
  try {
    await evolutionFetch(`/chat/setPresence/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        number,
        presence,
        delay,
      }),
    });
  } catch {
    // Silently ignore — presence is not critical for sending
  }
}

// ============ Proxy Configuration ============

// Cache for global proxy settings (avoids DB query on every call)
let cachedGlobalProxy: { enabled: boolean; host: string; port: string; username: string; password: string } | null | undefined = undefined
let globalProxyCacheTimestamp = 0
const GLOBAL_PROXY_CACHE_TTL_MS = 30_000 // 30 seconds

/**
 * Get the global SOCKS5 proxy from Settings table.
 * This is the proxy that applies to ALL chips automatically,
 * so the user doesn't need to configure proxy on each chip.
 * Settings keys: default_socks5_host, default_socks5_port, default_socks5_user, default_socks5_pass
 */
export async function getGlobalProxy(): Promise<{ enabled: boolean; host: string; port: string; username: string; password: string } | null> {
  const now = Date.now()
  if (cachedGlobalProxy !== undefined && (now - globalProxyCacheTimestamp) < GLOBAL_PROXY_CACHE_TTL_MS) {
    return cachedGlobalProxy
  }

  try {
    const settings = await db.settings.findMany({
      where: {
        key: { in: ['default_socks5_host', 'default_socks5_port', 'default_socks5_user', 'default_socks5_pass'] }
      }
    })
    const settingsMap = new Map(settings.map(s => [s.key, s.value]))

    const host = settingsMap.get('default_socks5_host') || ''
    const port = settingsMap.get('default_socks5_port') || ''

    if (host && port) {
      cachedGlobalProxy = {
        enabled: true,
        host,
        port,
        username: settingsMap.get('default_socks5_user') || '',
        password: settingsMap.get('default_socks5_pass') || '',
      }
      globalProxyCacheTimestamp = now
      return cachedGlobalProxy
    }
  } catch {
    // DB not available, return null
  }

  cachedGlobalProxy = null
  globalProxyCacheTimestamp = now
  return null
}

/**
 * Clear the global proxy cache — call after saving proxy settings
 */
export function clearGlobalProxyCache(): void {
  cachedGlobalProxy = undefined
  globalProxyCacheTimestamp = 0
}

/**
 * Resolve automatic proxy config from a chip record.
 * Priority:
 *   1) Explicit SOCKS5 configuration on the chip (proxyMode='socks5' + host/port)
 *   2) Auto-detect from WireGuard IP (Every Proxy on the phone)
 *   3) Global SOCKS5 proxy from Settings (applies to ALL chips automatically)
 *   4) No proxy
 *
 * This means the user can configure the proxy ONCE in Settings and
 * ALL chips will automatically use it — no per-chip configuration needed.
 */
export function resolveChipProxy(chip: {
  proxyMode: string;
  socks5Host: string;
  socks5Port: number;
  socks5User: string;
  socks5Pass: string;
  wireguardIp: string;
  socksPort: number;
}, globalProxy?: { enabled: boolean; host: string; port: string; username: string; password: string } | null): { enabled: boolean; host: string; port: string; username: string; password: string } | null {
  // 1) Explicit SOCKS5 configuration on the chip
  if (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Port) {
    return {
      enabled: true,
      host: chip.socks5Host,
      port: String(chip.socks5Port),
      username: chip.socks5User || '',
      password: chip.socks5Pass || '',
    }
  }

  // 2) Auto-detect: chip has WireGuard IP → Every Proxy on the phone
  //    Every Proxy on Android defaults to port 8080 for SOCKS5
  if (chip.wireguardIp) {
    return {
      enabled: true,
      host: chip.wireguardIp,
      port: String(chip.socksPort || 8080),
      username: chip.socks5User || '',
      password: chip.socks5Pass || '',
    }
  }

  // 3) Global SOCKS5 proxy from Settings (auto-applies to all chips)
  if (globalProxy && globalProxy.enabled && globalProxy.host && globalProxy.port) {
    return globalProxy
  }

  // 4) No proxy available
  return null
}

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
  // Evolution API v2.x: requires "protocol" field
  await evolutionFetch(`/proxy/set/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      ...proxy,
      protocol: 'socks5',
    }),
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
  // Evolution API v2.x: webhook config must be wrapped in "webhook" object
  await evolutionFetch(`/webhook/set/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        byEvents: true,
        events,
      },
    }),
  });
}

// ============ Helper Functions ============

/**
 * Format phone number for WhatsApp API
 * Accepts formats like: 11999990001, 5511999990001, +5511999990001
 * Returns: 5511999990001
 *
 * Uses centralized normalizePhone() from lib/phone-utils.ts which correctly
 * handles DDD 55 (Rio Grande do Sul) by using length-based detection instead
 * of prefix-based detection.
 */
export function formatPhoneNumber(phone: string): string {
  return normalizePhone(phone);
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
