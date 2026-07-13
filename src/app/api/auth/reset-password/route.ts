import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

/**
 * POST /api/auth/reset-password
 * Allows password reset without being logged in.
 *
 * SECURITY FIX: Uses AUTH_SECRET (environment variable) as verification instead
 * of EVOLUTION_API_KEY. The EVOLUTION_API_KEY is visible to operators in the
 * Settings page, which allowed privilege escalation. AUTH_SECRET is only in the
 * server's .env file — only someone with server access can reset passwords.
 *
 * If AUTH_SECRET is not set, the endpoint refuses all requests and directs
 * the user to reset via SSH + CLI command.
 *
 * SECURITY (P1.6): Uses crypto.timingSafeEqual to prevent timing attacks.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { newPassword, verificationKey } = body

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        { error: 'A nova senha deve ter pelo menos 6 caracteres' },
        { status: 400 }
      )
    }

    // SECURITY FIX: Use AUTH_SECRET (from .env) instead of EVOLUTION_API_KEY (visible in UI)
    const AUTH_SECRET = process.env.AUTH_SECRET
    if (!AUTH_SECRET) {
      return NextResponse.json(
        { error: 'Recuperação de senha não configurada. Acesse o servidor via SSH e execute: docker exec octupuszap-app node -e "require(\'./src/lib/auth.ts\').hashPassword(\'novasenha\').then(h => console.log(h))" ou configure AUTH_SECRET no arquivo .env' },
        { status: 503 }
      )
    }

    // SECURITY (P1.6): Verify using crypto.timingSafeEqual
    if (!verificationKey) {
      return NextResponse.json(
        { error: 'Código de segurança inválido. Use o AUTH_SECRET do arquivo .env do servidor.' },
        { status: 401 }
      )
    }

    const secretBuffer = Buffer.from(AUTH_SECRET, 'utf8')
    const providedBuffer = Buffer.from(verificationKey, 'utf8')

    if (secretBuffer.length !== providedBuffer.length) {
      return NextResponse.json(
        { error: 'Código de segurança inválido. Use o AUTH_SECRET do arquivo .env do servidor.' },
        { status: 401 }
      )
    }

    if (!timingSafeEqual(secretBuffer, providedBuffer)) {
      return NextResponse.json(
        { error: 'Código de segurança inválido. Use o AUTH_SECRET do arquivo .env do servidor.' },
        { status: 401 }
      )
    }

    // Find the admin user
    const adminUser = await db.adminUser.findFirst()

    if (!adminUser) {
      // Create master user with the new password
      const hashedPassword = await hashPassword(newPassword)
      await db.adminUser.create({
        data: {
          name: 'Master',
          email: 'admin@mtech.com',
          password: hashedPassword,
          role: 'master',
          active: true,
        },
      })
    } else {
      // Update the existing admin password
      const hashedPassword = await hashPassword(newPassword)
      await db.adminUser.update({
        where: { id: adminUser.id },
        data: { password: hashedPassword },
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Senha redefinida com sucesso',
    })
  } catch (error: any) {
    console.error('[Auth] Reset password error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao redefinir senha' },
      { status: 500 }
    )
  }
}
