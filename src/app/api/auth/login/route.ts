import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword, createToken, setSessionCookie } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
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
        },
      })
      console.log(`[Auth] Auto-created master user: ${defaultEmail}`)
    }

    // Find user by email
    const adminUser = await db.adminUser.findUnique({
      where: { email },
    })

    if (!adminUser) {
      return NextResponse.json(
        { error: 'Credenciais inválidas' },
        { status: 401 }
      )
    }

    // Check if user is active
    if (!adminUser.active) {
      return NextResponse.json(
        { error: 'Conta desativada. Contate um administrador.' },
        { status: 403 }
      )
    }

    // Validate password
    const isValid = await verifyPassword(password, adminUser.password)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Credenciais inválidas' },
        { status: 401 }
      )
    }

    // Create JWT token with role
    const token = await createToken({
      userId: adminUser.id,
      username: adminUser.name,
      role: adminUser.role,
    })

    // Set session cookie
    const cookieConfig = setSessionCookie(token)
    const response = NextResponse.json({
      success: true,
      user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role },
    })
    response.cookies.set(cookieConfig.name, cookieConfig.value, cookieConfig.options)

    return response
  } catch (error: any) {
    console.error('[Auth] Login error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao fazer login' },
      { status: 500 }
    )
  }
}
