import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const COOKIE_NAME = 'octupuszap-session'
const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'octupuszap-dev-secret-change-in-production'
)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Allow auth routes without authentication
  if (pathname.startsWith('/api/auth/')) {
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
