// Evolution Go API Service Layer
// Handles all communication with the Evolution Go API (WhatsApp Go/whatsmeow)
// Migrated from Evolution API v2 (Baileys) to Evolution Go (v3)
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
 * Get Evolution Go API credentials from DB Settings table.
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
 * Test Evolution Go API connection — returns true if credentials are valid
 */
export async function testConnection(): Promise<{ success: boolean; error?: string; instanceCount?: number }> {
  try {
    const creds = await getCredentials()
    if (!creds.apiUrl || !creds.apiKey) {
      return { success: false, error: 'URL ou API Key não configurados' }
    }
    // Evolution Go: GET /instance/all
    const response = await fetch(`${creds.apiUrl}/instance/all`, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': creds.apiKey,
      },
    })
    if (!response.ok) {
      const text = await response.text()
      return { success: false, error: `API retornou ${response.status}: ${text.substring(0, 200)}` }
    }
    const data = await response.json()
    const instances = data.data || data
    return { success: true, instanceCount: Array.isArray(instances) ? instances.length : 0 }
  } catch (error: any) {
    return { success: false, error: error.message || 'Erro ao conectar' }
  }
}

// ============ Evolution Go API Types ============

interface EvolutionInstance {
  id: string;               // UUID in v3 (was instanceId in v2)
  name: string;
  token: string;
  connected: boolean;       // v3 uses boolean (v2 used connectionStatus string)
  jid: string;              // WhatsApp JID when connected
  webhook: string;
  proxy: string;
  os_name: string;
  client_name: string;
  events: string;
  alwaysOnline: boolean;
  rejectCall: boolean;
  msgRejectCall: string;
  readMessages: boolean;
  ignoreGroups: boolean;
  ignoreStatus: boolean;
  createdAt: string;
  disconnect_reason: string;

  // Computed/normalized fields for backward compatibility
  connectionStatus?: 'open' | 'close' | 'connecting';
  ownerJid?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
  integration?: string;
  number?: string | null;
  disconnectionReasonCode?: number | null;
  disconnectionAt?: string | null;
  updatedAt?: string;
  Proxy?: {
    enabled: boolean;
    host: string;
    port: string;
    username: string;
    password: string;
  } | null;
}

interface ConnectionState {
  instance?: {
    instanceName: string;
    state: 'open' | 'close' | 'connecting';
  };
  // Evolution Go format
  data?: {
    Connected: boolean;
    LoggedIn: boolean;
    Name: string;
  };
  // Normalized
  state?: 'open' | 'close' | 'connecting';
}

/** Result from connectInstance — handles both QR code and already-connected responses */
export interface ConnectResult {
  qrcode?: string | null;   // base64 QR code image (data URI or raw base64)
  code?: string | null;     // pairing code
  pairingCode?: string | null;
  state?: string;           // connection state ("open" if already connected)
  instanceName?: string;
  instanceId?: string;      // UUID of the instance (v3)
}

interface SendMessageResponse {
  key?: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  // Evolution Go response format
  data?: {
    Info?: {
      Chat: string;
      Sender: string;
      IsFromMe: boolean;
      ID: string;
      Type: string;
      Timestamp: string;
    };
    Message?: any;
  };
  message?: string;
  messageId?: string;
  status?: string;
}

// ============ Core API Client ============

/**
 * Core fetch function for Evolution Go API.
 * In v3, many endpoints require the `instanceId` header (UUID) instead of
 * the instance name in the URL path.
 */
export async function evolutionFetch(
  endpoint: string,
  options: RequestInit = {},
  instanceId?: string
) {
  const creds = await getCredentials()
  const url = `${creds.apiUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': creds.apiKey,
  };

  // Evolution Go v3: add instanceId header for instance-scoped operations
  if (instanceId) {
    headers['instanceId'] = instanceId;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Evolution Go API error (${response.status}): ${error}`);
  }

  return response;
}

// ============ Instance Management ============

