// Evolution Go API Service Layer
// Handles all communication with the Evolution Go API (WhatsApp Go/whatsmeow)
// Credentials are stored in the database (Settings table) with env var fallback

import { db } from './db'
import { normalizePhone } from './phone-utils'
import { FIELD_DEFAULTS, type AntiBanSettings } from './constants'

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

// ============ Anti-Ban Settings Cache (for timeout, call reject, etc.) ============
// The UI stores these in AntiBanSettings, but evolutionFetch() is called
// on EVERY API request — we can't hit the DB each time.
// Solution: cache with TTL (same pattern as credentials cache).

interface CachedAntiBanApiSettings {
  evolutionApiTimeoutMs: number
  autoRejectCalls: boolean
  autoRejectCallMessage: string
}

let cachedAntiBanApi: CachedAntiBanApiSettings | null = null
let antiBanApiCacheTimestamp = 0
const ANTI_BAN_API_CACHE_TTL_MS = 30_000 // 30 seconds — faster refresh for timeout changes

/**
 * Get anti-ban API settings from DB (evolutionApiTimeoutMs, autoRejectCalls, autoRejectCallMessage).
 * These are UI-configurable but were previously hardcoded — this function fixes the ghost settings bug.
 * Uses in-memory cache with 30s TTL to avoid excessive DB queries.
 */
async function getAntiBanApiSettings(): Promise<CachedAntiBanApiSettings> {
  const now = Date.now()
  if (cachedAntiBanApi && (now - antiBanApiCacheTimestamp) < ANTI_BAN_API_CACHE_TTL_MS) {
    return cachedAntiBanApi
  }

  try {
    const settings = await db.antiBanSettings.findFirst() as unknown as AntiBanSettings | null
    if (settings) {
      cachedAntiBanApi = {
        evolutionApiTimeoutMs: settings.evolutionApiTimeoutMs || (FIELD_DEFAULTS.evolutionApiTimeoutMs as number),
        autoRejectCalls: settings.autoRejectCalls ?? (FIELD_DEFAULTS.autoRejectCalls as boolean),
        autoRejectCallMessage: settings.autoRejectCallMessage || (FIELD_DEFAULTS.autoRejectCallMessage as string),
      }
      antiBanApiCacheTimestamp = now
      return cachedAntiBanApi
    }
  } catch {
    // DB not available yet, fall through to defaults
  }

  // Fallback to FIELD_DEFAULTS from constants.ts (single source of truth)
  cachedAntiBanApi = {
    evolutionApiTimeoutMs: FIELD_DEFAULTS.evolutionApiTimeoutMs as number,
    autoRejectCalls: FIELD_DEFAULTS.autoRejectCalls as boolean,
    autoRejectCallMessage: FIELD_DEFAULTS.autoRejectCallMessage as string,
  }
  antiBanApiCacheTimestamp = now
  return cachedAntiBanApi
}

/**
 * Clear the anti-ban API settings cache — call after saving anti-ban settings
 */
