import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword, createToken, setSessionCookie } from '@/lib/auth'

// ─── Brute force protection ───────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>()

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}

function isLockedOut(ip: string): boolean {
  const entry = loginAttempts.get(ip)
  if (!entry) return false
  const now = Date.now()
  if (now - entry.lastAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILED_ATTEMPTS
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (entry && now - entry.lastAttempt < LOCKOUT_WINDOW_MS) {
    entry.count++
    entry.lastAttempt = now
  } else {
    loginAttempts.set(ip, { count: 1, lastAttempt: now })
  }
  for (const [key, val] of loginAttempts) {
    if (now - val.lastAttempt > LOCKOUT_WINDOW_MS) loginAttempts.delete(key)
  }
}

function resetAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)

    if (isLockedOut(ip)) {
      return NextResponse.json(
        { error: 'Muitas tentativas de login falharam. Tente novamente em 5 minutos.' },
        { status: 429 }
      )
    }

    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email e senha são obrigatórios' },
        { status: 400 }
      )
    }

    // Auto-create master user on first login if no users exist
    const userCount = await db.adminUser.count()
    if (userCount === 0) {
      const defaultEmail = process.env.ADMIN_EMAIL || 'admin@mtech.com'
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123'
      const defaultName = process.env.ADMIN_NAME || 'Master'

      const hashedPw = await hashPassword(defaultPassword)
      await db.adminUser.create({
        data: {
          name: defaultName,
          email: defaultEmail,
          password: hashedPw,
          role: 'master',
          active: true,
          mustChangePassword: true,
        },
      })
      console.log(`[Auth] Auto-created master user: ${defaultEmail}`)
    }

    const adminUser = await db.adminUser.findUnique({
      where: { email },
    })

    if (!adminUser) {
      recordFailedAttempt(ip)
      return NextResponse.json(
        { error: 'Email ou senha incorretos. Verifique seus dados e tente novamente.' },
        { status: 401 }
      )
    }

    if (!adminUser.active) {
      return NextResponse.json(
        { error: 'Conta desativada. Contate um administrador.' },
        { status: 403 }
      )
    }

    const isValid = await verifyPassword(password, adminUser.password)
    if (!isValid) {
      recordFailedAttempt(ip)
      return NextResponse.json(
        { error: 'Email ou senha incorretos. Verifique seus dados e tente novamente.' },
        { status: 401 }
      )
    }

    resetAttempts(ip)

    const token = await createToken({
      userId: adminUser.id,
      username: adminUser.name,
      role: adminUser.role,
    })

    const cookieConfig = setSessionCookie(token)
    const response = NextResponse.json({
      success: true,
      user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role },
      mustChangePassword: adminUser.mustChangePassword,
    })
    response.cookies.set(cookieConfig.name, cookieConfig.value, cookieConfig.options)

    return response
  } catch (error: any) {
    console.error('[Auth] Login error:', error)

    const msg = error.message || ''
    if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') ||
        msg.includes('P1001') || msg.includes('P1002') || msg.includes('P1003') ||
        msg.includes('no such table') || msg.includes('does not exist') ||
        msg.includes('Can\'t reach database server') || msg.includes('database')) {
      return NextResponse.json(
        { error: 'Erro de conexão com o banco de dados. Tente novamente em alguns segundos.' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: 'Erro interno do servidor. Tente novamente.' },
      { status: 500 }
    )
  }
}
