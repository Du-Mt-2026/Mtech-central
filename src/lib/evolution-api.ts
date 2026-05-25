// Evolution Go API Service Layer
// Handles all communication with the Evolution Go API (WhatsApp Go/whatsmeow)
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
  id: string;               // UUID
  name: string;
  token: string;
  connected: boolean;
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

  // Computed/normalized fields
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
  data?: {
    Connected: boolean;
    LoggedIn: boolean;
    Name: string;
  };
  state?: 'open' | 'close' | 'connecting';
}

/** Result from connectInstance — handles both QR code and already-connected responses */
export interface ConnectResult {
  qrcode?: string | null;   // base64 QR code image (data URI or raw base64)
  code?: string | null;     // pairing code
  pairingCode?: string | null;
  state?: string;           // connection state ("open" if already connected)
  instanceName?: string;
  instanceId?: string;      // UUID of the instance
}

interface SendMessageResponse {
  key?: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
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
 *
 * CRITICAL: Evolution Go v3 uses a TWO-LEVEL auth system:
 *   1) Global API key: for listing/creating instances (GET /instance/all, POST /instance/create)
 *   2) Instance token:  for ALL instance-scoped operations (connect, QR, send, status, etc.)
 *
 * When `instanceToken` is provided, it replaces the global API key in the `apikey` header.
 * When `instanceId` is provided, it's sent as the `instanceId` header for instance-scoped routing.
 *
 * @param endpoint API endpoint path (e.g. '/instance/connect')
 * @param options fetch options
 * @param instanceId UUID of the instance (sent as `instanceId` header)
 * @param instanceToken Per-instance token (replaces global apikey for instance-scoped calls)
 */
export async function evolutionFetch(
  endpoint: string,
  options: RequestInit = {},
  instanceId?: string,
  instanceToken?: string
) {
  const creds = await getCredentials()
  const url = `${creds.apiUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Instance-scoped operations use the instance token; global operations use the global key
    'apikey': instanceToken || creds.apiKey,
  };

  // Add instanceId header for instance-scoped operations
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
 * POST /instance/create with { name, token, proxy }
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
  // Generate a unique token — Evolution Go requires a non-empty token
  const token = `oz_${instanceName}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const body: any = {
    name: instanceName,
    token,
  };

  // Proxy is set at creation time
  if (proxyConfig) {
    body.proxy = proxyConfig;
  }

  const response = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await response.json();

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
 * GET /instance/all
 */
export async function fetchInstances(): Promise<EvolutionInstance[]> {
  const response = await evolutionFetch('/instance/all');
  const data = await response.json();

  const instances = data.data || data;
  if (!Array.isArray(instances)) return [];

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
 * DELETE /instance/delete/{instanceId} (UUID, not name)
 */
export async function deleteInstance(instanceIdOrName: string): Promise<void> {
  // Delete uses the GLOBAL API key (not instance token)
  const instanceId = await resolveInstanceId(instanceIdOrName);
  await evolutionFetch(`/instance/delete/${instanceId}`, {
    method: 'DELETE',
  });
}

// ============ Connection ============

/**
 * Connect to an instance.
 * POST /instance/connect with { webhookUrl, subscribe, immediate }
 * The webhook is configured at connect time.
 * QR code is received via webhook event, not in the connect response.
 */
export async function connectInstance(
  instanceIdOrName: string,
  webhookUrl?: string,
  subscribeEvents?: string[]
): Promise<ConnectResult> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

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
  }, instanceId, instanceToken);

  const data = await response.json();

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
 * GET /instance/qr (with instanceId header)
 * Returns { data: { Qrcode: "data:image/png;base64,...", Code: "2@..." }, message: "success" }
 */
export async function getInstanceQRCode(instanceIdOrName: string): Promise<ConnectResult> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/qr', {}, instanceId, instanceToken);
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
 * POST /instance/pair with { phone, subscribe }
 */
export async function requestPairingCode(
  instanceIdOrName: string,
  phone: string
): Promise<string | null> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/pair', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }, instanceId, instanceToken);
    const data = await response.json();
    const result = data.data || data;
    return result.PairingCode || result.pairingCode || null;
  } catch {
    return null;
  }
}

/**
 * Disconnect from an instance.
 * POST /instance/disconnect (with instanceId header)
 */
export async function disconnectInstance(instanceIdOrName: string): Promise<void> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);
  await evolutionFetch('/instance/disconnect', {
    method: 'POST',
  }, instanceId, instanceToken);
}

/**
 * Get connection state of an instance.
 * GET /instance/status (with instanceId header)
 * Returns { data: { Connected, LoggedIn, Name }, message: "success" }
 */