export function clearAntiBanApiCache(): void {
  cachedAntiBanApi = null
  antiBanApiCacheTimestamp = 0
}

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

  if (!creds.apiUrl || !creds.apiKey) {
    throw new Error('Evolution Go API não configurada. Defina a URL e API Key nas configurações.')
  }

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

  // Use AbortController with timeout from UI settings (evolutionApiTimeoutMs).
  // Previously hardcoded to 15s — now reads from AntiBanSettings so the UI actually works.
  const apiSettings = await getAntiBanApiSettings()
  const timeoutMs = apiSettings.evolutionApiTimeoutMs
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> || {}),
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();

      // ============================================
      // 403 AUTO-RETRY WITH TOKEN REFRESH
      // ============================================
      // Evolution API V3 returns 403 when:
      //   1) Instance token changed (server restart, instance recreated)
      //   2) API key is invalid
      //   3) Rate limiting (rare)
      //
      // This is DIFFERENT from WhatsApp ban code 403 which comes via
      // the Disconnected webhook event with data.Code = 403.
      //
      // When the instance token is stale, we invalidate the cache,
      // re-resolve the token, and retry ONCE. If it still fails,
      // it's a real auth error (not a stale cache issue).
      if (response.status === 403 && instanceId) {
        console.warn(`[EvolutionAPI] Got 403 for ${endpoint} — instance token may be stale, refreshing cache and retrying...`);

        // Invalidate cache for this instance
        invalidateInstanceCache(instanceId);

        // Also try clearing by finding the instance name in the cache
        for (const [key, val] of instanceCache.entries()) {
          if (val.id === instanceId) {
            invalidateInstanceCache(key);
          }
        }

        try {
          // Re-resolve with fresh token (forceRefresh=true)
          const freshInstance = await resolveInstance(instanceId, true);

          // Retry the request with the fresh token
          const retryHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'apikey': freshInstance.token || creds.apiKey,
          };
          if (freshInstance.id) {
            retryHeaders['instanceId'] = freshInstance.id;
          }

          const retryResponse = await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(apiSettings.evolutionApiTimeoutMs),
            headers: {
              ...retryHeaders,
              ...(options.headers as Record<string, string> || {}),
            },
          });

          if (retryResponse.ok) {
            console.info(`[EvolutionAPI] 403 retry succeeded for ${endpoint} — token was stale`);
            return retryResponse;
          }

          // Retry also failed — throw with the retry error
          const retryError = await retryResponse.text();
          throw new Error(`Evolution Go API error (${retryResponse.status}): ${retryError}`);
        } catch (retryErr: any) {
          // If retry fails with a different error (network, etc.), throw that
          if (retryErr.message?.startsWith('Evolution Go API error')) {
            throw retryErr;
          }
          // Network/timeout error on retry — fall through to original error
          console.error(`[EvolutionAPI] 403 retry failed for ${endpoint}:`, retryErr.message);
        }
      }

      throw new Error(`Evolution Go API error (${response.status}): ${errorBody}`);
    }

    return response;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Evolution Go API não respondeu (timeout de ${Math.round(timeoutMs / 1000)}s). O servidor pode estar offline.`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============ Instance Management ============

/**
 * Create a new instance in Evolution Go.
 * POST /instance/create with { name, token, proxy }
 */
export async function createInstance(
  instanceName: string,
  proxyConfig?: {
    host: string;
    port: string;
    username: string;
    password: string;
    protocol?: string;
  }
): Promise<EvolutionInstance> {
  // Read call rejection settings from UI (AntiBanSettings)
  // Previously hardcoded — now respects the UI configuration.
  const apiSettings = await getAntiBanApiSettings()

  // Generate a unique token — Evolution Go requires a non-empty token
  const token = `oz_${instanceName}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const body: any = {
    name: instanceName,
    token,
    // ANTI-BAN: alwaysOnline=false ensures the chip does NOT appear
    // permanently online — presence is managed by the sending engine
    // via setPresence('available'/'unavailable') calls.
    // A chip that is always online is a known bot signature.
    alwaysOnline: false,
    // Reject incoming calls — reads from AntiBanSettings (UI-configurable)
    rejectCall: apiSettings.autoRejectCalls,
    msgRejectCall: apiSettings.autoRejectCallMessage,
    // BUG FIX: Events must be specified at instance creation time.
    // Without this field, Evolution Go creates the instance with events=""
    // which prevents QR code generation and webhook event delivery.
    // This was causing all OctupusZap instances to fail QR code scanning.
    events: [
      'MESSAGE',
      'SEND_MESSAGE',
      'SEND_MESSAGE_ACK',
      'READ_RECEIPT',
      'PRESENCE',
      'CHAT_PRESENCE',
      'CALL',
      'CONNECTION',
      'QRCODE',
      'LABEL',
      'CONTACT',
      'GROUP',
      'MESSAGES_UPDATE',
    ],
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
    connectionStatus: (inst.connected ? 'open' : 'close') as 'open' | 'close' | 'connecting',
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

  const mapped = instances.map((inst: any) => ({
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
    // Use the API's connectionStatus if available, otherwise derive from connected.
    // The enrichment function will correct this with the real status.
    connectionStatus: (inst.connectionStatus || (inst.connected ? 'open' : 'close')) as 'open' | 'close' | 'connecting',
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

  // Enrich with real connection status from /instance/status.
  // The /instance/all endpoint's `connected` field can be unreliable in Evolution Go v3.
  // The enrichment function checks both Connected AND LoggedIn for accurate status.
  await enrichInstancesWithRealStatus(mapped);

  return mapped;
}

/**
 * Enrich instances with real connection status from /instance/status.
 * The /instance/all endpoint's `connected` field is unreliable — it shows `false`
 * even for instances that are Connected+LoggedIn. This function calls /instance/status
 * for each instance and corrects the `connected` and `connectionStatus` fields.
 *
 * Uses batched concurrent requests (5 at a time) to avoid overwhelming the API.
 */
async function enrichInstancesWithRealStatus(instances: EvolutionInstance[]): Promise<void> {
  const BATCH_SIZE = 5;

  for (let i = 0; i < instances.length; i += BATCH_SIZE) {
    const batch = instances.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (inst) => {
        try {
          const response = await evolutionFetch('/instance/status', {}, inst.id, inst.token);
          const data = await response.json();
          const status = data.data || data;

          // CRITICAL FIX: An instance is only truly connected when BOTH Connected AND LoggedIn are true.
          // In Evolution Go v3:
          //   Connected=true, LoggedIn=true  → Actually online and connected (open)
          //   Connected=true, LoggedIn=false → Has a stored session but NOT currently connected.
          //     The dashboard shows this as "Desconectado". Treating it as "open" causes the bug
          //     where the website shows chips as connected when they're actually disconnected.
          //   Connected=false → No session at all (close)
          const realConnected = !!(status.Connected && status.LoggedIn);

          inst.connected = realConnected;
          inst.connectionStatus = (realConnected ? 'open' : 'close') as 'open' | 'close' | 'connecting';

          // Also update profileName if available
          if (status.Name) {
            inst.profileName = status.Name;
          }
        } catch {
          // If /instance/status fails, keep the /instance/all value
        }
      })
    );
  }
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
 *
 * If the instance has "QR code limit reached" or is in a stuck state,
 * we disconnect first to reset the session, then reconnect.
 */
export async function connectInstance(
  instanceIdOrName: string,
  webhookUrl?: string,
  subscribeEvents?: string[]
): Promise<ConnectResult> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  // Check if instance is already logged in — no need to reconnect
  try {
    const statusResponse = await evolutionFetch('/instance/status', {}, instanceId, instanceToken);
    const statusData = await statusResponse.json();
    const status = statusData.data || statusData;

    console.log(`[connectInstance] Status check for ${instanceIdOrName}: Connected=${status.Connected}, LoggedIn=${status.LoggedIn}`);

    if (status.Connected && status.LoggedIn) {
      // Already logged in — update webhook via /instance/connect if needed.
      // NOTE: Calling /instance/connect on an already-Connected+LoggedIn instance
      // is safe — it simply updates the webhook configuration without disrupting
      // the active session or generating a new QR code.
      if (webhookUrl) {
        try {
          await evolutionFetch('/instance/connect', {
            method: 'POST',
            body: JSON.stringify({
              webhookUrl,
              subscribe: subscribeEvents || [
                'MESSAGE', 'SEND_MESSAGE', 'SEND_MESSAGE_ACK', 'READ_RECEIPT', 'PRESENCE',
                'CHAT_PRESENCE', 'CALL', 'CONNECTION', 'QRCODE',
                'LABEL', 'CONTACT', 'GROUP', 'MESSAGES_UPDATE',
              ],
              immediate: true,
            }),
          }, instanceId, instanceToken);
        } catch {
          // Webhook update failed — not critical
        }
      }

      return {
        state: 'open',
        instanceName: instanceIdOrName,
        instanceId: instanceId,
        qrcode: null,
        code: null,
        pairingCode: null,
      };
    }

    // NOTE: We do NOT auto-disconnect when Connected && !LoggedIn anymore.
    // The previous logic would disconnect instances that were waiting for QR scan,
    // which invalidated the QR code and caused the "QR code vanishes" bug.
    // If a disconnect is needed, it should be done explicitly by the caller.
  } catch {
    // Status check failed — proceed with connect anyway
  }

  // BUG FIX: subscribe must ALWAYS be sent in /instance/connect, even without webhookUrl.
  // Evolution Go v3 ignores the `events` field in POST /instance/create — the only way
  // to register events is via the `subscribe` field in POST /instance/connect.
  // Without subscribe, the instance gets events="" and cannot generate QR codes or
  // deliver webhook events, leaving it in a broken "client disconnected" state.
  const DEFAULT_SUBSCRIBE_EVENTS = [
    'MESSAGE',
    'SEND_MESSAGE',
    'SEND_MESSAGE_ACK',
    'READ_RECEIPT',
    'PRESENCE',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'QRCODE',
    'LABEL',
    'CONTACT',
    'GROUP',
    'MESSAGES_UPDATE',
  ];

  const body: any = {
    immediate: true,
    subscribe: subscribeEvents || DEFAULT_SUBSCRIBE_EVENTS,
  };

  if (webhookUrl) {
    body.webhookUrl = webhookUrl;
  }

  const response = await evolutionFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceId, instanceToken);

  const data = await response.json();

  const result = data.data || data;

  // After calling /instance/connect, check the result.
  //
  // CRITICAL ARCHITECTURE DECISION:
  // We do NOT verify against /instance/status after /instance/connect returns a jid.
  // Here's why:
  //
  // 1. When /instance/connect returns a jid, it means Evolution Go has a stored session.
  // 2. The session might be in one of these states:
  //    a) Connected=true, LoggedIn=true  → fully active session (state=open)
  //    b) Connected=true, LoggedIn=false → WebSocket connected, session restoring (state=connecting)
  //    c) Connected=false                → dead/stale session (state=close)
  //
  // 3. State (b) is the CRITICAL case: this happens AFTER a QR code scan!
  //    The WhatsApp handshake takes a few seconds, and during that time
  //    Connected=true but LoggedIn=false. If we call /instance/status during
  //    this window and see !LoggedIn, we'd incorrectly think it's stale and
  //    DISCONNECT it — killing the active connection the user just scanned!
  //
  // 4. Instead of verifying here, we TRUST the /instance/connect response:
  //    - If it returns a jid → assume the session is being restored → return 'open'
  //    - The webhook will confirm via 'Connected' event if the session is truly active
  //    - The connect route's polling will catch the actual state via /instance/status
  //
  // This prevents the race condition where we disconnect an active session
  // that's still in the handshake phase.

  if (result.jid) {
    console.log(`[connectInstance] Instance ${instanceIdOrName} returned jid=${result.jid} from /instance/connect. Treating as connected (session restored or restoring).`);
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
 *
 * Handles common errors:
 * - "session already logged in" → returns state 'open' (already connected)
 * - "no QR code available" → returns null QR (still generating)
 */
export async function getInstanceQRCode(instanceIdOrName: string): Promise<ConnectResult> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const response = await evolutionFetch('/instance/qr', {}, instanceId, instanceToken);
    const data = await response.json();

    // Handle "session already logged in" error — instance is actually connected
    if (data.error === 'session already logged in') {
      return {
        qrcode: null,
        code: null,
        pairingCode: null,
        state: 'open',
        instanceName: instanceIdOrName,
        instanceId: instanceId,
      };
    }

    const qrData = data.data || data;
    return {
      qrcode: qrData.Qrcode || null,
      code: qrData.Code || null,
      pairingCode: null,
      state: 'close',
      instanceName: instanceIdOrName,
      instanceId: instanceId,
    };
  } catch (err: any) {
    // Check if the error message contains "session already logged in"
    const errMsg = err?.message || String(err)
    if (errMsg.includes('session already logged in') || errMsg.includes('already logged in')) {
      return {
        qrcode: null,
        code: null,
        pairingCode: null,
        state: 'open',
        instanceName: instanceIdOrName,
        instanceId: instanceId,
      };
    }

    // Handle "QR code limit reached" — disconnect and reconnect to reset counter
    if (errMsg.includes('QR code limit reached')) {
      console.log(`[QR] QR code limit reached for ${instanceIdOrName}, disconnecting and reconnecting...`);
      try {
        await evolutionFetch('/instance/disconnect', {
          method: 'POST',
        }, instanceId, instanceToken);
        await new Promise(r => setTimeout(r, 1500));

        // Reconnect to get a fresh session with reset QR counter
        await evolutionFetch('/instance/connect', {
          method: 'POST',
          body: JSON.stringify({ immediate: true }),
        }, instanceId, instanceToken);
        await new Promise(r => setTimeout(r, 2000));

        // Try fetching QR code again after reconnect
        const retryResponse = await evolutionFetch('/instance/qr', {}, instanceId, instanceToken);
        const retryData = await retryResponse.json();
        const retryQr = retryData.data || retryData;
        return {
          qrcode: retryQr.Qrcode || null,
          code: retryQr.Code || null,
          pairingCode: null,
          state: 'connecting',
          instanceName: instanceIdOrName,
          instanceId: instanceId,
        };
      } catch (retryErr) {
        console.error(`[QR] Failed to reset QR limit for ${instanceIdOrName}:`, retryErr);
      }
    }

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

    // CRITICAL FIX: An instance is only truly connected when BOTH Connected AND LoggedIn are true.
    // In Evolution Go v3:
    //   Connected: true + LoggedIn: true  → WhatsApp session is fully active (open)
    //   Connected: true + LoggedIn: false → Has stored session but NOT currently connected.
    //     The Evolution API dashboard shows this as "Desconectado/close".
    //     Treating it as 'open' was causing the bug where the website showed chips as
    //     connected when they were actually disconnected.
    //   Connected: false → Disconnected (close)
    const state: 'open' | 'close' | 'connecting' =
      (status.Connected && status.LoggedIn) ? 'open' :
      'close'

    return {
      data: status,
      state,
      instance: {
        instanceName: instanceIdOrName,
        state,
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
    linkPreview: options?.linkPreview ?? false,
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

// ============ Group Metadata ============

/**
 * Fetch group metadata (name, subject, participants) from Evolution API.
 * GET /group/fetchMetadata with { groupJid } (instanceId header)
 * Evolution Go v3 endpoint for group info.
 */
export async function fetchGroupMetadata(
  instanceIdOrName: string,
  groupJid: string
): Promise<{ subject: string; participants: number; id: string } | null> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const res = await evolutionFetch(`/group/fetchMetadata?groupJid=${encodeURIComponent(groupJid)}`, {
      method: 'GET',
    }, instanceId, instanceToken);

    if (!res.ok) return null;

    const data = await res.json();
    return {
      subject: data?.subject || data?.name || data?.Subject || data?.Name || null,
      participants: data?.participants?.length || data?.size || 0,
      id: data?.id || groupJid,
    };
  } catch {
    return null;
  }
}

// ============ Chat Management ============

/**
 * Fetch all chats from Evolution API for an instance.
 * Returns chat list with archived status — used to filter out archived
 * conversations from the inbox.
 *
 * Evolution API endpoint: POST /chat/fetchChats/{instance}
 * Response: Array of chat objects with `id`, `archived`, `lastMsg`, etc.
 */
export async function fetchChats(
  instanceIdOrName: string
): Promise<Array<{ id: string; archived?: boolean; remoteJid?: string; name?: string }>> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const res = await evolutionFetch(`/chat/fetchChats`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, instanceId, instanceToken);

    if (!res.ok) return [];

    const data = await res.json();
    // Response can be an array directly or wrapped in a field
    const chats = Array.isArray(data) ? data : (data?.chats || data?.result || []);

    return chats.map((chat: Record<string, unknown>) => ({
      id: String(chat.id || ''),
      archived: Boolean(chat.archived),
      remoteJid: String(chat.id || chat.remoteJid || chat.jid || ''),
      name: String(chat.name || chat.subject || chat.pushName || ''),
    }));
  } catch {
    return [];
  }
}

