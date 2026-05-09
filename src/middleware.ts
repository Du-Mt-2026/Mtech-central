import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const COOKIE_NAME = 'octupuszap-session'
const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'octupuszap-dev-secret-change-in-production'
)

// Routes that don't require authentication (external services call these)
const PUBLIC_API_ROUTES = [
  '/api/auth/',                // Login/logout/session
  '/api/whatsapp/webhook',     // Evolution API webhook callbacks
  '/api/campaigns/process-all', // Vercel Cron job (has its own CRON_SECRET check)
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
    await jwtVerify(token, AUTH_SECRET)
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