/**
 * Create a new instance in Evolution Go.
 * In v3: POST /instance/create with { name, token, proxy }
 * No more integration: 'WHATSAPP-BAILEYS' — Go is the only engine.
 */
export async function createInstance(
  instanceName: string,
  proxyConfig?: {
    address: string;
    port: string;
    username: string;
    password: string;
  }
): Promise<EvolutionInstance> {
  const body: any = {
    name: instanceName,
    token: '',  // Let Evolution Go auto-generate the token
  };

  // In v3, proxy is set at creation time
  if (proxyConfig) {
    body.proxy = proxyConfig;
  }

  const response = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await response.json();

  // Evolution Go response: { data: { id, name, token, connected, ... }, message: "success" }
  const inst = data.data || data;

  return {
    id: inst.id || '',
    name: inst.name || instanceName,
    token: inst.token || '',
    connected: inst.connected || false,
    jid: inst.jid || '',
    webhook: inst.webhook || '',
    proxy: inst.proxy || '',
    os_name: inst.os_name || 'Evolution GO',
    client_name: inst.client_name || 'evolution',
    events: inst.events || '',
    alwaysOnline: inst.alwaysOnline || false,
    rejectCall: inst.rejectCall || false,
    msgRejectCall: inst.msgRejectCall || '',
    readMessages: inst.readMessages || false,
    ignoreGroups: inst.ignoreGroups || false,
    ignoreStatus: inst.ignoreStatus || false,
    createdAt: inst.createdAt || new Date().toISOString(),
    disconnect_reason: inst.disconnect_reason || '',
    // Normalized for backward compatibility
    connectionStatus: inst.connected ? 'open' : 'close',
    ownerJid: inst.jid || null,
    profileName: null,
    profilePicUrl: null,
    integration: 'WHATSAPP-GO',
    number: null,
    disconnectionReasonCode: null,
    disconnectionAt: null,
    updatedAt: inst.createdAt || new Date().toISOString(),
    Proxy: null,
  };
}

/**
 * Fetch all instances from Evolution Go.
 * In v3: GET /instance/all
 */
export async function fetchInstances(): Promise<EvolutionInstance[]> {
  const response = await evolutionFetch('/instance/all');
  const data = await response.json();

  // Evolution Go response: { data: [...instances], message: "success" }
  const instances = data.data || data;
  if (!Array.isArray(instances)) return [];

  // Normalize v3 instances to our EvolutionInstance format
  return instances.map((inst: any) => ({
    id: inst.id || '',
    name: inst.name || '',
    token: inst.token || '',
    connected: inst.connected || false,
    jid: inst.jid || '',
    webhook: inst.webhook || '',
    proxy: inst.proxy || '',
    os_name: inst.os_name || 'Evolution GO',
    client_name: inst.client_name || 'evolution',
    events: inst.events || '',
    alwaysOnline: inst.alwaysOnline || false,
    rejectCall: inst.rejectCall || false,
    msgRejectCall: inst.msgRejectCall || '',
    readMessages: inst.readMessages || false,
    ignoreGroups: inst.ignoreGroups || false,
    ignoreStatus: inst.ignoreStatus || false,
    createdAt: inst.createdAt || '',
    disconnect_reason: inst.disconnect_reason || '',
    // Normalized for backward compatibility
    connectionStatus: inst.connected ? 'open' : 'close',
    ownerJid: inst.jid || null,
    profileName: null,
    profilePicUrl: null,
    integration: 'WHATSAPP-GO',
    number: null,
    disconnectionReasonCode: null,
    disconnectionAt: null,
    updatedAt: inst.createdAt || '',
    Proxy: null,
  }));
}

/**
 * Fetch only OctupusZap instances (filtered by INSTANCE_PREFIX).
 * Other instances on the same Evolution Go server are ignored.
 */
export async function fetchOctupusZapInstances(): Promise<EvolutionInstance[]> {
  const all = await fetchInstances();
  return all.filter(inst => inst.name.startsWith(INSTANCE_PREFIX));
}

/**
 * Delete an instance.
 * In v3: DELETE /instance/delete/{instanceId} (UUID, not name!)
 */