/**
 * Get the set of archived chat JIDs for a specific instance.
 * Used by the inbox to filter out archived conversations.
 * Returns a Set of remoteJid strings for fast lookup.
 */
export async function getArchivedChatJids(instanceIdOrName: string): Promise<Set<string>> {
  const chats = await fetchChats(instanceIdOrName);
  const archived = new Set<string>();
  for (const chat of chats) {
    if (chat.archived && chat.remoteJid) {
      archived.add(chat.remoteJid);
    }
  }
  return archived;
}

/**
 * Get all chat JIDs with their archived status and names.
 * Used to extract group names from the chat list as a fallback
 * when fetchGroupMetadata fails.
 */
export async function getArchivedChatJidsWithNames(
  instanceIdOrName: string
): Promise<Map<string, { archived: boolean; name: string }>> {
  const chats = await fetchChats(instanceIdOrName);
  const result = new Map<string, { archived: boolean; name: string }>();
  for (const chat of chats) {
    if (chat.remoteJid) {
      result.set(chat.remoteJid, {
        archived: chat.archived ?? false,
        name: chat.name || '',
      });
    }
  }
  return result;
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
    // Evolution Go API rejects empty passwords for proxy config.
    // If no password is set, fall through to WireGuard auto-detect (step 2)
    // instead of returning null, so that chips with WireGuard IPs still get proxy.
    if (chip.socks5Pass) {
      return {
        enabled: true,
        host: chip.socks5Host,
        port: String(chip.socks5Port),
        username: chip.socks5User || '',
        password: chip.socks5Pass,
      }
    }
    // Fall through to WireGuard auto-detect if SOCKS5 config is incomplete
  }

  // 2) Auto-detect: chip has WireGuard IP → Every Proxy on the phone
  //    Every Proxy on Android always runs on port 8084 for SOCKS5.
  //    We ignore the socksPort from the database because Every Proxy
  //    uses the same default port on every phone — there's no per-chip
  //    port assignment needed for phone-based proxies.
  //    Evolution Go API requires a non-empty password for proxy config.
  //    If no socks5Pass is set, use 'none' as a placeholder (Every Proxy
  //    doesn't require authentication by default, but Evolution Go needs
  //    a non-empty password field).
  if (chip.wireguardIp) {
    return {
      enabled: true,
      host: chip.wireguardIp,
      port: '8084',
      username: chip.socks5User || 'none',
      password: chip.socks5Pass || 'none',
    }
  }

  // 3) Global SOCKS5 proxy from Settings (auto-applies to all chips)
  if (globalProxy && globalProxy.enabled && globalProxy.host && globalProxy.port && globalProxy.password) {
    return globalProxy
  }

  // 4) No proxy available
  return null
}

