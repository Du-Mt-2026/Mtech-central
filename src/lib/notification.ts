/**
 * Notification Helper — notificações com rate limiting
 *
 * Suporte a:
 *   - Webhook configurável (Slack, Discord, Telegram, etc.)
 *   - Rate limiting por chave (evita spam)
 *   - Filtragem por severidade (info, warning, critical)
 *
 * Uso:
 *   import { notify } from '@/lib/notification'
 *   await notify({
 *     title: 'Chip desconectado',
 *     message: 'MTech Promo Mari desconectado há 15 min',
 *     severity: 'warning',
 *     key: 'chip-disconnect-mari',  // para rate limiting
 *   })
 *
 * Configuração via .env:
 *   NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/...
 *   NOTIFICATION_RATE_LIMIT_MS=300000  // 5 min (default)
 */

interface NotificationData {
  title: string
  message: string
  severity?: 'info' | 'warning' | 'critical'
  /** Chave única para rate limiting. Mesma chave = mesma notificação. */
  key: string
  /** Dados extras para o webhook (opcional) */
  details?: Record<string, any>
}

// Cache em memória para rate limiting
// Mapa: key -> { count, firstSent, lastSent }
const notificationCache = new Map<string, { count: number; firstSent: number; lastSent: number }>()

const RATE_LIMIT_MS = parseInt(process.env.NOTIFICATION_RATE_LIMIT_MS || '300000', 10) // 5 min default
const RATE_LIMIT_MAX_PER_WINDOW = 3 // máx 3 notificações por chave por janela

/**
 * Verifica se uma notificação pode ser enviada (rate limiting).
 */
function canSend(key: string): { allowed: boolean; reason?: string } {
  const now = Date.now()
  const cached = notificationCache.get(key)

  if (!cached) {
    return { allowed: true }
  }

  // Reset se a janela expirou
  if (now - cached.firstSent > RATE_LIMIT_MS) {
    notificationCache.delete(key)
    return { allowed: true }
  }

  // Se já enviou demais na janela, bloqueia
  if (cached.count >= RATE_LIMIT_MAX_PER_WINDOW) {
    return { allowed: false, reason: `Rate limit: ${cached.count} notificações em ${Math.round((now - cached.firstSent) / 1000)}s` }
  }

  // Se enviou há menos de RATE_LIMIT_MS/3, bloqueia (evita rajadas)
  const minIntervalMs = Math.max(60000, Math.floor(RATE_LIMIT_MS / 3)) // mín 1 min entre notificações da mesma chave
  if (now - cached.lastSent < minIntervalMs) {
    return { allowed: false, reason: `Muito recente (última há ${Math.round((now - cached.lastSent) / 1000)}s)` }
  }

  return { allowed: true }
}

/**
 * Registra que uma notificação foi enviada.
 */
function recordSent(key: string) {
  const now = Date.now()
  const cached = notificationCache.get(key)
  if (cached && now - cached.firstSent < RATE_LIMIT_MS) {
    cached.count++
    cached.lastSent = now
  } else {
    notificationCache.set(key, { count: 1, firstSent: now, lastSent: now })
  }
}

/**
 * Limpa cache expirado (deve ser chamado periodicamente).
 */
export function cleanupNotificationCache() {
  const now = Date.now()
  for (const [key, val] of notificationCache.entries()) {
    if (now - val.firstSent > RATE_LIMIT_MS * 2) {
      notificationCache.delete(key)
    }
  }
}

/**
 * Envia uma notificação via webhook configurável.
 * Rate-limited por chave para evitar spam.
 *
 * @returns true se enviou, false se bloqueou por rate limit ou erro
 */
export async function notify(data: NotificationData): Promise<boolean> {
  const { title, message, severity = 'info', key, details } = data

  // 1. Verificar rate limiting
  const check = canSend(key)
  if (!check.allowed) {
    console.log(`[Notification] Bloqueada (${key}): ${check.reason}`)
    return false
  }

  // 2. Log sempre (mesmo se webhook não configurado)
  const logPrefix = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'
  console.log(`[Notification] ${logPrefix} ${title}: ${message}`)

  // 3. Enviar para webhook se configurado
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL
  if (!webhookUrl) {
    // Sem webhook — só log. Não conta no rate limit.
    return true
  }

  try {
    // Formato compatível com Slack Incoming Webhooks
    // (Discord e Telegram também aceitam formatos similares)
    const payload = formatWebhookPayload(title, message, severity, details)

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    if (!response.ok) {
      console.error(`[Notification] Webhook retornou ${response.status}: ${await response.text()}`)
      return false
    }

    recordSent(key)
    return true
  } catch (error) {
    console.error('[Notification] Erro ao enviar webhook:', error)
    return false
  }
}

