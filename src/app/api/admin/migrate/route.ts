import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jwtVerify } from 'jose'

const AUTH_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || '')

export async function POST(req: NextRequest) {
  // Security: Only master users can run migrations
  try {
    const token = req.cookies.get('octupuszap-session')?.value
    if (!token) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    const { payload } = await jwtVerify(token, AUTH_SECRET)
    const role = (payload.role as string) || 'operador'
    if (role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado. Apenas master pode executar migrações.' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 })
  }

  try {
    // Add pausedAt column to Campaign table if it doesn't exist
    await db.$executeRawUnsafe(`
      ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3)
    `)
    return NextResponse.json({ success: true, message: 'Migration complete: pausedAt column added' })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Migration failed',
      hint: 'If column already exists, this is safe to ignore'
    }, { status: 500 })
  }
}
