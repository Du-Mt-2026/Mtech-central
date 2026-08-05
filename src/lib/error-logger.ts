/**
 * Error Logger — logging de erros de aplicação com rate limiting
 *
 * Recursos:
 *   - Log estruturado no console (sempre)
 *   - Notificação via webhook para erros críticos (com rate limiting)
 *   - Deduplicação por erro único (message + url)
 *   - Contador de ocorrências (útil para debug)
 *
 * Uso em API routes:
 *   import { logApiError } from '@/lib/error-logger'
 *
 *   export async function GET(req: Request) {
 *     try {
 *       // ... lógica
 *     } catch (error) {
 *       return logApiError(error, req, { context: 'campaigns GET' })
 *     }
 *   }
 *
 * Uso em código não-request:
 *   import { logError } from '@/lib/error-logger'
 *   await logError(error, { context: 'sending-engine', extra: { campaignId } })
 */

import { notify } from '@/lib/notification'

interface ErrorLogData {
  error: Error | unknown
  request?: Request
  context?: string
  extra?: Record<string, any>
}

// Cache para deduplicação e rate limiting
// Mapa: errorKey -> { count, firstSeen, lastNotified }
const errorCache = new Map<string, { count: number; firstSeen: number; lastNotified: number }>()

const RATE_LIMIT_MS = 300000 // 5 min — notificar o mesmo erro no máx a cada 5 min
const MAX_NOTIFICATIONS_PER_WINDOW = 3 // máx 3 notificações por erro único por janela

/**
 * Gera chave única para o erro (message + url ou context).
 */
function getErrorKey(error: Error | unknown, request?: Request): string {
  const message = error instanceof Error ? error.message : String(error)
  const url = request?.url || 'no-request'
  // Normalizar: remover query params e IDs da URL
  const normalizedUrl = url.replace(/\?.+$/, '').replace(/[a-f0-9-]{36}/g, ':id')
  return `${message.slice(0, 100)}::${normalizedUrl}`
}

/**
 * Loga erro no console (sempre) e notifica via webhook (com rate limiting).
 */
export async function logError(data: ErrorLogData): Promise<void> {
  const { error, request, context, extra } = data
  const errorKey = getErrorKey(error, request)

  const now = Date.now()
  const cached = errorCache.get(errorKey)

  // Atualizar cache
  if (cached) {
    cached.count++
  } else {
    errorCache.set(errorKey, { count: 1, firstSeen: now, lastNotified: 0 })
  }
  const current = errorCache.get(errorKey)!

  // 1. Log estruturado no console (SEMPRE)
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined
  const method = request?.method || 'UNKNOWN'
  const url = request?.url || 'no-request'

  console.error(`[ERROR] ${new Date().toISOString()} | ${method} ${url} | ${context || 'no-context'}`, {
    message: errorMessage,
    stack: errorStack,
    count: current.count,
    extra,
  })

  // 2. Notificar via webhook (com rate limiting)
  const shouldNotify = shouldNotifyError(errorKey, current, now)
  if (shouldNotify) {
    current.lastNotified = now
    await notify({
      title: `Erro: ${errorMessage.slice(0, 80)}`,
      message: `${method} ${url}${context ? ` (${context})` : ''}`,
      severity: 'critical',
      key: `error-${errorKey.slice(0, 50)}`,
      details: {
        erro: errorMessage.slice(0, 200),
        método: method,
        url: url.slice(0, 150),
        contexto: context || 'n/a',
        ocorrências: current.count,
        ...(extra || {}),
      },
    })
  }
}

/**
 * Verifica se deve notificar este erro (rate limiting).
 */
function shouldNotifyError(
  errorKey: string,
  cached: { count: number; firstSeen: number; lastNotified: number },
  now: number
): boolean {
  // Reset se a janela expirou
  if (now - cached.firstSeen > RATE_LIMIT_MS) {
    cached.count = 1
    cached.firstSeen = now
    cached.lastNotified = 0
    return true
  }

  // Se já notificou demais na janela, não notificar
  const notificationsInWindow = Math.floor(cached.count / Math.max(1, cached.count - 1)) || 0
  if (notificationsInWindow >= MAX_NOTIFICATIONS_PER_WINDOW) {
    return false
  }

  // Se notificou há menos de RATE_LIMIT_MS, não notificar de novo
  if (cached.lastNotified > 0 && now - cached.lastNotified < RATE_LIMIT_MS) {
    return false
  }

  return true
}

/**
 * Helper para API routes — loga erro e retorna NextResponse com status 500.
 *
 * Uso:
 *   } catch (error) {
 *     return logApiError(error, req, { context: 'campaigns GET' })
 *   }
 */
export async function logApiError(
  error: Error | unknown,
  request?: Request,
  options?: { context?: string; extra?: Record<string, any>; status?: number }
): Promise<Response> {
  const status = options?.status || 500

  await logError({
    error,
    request,
    context: options?.context,
    extra: options?.extra,
  })

  // Não vazar detalhes do erro em produção
  const message = process.env.NODE_ENV === 'production'
    ? 'Erro interno do servidor'
    : error instanceof Error ? error.message : 'Erro desconhecido'

  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

/**
 * Limpa cache de erros expirado (chamar periodicamente).
 */
export function cleanupErrorCache() {
  const now = Date.now()
  for (const [key, val] of errorCache.entries()) {
    if (now - val.firstSeen > RATE_LIMIT_MS * 4) { // 20 min
      errorCache.delete(key)
    }
  }
}