/**
 * Set proxy on an instance AFTER creation using POST /instance/proxy/{instanceId}.
 *
 * CRITICAL: Proxy must NOT be set at instance creation time because:
 *   1. The proxy (WireGuard/SOCKS5) may be unreachable from the Evolution Go server
 *   2. Adding proxy at creation prevents the instance from connecting to WhatsApp
 *   3. This blocks QR code generation entirely
 *
 * Instead, create the instance WITHOUT proxy, connect it (get QR code),
 * then add the proxy via this function after the instance is connected.
 *
 * The POST /instance/proxy/{instanceId} endpoint accepts:
 *   { host, port, username, password, protocol }
 * Protocol defaults to "http" — must explicitly set "socks5" for WireGuard proxies.
 */
export async function setProxy(
  instanceIdOrName: string,
  proxy: {
    enabled: boolean;
    host: string;
    port: string;
    username: string;
    password: string;
    protocol?: string;
  }
): Promise<void> {
  const { id: instanceId } = await resolveInstance(instanceIdOrName);

  // If proxy is being disabled, delete the proxy configuration
  if (!proxy.enabled) {
    try {
      await evolutionFetch(`/instance/proxy/${instanceId}`, {
        method: 'DELETE',
      });
    } catch {
      // Silently ignore — proxy removal is not critical
    }
    return;
  }

  // Set proxy via POST /instance/proxy/{instanceId}
  // Uses the GLOBAL API key (not instance token) — confirmed working via API testing.
  // The protocol field defaults to "http" in Evolution Go — we MUST explicitly
  // pass "socks5" for WireGuard/Every Proxy configurations.
  await evolutionFetch(`/instance/proxy/${instanceId}`, {
    method: 'POST',
    body: JSON.stringify({
      host: proxy.host,
      port: proxy.port,
      username: proxy.username || 'none',
      password: proxy.password || 'none',
      protocol: proxy.protocol || 'socks5',
    }),
  });

  console.log(`[Evolution Go] Proxy set for ${instanceIdOrName}: ${proxy.protocol || 'socks5'}://${proxy.host}:${proxy.port}`);
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
    'SEND_MESSAGE_ACK',
    'READ_RECEIPT',
    'PRESENCE',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'QRCODE',
    'LABEL',
    'CONTACT',
    'GROUP',
    'MESSAGES_UPDATE',
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

// ============ Chat Read Receipts ============

/**
 * Mark a chat as read on the WhatsApp side.
 * POST /chat/markChatAsRead with { remoteJid } (instanceId header)
 * This tells WhatsApp that the operator has read the messages,
 * so the sender sees blue ✓✓ on their device.
 *
 * Evolution Go v3 endpoint for read receipts.
 */
export async function markChatAsRead(
  instanceIdOrName: string,
  remoteJid: string
): Promise<boolean> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const res = await evolutionFetch('/chat/markChatAsRead', {
      method: 'POST',
      body: JSON.stringify({ remoteJid }),
    }, instanceId, instanceToken);

    if (!res.ok) {
      console.warn(`[markChatAsRead] Failed for ${remoteJid}: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[markChatAsRead] Error for ${remoteJid}:`, err);
    return false;
  }
}