export async function getConnectionState(instanceIdOrName: string): Promise<ConnectionState> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/status', {}, instanceId, instanceToken);
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
 * POST /send/text with { number, text, delay, ... } (instanceId header)
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
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  const body: any = {
    number,
    text,
    delay: options?.delay || 0,
  };

  const response = await evolutionFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceId, instanceToken);
  const data = await response.json();

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
 * POST /send/media with { number, media, caption, fileName, ... } (instanceId header)
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
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

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
  }, instanceId, instanceToken);
  const data = await response.json();

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
 * POST /message/presence with { number, presence, delay } (instanceId header)
 */
export async function setPresence(
  instanceIdOrName: string,
  number: string,
  presence: 'composing' | 'available' | 'unavailable' | 'recording',
  delay: number = 2000
): Promise<void> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  // Best-effort — if it fails, the sending engine still works
  try {
    await evolutionFetch('/message/presence', {
      method: 'POST',
      body: JSON.stringify({
        number,
        presence,
        delay,
      }),
    }, instanceId, instanceToken);
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
 * Proxy is set at instance creation time via the `proxy` field.
 * To update proxy after creation, the instance needs to be deleted and recreated.
 * Alternative: Delete proxy via DELETE /instance/proxy/{instanceId}
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
  // Proxy is configured at instance creation time.
  // To update proxy after creation, the instance needs to be deleted and recreated.

  // If proxy is being disabled, delete the proxy configuration
  if (!proxy.enabled) {
    try {
      const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);
      await evolutionFetch(`/instance/proxy/${instanceId}`, {
        method: 'DELETE',
      }, undefined, instanceToken);
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
 * Webhook is configured at connect time via POST /instance/connect.
 * There is no separate webhook endpoint in Evolution Go.
 * This function triggers a connect call with the webhook configuration.
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
  // Webhook is set during connect.
  // If the instance is already connected, this will update the webhook.
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  await evolutionFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify({
      webhookUrl,
      subscribe: events,
      immediate: true,
    }),
  }, instanceId, instanceToken);
}

// ============ Number Verification ============

/**
 * Check if phone numbers exist on WhatsApp.
 * POST /user/check with { numbers: [...] } (instanceId header)
 * Returns { data: { Users: [{ Query, IsInWhatsapp, JID, ... }] }, message: "success" }
 */
export async function checkWhatsAppNumbers(
  instanceIdOrName: string,
  numbers: string[]
): Promise<Array<{ query: string; exists: boolean; jid: string }>> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  const response = await evolutionFetch('/user/check', {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  }, instanceId, instanceToken);

  const data = await response.json();
  const result = data.data || data;

  // Normalize response
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

// ============ Instance ID & Token Resolution ============

/**
 * Resolved instance info: UUID + per-instance token.
 * Both are required for instance-scoped Evolution Go API calls.
 */
interface ResolvedInstance {
  id: string;      // UUID
  token: string;   // Per-instance token (used as apikey for instance-scoped calls)
}

/**
 * Cache for resolved instance info (name → { id, token }).
 * Avoids repeated /instance/all calls when doing multiple operations
 * on the same instance within a single request.
 */
const instanceCache = new Map<string, ResolvedInstance>();

export function clearInstanceIdCache(): void {
  instanceCache.clear();
}

/**
 * Resolve an instance name (or UUID) to its UUID + token.
 * This fetches /instance/all using the GLOBAL API key and finds the matching instance.
 * The returned token is required for ALL subsequent instance-scoped API calls.
 */
async function resolveInstance(nameOrId: string): Promise<ResolvedInstance> {
  // Check cache first
  if (instanceCache.has(nameOrId)) {
    return instanceCache.get(nameOrId)!;
  }

  // Fetch all instances (uses global API key)
  try {
    const instances = await fetchInstances();

    // Find by name or by ID
    const instance = instances.find(i => i.name === nameOrId || i.id === nameOrId);
    if (instance && instance.id) {
      const resolved = { id: instance.id, token: instance.token };
      instanceCache.set(nameOrId, resolved);
      // Also cache by name if we searched by ID
      if (instance.name !== nameOrId) {
        instanceCache.set(instance.name, resolved);
      }
      return resolved;
    }
  } catch {
    // If fetch fails, fall through
  }

  // Last resort: return name as-is with empty token
  // This will likely fail for instance-scoped operations,
  // but global operations (like listing) might still work
  return { id: nameOrId, token: '' };
}

/**
 * Backward-compatible helper: resolve instance name to UUID only.
 */
async function resolveInstanceId(nameOrId: string): Promise<string> {
  const resolved = await resolveInstance(nameOrId);
  return resolved.id;
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
