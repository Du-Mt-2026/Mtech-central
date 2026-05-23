import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const COOKIE_NAME = 'octupuszap-session'
const AUTH_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || '')

// Routes that don't require authentication (external services call these)
const PUBLIC_API_ROUTES = [
  '/api/auth/',                // Login/logout/session/reset-password/seed-users
  '/api/setup/',               // Schema sync (protected by secret in request body)
  '/api/whatsapp/webhook',     // Evolution API webhook callbacks
  '/api/campaigns/process-all', // cron-job.org endpoint (protected by CRON_SECRET in code — NOT session cookie)
  '/api/upload/serve',         // Serves uploaded media files (needs to be public so Evolution API can fetch media URLs)
]

// Role hierarchy: master > admin > operador
const ROLE_LEVELS: Record<string, number> = { master: 3, admin: 2, operador: 1 }

// API routes that require minimum role level
const ROLE_PROTECTED_ROUTES: Array<{ pattern: RegExp; minRole: string }> = [
  { pattern: /^\/api\/vps-setup/, minRole: 'master' },
  { pattern: /^\/api\/settings/, minRole: 'master' },
  { pattern: /^\/api\/auth\/change-password/, minRole: 'operador' }, // any logged-in user
  { pattern: /^\/api\/antiban/, minRole: 'admin' },
  { pattern: /^\/api\/users/, minRole: 'master' },
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Allow public routes without authentication
  if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Check for session cookie
  const token = req.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.json(
      { error: 'Não autenticado', authenticated: false },
      { status: 401 }
    )
  }

  try {
    // Verify JWT token
    const { payload } = await jwtVerify(token, AUTH_SECRET)
    const userRole = (payload.role as string) || 'operador'

    // Check role-based access for protected routes
    for (const route of ROLE_PROTECTED_ROUTES) {
      if (route.pattern.test(pathname)) {
        const userLevel = ROLE_LEVELS[userRole] || 0
        const requiredLevel = ROLE_LEVELS[route.minRole] || 0
        if (userLevel < requiredLevel) {
          return NextResponse.json(
            { error: 'Acesso negado. Permissão insuficiente.' },
            { status: 403 }
          )
        }
      }
    }

    return NextResponse.next()
  } catch {
    // Token is invalid or expired
    return NextResponse.json(
      { error: 'Sessão expirada', authenticated: false },
      { status: 401 }
    )
  }
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
}