export async function deleteInstance(instanceIdOrName: string): Promise<void> {
  // Try to resolve UUID from name if needed
  const instanceId = await resolveInstanceId(instanceIdOrName);
  await evolutionFetch(`/instance/delete/${instanceId}`, {
    method: 'DELETE',
  });
}

// ============ Connection ============

/**
 * Connect to an instance.
 * In v3: POST /instance/connect with { webhookUrl, subscribe, immediate }
 * The webhook is configured at connect time (no separate setWebhook call).
 * QR code is received via webhook event, not in the connect response.
 */
export async function connectInstance(
  instanceIdOrName: string,
  webhookUrl?: string,
  subscribeEvents?: string[]
): Promise<ConnectResult> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  const body: any = {
    immediate: true,
  };

  if (webhookUrl) {
    body.webhookUrl = webhookUrl;
    body.subscribe = subscribeEvents || [
      'MESSAGE',
      'SEND_MESSAGE',
      'READ_RECEIPT',
      'PRESENCE',
      'CHAT_PRESENCE',
      'CALL',
      'CONNECTION',
      'QRCODE',
      'LABEL',
      'CONTACT',
      'GROUP',
    ];
  }

  const response = await evolutionFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceId);

  const data = await response.json();

  // Evolution Go connect response: { data: { eventString, jid, webhookUrl }, message: "success" }
  const result = data.data || data;

  // Check if already connected (jid is present)
  if (result.jid) {
    return {
      state: 'open',
      instanceName: instanceIdOrName,
      instanceId: instanceId,
      qrcode: null,
      code: null,
      pairingCode: null,
    };
  }

  // Not yet connected — QR code will come via webhook event
  // We need to fetch it separately
  return {
    state: 'close',
    instanceName: instanceIdOrName,
    instanceId: instanceId,
    qrcode: null,
    code: null,
    pairingCode: null,
  };
}

/**
 * Get QR code for an instance.
 * In v3: GET /instance/qr (with instanceId header)
 * Returns { data: { Qrcode: "data:image/png;base64,...", Code: "2@..." }, message: "success" }
 */
export async function getInstanceQRCode(instanceIdOrName: string): Promise<ConnectResult> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/qr', {}, instanceId);
    const data = await response.json();

    const qrData = data.data || data;
    return {
      qrcode: qrData.Qrcode || null,
      code: qrData.Code || null,
      pairingCode: null,
      state: 'close',
      instanceName: instanceIdOrName,
      instanceId: instanceId,
    };
  } catch {
    // QR code not available yet — instance might still be connecting
    return {
      qrcode: null,
      code: null,
      pairingCode: null,
      state: 'close',
      instanceName: instanceIdOrName,
      instanceId: instanceId,
    };
  }
}

/**
 * Request pairing code for an instance (alternative to QR code).
 * In v3: POST /instance/pair with { phone, subscribe }
 */
export async function requestPairingCode(
  instanceIdOrName: string,
  phone: string
): Promise<string | null> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/pair', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }, instanceId);
    const data = await response.json();
    const result = data.data || data;
    return result.PairingCode || result.pairingCode || null;
  } catch {
    return null;
  }
}

/**
 * Disconnect from an instance.
 * In v3: POST /instance/disconnect (with instanceId header)
 */
export async function disconnectInstance(instanceIdOrName: string): Promise<void> {
  const instanceId = await resolveInstanceId(instanceIdOrName);
  await evolutionFetch('/instance/disconnect', {
    method: 'POST',
  }, instanceId);
}

/**
 * Get connection state of an instance.
 * In v3: GET /instance/status (with instanceId header)
 * Returns { data: { Connected, LoggedIn, Name }, message: "success" }
 */
export async function getConnectionState(instanceIdOrName: string): Promise<ConnectionState> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/status', {}, instanceId);
    const data = await response.json();
    const status = data.data || data;

    return {
      data: status,
      state: status.Connected ? 'open' : 'close',
      instance: {
        instanceName: instanceIdOrName,
        state: status.Connected ? 'open' : 'close',
      },
    };
  } catch {
    return {
      state: 'close',
      instance: {
        instanceName: instanceIdOrName,
        state: 'close',
      },
    };
  }
}