// ============ Quoted Reply (contextInfo) ============

/**
 * Send a text message as a reply (quoted message) with contextInfo.
 * POST /send/text with { number, text, delay, linkPreview, quoted } (instanceId header)
 *
 * The `quoted` field contains the message ID being replied to.
 * Evolution Go v3 supports this via the `quoted` parameter.
 */
export async function sendQuotedReply(
  instanceIdOrName: string,
  number: string,
  text: string,
  quotedMsgId: string,
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
    linkPreview: options?.linkPreview ?? false,
    quoted: {
      key: {
        id: quotedMsgId,
      },
    },
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

// ============ Fetch Profile Picture ============

/**
 * Fetch a contact's profile picture URL from Evolution API.
 * POST /chat/fetchProfilePicture with { number } (instanceId header)
 * Returns the profile picture URL or null.
 */
export async function fetchProfilePicture(
  instanceIdOrName: string,
  number: string
): Promise<string | null> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  try {
    const res = await evolutionFetch('/chat/fetchProfilePicture', {
      method: 'POST',
      body: JSON.stringify({ number }),
    }, instanceId, instanceToken);

    if (!res.ok) return null;

    const data = await res.json();
    return data?.profilePictureUrl || data?.url || data?.data?.profilePictureUrl || null;
  } catch {
    return null;
  }
}

