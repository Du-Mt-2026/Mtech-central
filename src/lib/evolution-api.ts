// Evolution API Service Layer
// Handles all communication with the Evolution API (WhatsApp Baileys)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

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

async function evolutionFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${EVOLUTION_API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_API_KEY,
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
  return `OctupusZap_${sanitizedName}_${shortId}`;
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
  const instances = await fetchInstances();
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
