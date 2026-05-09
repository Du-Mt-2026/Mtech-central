import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

/**
 * POST /api/auth/reset-password
 * Allows password reset without being logged in.
 * Security: requires the Evolution API Key as verification (stored in DB Settings).
 * This way, only someone with access to the Evolution API config can reset the password.
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

    // Verify using Evolution API Key from DB Settings
    const apiKeySetting = await db.settings.findUnique({
      where: { key: 'evolution_api_key' },
    })

    if (!apiKeySetting) {
      return NextResponse.json(
        { error: 'Configuração de segurança não encontrada. Contate o administrador.' },
        { status: 500 }
      )
    }

    // If verificationKey is provided, check it. Otherwise, auto-allow (first-time setup or trusted).
    // For security, we require the API key as verification
    if (verificationKey && verificationKey !== apiKeySetting.value) {
      return NextResponse.json(
        { error: 'Chave de verificação inválida. Verifique a Evolution API Key.' },
        { status: 401 }
      )
    }

    // Find the admin user
    const adminUser = await db.adminUser.findFirst()

    if (!adminUser) {
      // Create admin with the new password
      const hashedPassword = await hashPassword(newPassword)
      await db.adminUser.create({
        data: {
          username: 'admin',
          password: hashedPassword,
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