// ============ Number Verification ============

/**
 * Check if phone numbers exist on WhatsApp.
 * POST /user/check with { number: [...] } (instanceId header)
 * Official docs: https://docs.evolutionfoundation.com.br/en/evolution-go/check-a-user
 * Returns { data: { Users: [{ Query, IsInWhatsapp, JID, RemoteJID, LID, VerifiedName }] }, message: "success" }
 */
export async function checkWhatsAppNumbers(
  instanceIdOrName: string,
  numbers: string[]
): Promise<Array<{ query: string; exists: boolean; jid: string }>> {
  const { id: instanceId, token: instanceToken } = await resolveInstance(instanceIdOrName);

  const response = await evolutionFetch('/user/check', {
    method: 'POST',
    body: JSON.stringify({ number: numbers }),
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
const instanceCacheTimestamps = new Map<string, number>();
const INSTANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — tokens can change on Evolution server restart

export function clearInstanceIdCache(): void {
  instanceCache.clear();
  instanceCacheTimestamps.clear();
}

/**
 * Invalidate cached instance info for a specific instance.
 * Called when we get a 403 from the Evolution API — the token may have changed.
 */
function invalidateInstanceCache(nameOrId: string): void {
  instanceCache.delete(nameOrId);
  instanceCacheTimestamps.delete(nameOrId);
}

/**
 * Resolve an instance name (or UUID) to its UUID + token.
 * This fetches /instance/all using the GLOBAL API key and finds the matching instance.
 * The returned token is required for ALL subsequent instance-scoped API calls.
 */
async function resolveInstance(nameOrId: string, forceRefresh: boolean = false): Promise<ResolvedInstance> {
  // Check cache first (with TTL — tokens can change on Evolution server restart)
  if (!forceRefresh && instanceCache.has(nameOrId)) {
    const cachedAt = instanceCacheTimestamps.get(nameOrId) || 0
    const age = Date.now() - cachedAt
    if (age < INSTANCE_CACHE_TTL_MS) {
      return instanceCache.get(nameOrId)!;
    }
    // Cache expired — clear it
    instanceCache.delete(nameOrId)
    instanceCacheTimestamps.delete(nameOrId)
  }

  // Fetch all instances (uses global API key)
  try {
    const instances = await fetchInstances();

    // Find by name or by ID
    const instance = instances.find(i => i.name === nameOrId || i.id === nameOrId);
    if (instance && instance.id) {
      const resolved = { id: instance.id, token: instance.token };
      const now = Date.now()
      instanceCache.set(nameOrId, resolved);
      instanceCacheTimestamps.set(nameOrId, now);
      // Also cache by name if we searched by ID
      if (instance.name !== nameOrId) {
        instanceCache.set(instance.name, resolved);
        instanceCacheTimestamps.set(instance.name, now);
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
 * Evolution Go: { host, port, username, password, protocol }
 */
export function toEvolutionGoProxy(proxy: {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  password: string;
} | null): { host: string; port: string; username: string; password: string; protocol: string } | undefined {
  if (!proxy || !proxy.enabled) return undefined;
  // Evolution Go API requires non-empty password and uses 'host' (not 'address')
  if (!proxy.password) return undefined;
  return {
    host: proxy.host,
    port: proxy.port,
    username: proxy.username || 'none',
    password: proxy.password,
    protocol: 'socks5',
  };
}