// ============ Messaging ============

/**
 * Send a text message.
 * In v3: POST /send/text with { number, text, delay, ... } (instanceId header)
 */
export async function sendTextMessage(
  instanceIdOrName: string,
  number: string,
  text: string,
  options?: {
    delay?: number;
    linkPreview?: boolean;
  }
): Promise<SendMessageResponse> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  const body: any = {
    number,
    text,
    delay: options?.delay || 0,
  };

  const response = await evolutionFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceId);
  const data = await response.json();

  // Normalize v3 response to v2 format for backward compatibility
  const result = data.data || data;
  return {
    key: {
      remoteJid: result.Info?.Chat || '',
      fromMe: result.Info?.IsFromMe ?? true,
      id: result.Info?.ID || data.messageId || '',
    },
    message: result.Message || data.Message,
    status: data.message || 'sent',
  };
}

/**
 * Send a media message.
 * In v3: POST /send/media with { number, media, caption, fileName, ... } (instanceId header)
 */
export async function sendMediaMessage(
  instanceIdOrName: string,
  number: string,
  media: string,
  mediatype: 'image' | 'document' | 'video' | 'audio',
  options?: {
    caption?: string;
    fileName?: string;
    delay?: number;
  }
): Promise<SendMessageResponse> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  const body: any = {
    number,
    media,
    caption: options?.caption || '',
    fileName: options?.fileName || '',
    delay: options?.delay || 0,
  };

  const response = await evolutionFetch('/send/media', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceId);
  const data = await response.json();

  // Normalize v3 response to v2 format for backward compatibility
  const result = data.data || data;
  return {
    key: {
      remoteJid: result.Info?.Chat || '',
      fromMe: result.Info?.IsFromMe ?? true,
      id: result.Info?.ID || data.messageId || '',
    },
    message: result.Message || data.Message,
    status: data.message || 'sent',
  };
}

// ============ Presence (typing simulation) ============

/**
 * Set chat presence (typing, recording, etc).
 * In v3: POST /message/presence with { number, presence, delay } (instanceId header)
 */
export async function setPresence(
  instanceIdOrName: string,
  number: string,
  presence: 'composing' | 'available' | 'unavailable' | 'recording',
  delay: number = 2000
): Promise<void> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  // Evolution Go: best-effort — if it fails, the sending engine still works
  try {
    await evolutionFetch('/message/presence', {
      method: 'POST',
      body: JSON.stringify({
        number,
        presence,
        delay,
      }),
    }, instanceId);
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

/**
 * Set proxy on an instance.
 * In v3: Proxy is set at instance creation time via the `proxy` field.
 * However, if we need to update proxy after creation, we need to
 * delete the instance and recreate it with the new proxy config.
 * For now, this is a no-op if the instance already exists.
 *
 * Alternative: Delete proxy via DELETE /instance/proxy/{instanceId}
 * and recreate the instance with the new proxy.
 */
export async function setProxy(
  instanceIdOrName: string,
  proxy: {
    enabled: boolean;
    host: string;
    port: string;
    username: string;
    password: string;
  }
): Promise<void> {
  // In Evolution Go v3, proxy is configured at instance creation time.
  // To update proxy after creation, we need to delete the instance and recreate it.
  // For now, we'll store the proxy info and apply it on next reconnect.
  // This is a limitation of the v3 API compared to v2 which had a separate proxy endpoint.

  // If proxy is being disabled, delete the proxy configuration
  if (!proxy.enabled) {
    try {
      const instanceId = await resolveInstanceId(instanceIdOrName);
      await evolutionFetch(`/instance/proxy/${instanceId}`, {
        method: 'DELETE',
      });
    } catch {
      // Silently ignore — proxy removal is not critical
    }
    return;
  }

  // For enabling/changing proxy, we would need to recreate the instance.
  // For now, this is handled at connect time where we recreate with proxy.
  console.log(`[Evolution Go] Proxy update for ${instanceIdOrName} will be applied on next instance creation/reconnect`);
}

// ============ Webhook Configuration ============

/**
 * Set webhook for an instance.
 * In v3: Webhook is configured at connect time via POST /instance/connect
 * There is NO separate webhook endpoint in Evolution Go.
 *
 * This function is kept for backward compatibility but now triggers
 * a connect call with the webhook configuration.
 */
export async function setWebhook(
  instanceIdOrName: string,
  webhookUrl: string,
  events: string[] = [
    'MESSAGE',
    'SEND_MESSAGE',
    'READ_RECEIPT',
    'PRESENCE',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'QRCODE',
    'LABEL',
    'CONTACT',
    'GROUP',
  ]
): Promise<void> {
  // In v3, webhook is set during connect.
  // This function triggers a connect with webhook config.
  // If the instance is already connected, this will update the webhook.
  const instanceId = await resolveInstanceId(instanceIdOrName);

  await evolutionFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify({
      webhookUrl,
      subscribe: events,
      immediate: true,
    }),
  }, instanceId);
}

