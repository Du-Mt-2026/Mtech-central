import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { logAction } from '@/lib/audit-log'

const AUTH_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || '')
const COOKIE_NAME = 'octupuszap-session'

export interface AuditContext {
  userId?: string
  userName?: string
  userRole?: string
  ipAddress?: string
}

/**
 * Extrai contexto de auditoria (usuario + IP) de um NextRequest.
 *
 * Le o cookie de sessao JWT para identificar o usuario, e le headers
 * x-forwarded-for / x-real-ip / cf-connecting-ip para identificar o IP.
 *
 * Uso:
 *   import { getAuditContext, auditLog } from '@/lib/audit-helper'
 *
 *   export async function POST(req: NextRequest) {
 *     const ctx = await getAuditContext(req)
 *     // ... business logic ...
 *     await auditLog(ctx, {
 *       action: 'CAMPAIGN_STARTED',
 *       category: 'campaign',
 *       targetId: campaignId,
 *       targetType: 'campaign',
 *       details: { messageCount },
 *     })
 *   }
 */
export async function getAuditContext(req: NextRequest): Promise<AuditContext> {
  const ctx: AuditContext = {}

  // Extract IP (works behind Traefik/Cloudflare or direct)
  ctx.ipAddress =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined

  // Extract user from session cookie
  try {
    const token = req.cookies.get(COOKIE_NAME)?.value
    if (token) {
      const { payload } = await jwtVerify(token, AUTH_SECRET)
      ctx.userId = payload.userId as string
      ctx.userName = payload.username as string
      ctx.userRole = payload.role as string
    }
  } catch {
    // Token invalid or missing — return ctx without user (anonymous/system request)
  }

  return ctx
}

/**
 * Wrapper para logAction que preenche automaticamente userId/userName/userRole/ipAddress
 * a partir do AuditContext extraido da request.
 *
 * Mantem o comportamento silencioso do logAction (falhas nao quebram o fluxo).
 */
export async function auditLog(
  ctx: AuditContext,
  data: {
    action: string
    category?: string
    targetId?: string
    targetType?: string
    details?: Record<string, any>
  }
): Promise<void> {
  await logAction({
    userId: ctx.userId,
    userName: ctx.userName,
    userRole: ctx.userRole,
    ipAddress: ctx.ipAddress,
    ...data,
  })
}
