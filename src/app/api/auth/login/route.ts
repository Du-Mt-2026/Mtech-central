import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword, createToken, setSessionCookie } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username e password são obrigatórios' },
        { status: 400 }
      )
    }

    // Check if any admin user exists — if not, auto-create from env vars
    let adminUser = await db.adminUser.findFirst()

    if (!adminUser) {
      // Auto-create the admin user on first login attempt
      const defaultUsername = process.env.ADMIN_USERNAME || 'admin'
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123'

      const hashedPassword = await hashPassword(defaultPassword)
      adminUser = await db.adminUser.create({
        data: {
          username: defaultUsername,
          password: hashedPassword,
        },
      })
      console.log(`[Auth] Auto-created admin user: ${defaultUsername}`)
    }

    // Validate credentials
    if (username !== adminUser.username) {
      return NextResponse.json(
        { error: 'Credenciais inválidas' },
        { status: 401 }
      )
    }

    const isValid = await verifyPassword(password, adminUser.password)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Credenciais inválidas' },
        { status: 401 }
      )
    }

    // Create JWT token
    const token = await createToken({
      userId: adminUser.id,
      username: adminUser.username,
    })

    // Set session cookie
    const cookieConfig = setSessionCookie(token)
    const response = NextResponse.json({
      success: true,
      user: { id: adminUser.id, username: adminUser.username },
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