// ============ Number Verification ============

/**
 * Check if phone numbers exist on WhatsApp.
 * In v3: POST /user/check with { numbers: [...] } (instanceId header)
 * Returns { data: { Users: [{ Query, IsInWhatsapp, JID, ... }] }, message: "success" }
 */
export async function checkWhatsAppNumbers(
  instanceIdOrName: string,
  numbers: string[]
): Promise<Array<{ query: string; exists: boolean; jid: string }>> {
  const instanceId = await resolveInstanceId(instanceIdOrName);

  const response = await evolutionFetch('/user/check', {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  }, instanceId);

  const data = await response.json();
  const result = data.data || data;

  // Normalize v3 response
  if (result.Users && Array.isArray(result.Users)) {
    return result.Users.map((u: any) => ({
      query: u.Query || '',
      exists: u.IsInWhatsapp || false,
      jid: u.JID || u.RemoteJID || '',
    }));
  }

  return [];
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
      status: inst.connectionStatus || (inst.connected ? 'open' : 'close'),
      profileName: inst.profileName || null,
      profilePicUrl: inst.profilePicUrl || null,
      ownerJid: inst.ownerJid || null,
    });
  }
  return map;
}

// ============ Instance ID Resolution ============

/**
 * In Evolution Go v3, many operations require the instance UUID (not the name).
 * This function resolves an instance name to its UUID by fetching all instances.
 * If the input is already a UUID (contains hyphens and is 36 chars), return it directly.
 *
 * This is cached in-memory to avoid repeated API calls.
 */
const instanceIdCache = new Map<string, string>();

export function clearInstanceIdCache(): void {
  instanceIdCache.clear();
}

async function resolveInstanceId(nameOrId: string): Promise<string> {
  // Check if already a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
    return nameOrId;
  }

  // Check cache
  if (instanceIdCache.has(nameOrId)) {
    return instanceIdCache.get(nameOrId)!;
  }

  // Fetch instances and find the UUID
  try {
    const instances = await fetchInstances();
    const instance = instances.find(i => i.name === nameOrId);
    if (instance && instance.id) {
      instanceIdCache.set(nameOrId, instance.id);
      return instance.id;
    }
  } catch {
    // If fetch fails, fall through
  }

  // Last resort: return the name as-is and hope the API accepts it
  // (Some v3 endpoints might still work with the name in the instanceId header)
  return nameOrId;
}

/**
 * Convert proxy config from internal format to Evolution Go format.
 * Internal: { enabled, host, port, username, password }
 * Evolution Go: { address, port, username, password }
 */
export function toEvolutionGoProxy(proxy: {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  password: string;
} | null): { address: string; port: string; username: string; password: string } | undefined {
  if (!proxy || !proxy.enabled) return undefined;
  return {
    address: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
  };
}
