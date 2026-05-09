import { NextResponse } from 'next/server'
import { getCookieName } from '@/lib/auth'

export async function POST() {
  try {
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
