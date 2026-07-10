import { NextResponse } from 'next/server'
import { getCookieName, getSession } from '@/lib/auth'
import { logAction } from '@/lib/audit-log'

export async function POST() {
  try {
    const session = await getSession()
    if (session) {
      await logAction({
        userId: session.userId,
        userName: session.username,
        userRole: session.role,
        action: 'LOGOUT',
        category: 'auth',
      })
    }
    const response = NextResponse.json({ success: true })
    response.cookies.set(getCookieName(), '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0, // Expire immediately
    })
    return response
  } catch (error: any) {
    console.error('[Auth] Logout error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao fazer logout' },
      { status: 500 }
    )
  }
}