/**
 * Formata payload para diferentes tipos de webhook.
 * Detecta automaticamente baseado na URL.
 */
function formatWebhookPayload(
  title: string,
  message: string,
  severity: 'info' | 'warning' | 'critical',
  details?: Record<string, any>
): Record<string, any> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL || ''
  const emoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'
  const color = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#f59e0b' : '#3b82f6'

  // Slack incoming webhook
  if (webhookUrl.includes('hooks.slack.com')) {
    return {
      text: `${emoji} ${title}`,
      attachments: [{
        color,
        text: message,
        fields: details ? Object.entries(details).map(([k, v]) => ({
          title: k,
          value: String(v),
          short: true,
        })) : undefined,
        ts: Math.floor(Date.now() / 1000),
      }],
    }
  }

  // Discord webhook
  if (webhookUrl.includes('discord.com/api/webhooks')) {
    return {
      content: `${emoji} **${title}**`,
      embeds: [{
        description: message,
        color: parseInt(color.replace('#', ''), 16),
        fields: details ? Object.entries(details).map(([k, v]) => ({
          name: k,
          value: String(v),
          inline: true,
        })) : undefined,
        timestamp: new Date().toISOString(),
      }],
    }
  }

  // Telegram bot API
  if (webhookUrl.includes('api.telegram.org')) {
    let text = `${emoji} *${title}*\n\n${message}`
    if (details) {
      text += '\n\n' + Object.entries(details).map(([k, v]) => `• ${k}: ${v}`).join('\n')
    }
    return {
      chat_id: process.env.NOTIFICATION_TELEGRAM_CHAT_ID || '',
      text,
      parse_mode: 'Markdown',
    }
  }

  // Default: formato genérico JSON
  return {
    title: `${emoji} ${title}`,
    message,
    severity,
    details,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper para notificar chip desconectado.
 * Rate-limited por chipId (1 notificação a cada 5 min por chip).
 */
export async function notifyChipDisconnected(chipName: string, phoneNumber: string, chipId: string, lastSeen?: Date | null) {
  const minutesAgo = lastSeen ? Math.round((Date.now() - lastSeen.getTime()) / 60000) : null
  await notify({
    title: 'Chip desconectado',
    message: `${chipName} (${phoneNumber}) está desconectado${minutesAgo ? ` há ${minutesAgo} min` : ''}`,
    severity: 'warning',
    key: `chip-disconnect-${chipId}`,
    details: {
      chip: chipName,
      telefone: phoneNumber,
      'desconectado há (min)': minutesAgo || 'desconhecido',
    },
  })
}

/**
 * Helper para notificar campanha travada (sem progresso há mais de 30 min).
 */
export async function notifyCampaignStuck(campaignName: string, campaignId: string, pendingCount: number, lastProgressAt?: Date | null) {
  const minutesAgo = lastProgressAt ? Math.round((Date.now() - lastProgressAt.getTime()) / 60000) : null
  await notify({
    title: 'Campanha travada',
    message: `${campaignName} tem ${pendingCount} mensagens pendentes${minutesAgo ? ` sem progresso há ${minutesAgo} min` : ''}`,
    severity: 'warning',
    key: `campaign-stuck-${campaignId}`,
    details: {
      campanha: campaignName,
      pendentes: pendingCount,
      'sem progresso há (min)': minutesAgo || 'desconhecido',
    },
  })
}

/**
 * Helper para notificar falha de backup.
 */
export async function notifyBackupFailed(error: string) {
  await notify({
    title: 'Backup falhou',
    message: `O backup automático do PostgreSQL falhou: ${error}`,
    severity: 'critical',
    key: 'backup-failed',
    details: {
      erro: error,
    },
  })
}

/**
 * Helper para notificar pool do PgBouncer saturado.
 */
export async function notifyPgBouncerSaturated(activeConnections: number, maxConnections: number) {
  await notify({
    title: 'PgBouncer saturado',
    message: `Pool de conexões em ${activeConnections}/${maxConnections} (${Math.round(activeConnections / maxConnections * 100)}%)`,
    severity: 'critical',
    key: 'pgbouncer-saturated',
    details: {
      conexões_ativas: activeConnections,
      máximo: maxConnections,
      utilização: `${Math.round(activeConnections / maxConnections * 100)}%`,
    },
  })
}
