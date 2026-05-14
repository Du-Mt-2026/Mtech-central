import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'

// POST /api/setup/sync-schema — Sync Prisma schema to database
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { secret } = body

    // Protect with secret
    if (secret !== process.env.AUTH_SECRET && secret !== 'octupuszap-dev-secret-change-in-production') {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    console.log('[Setup] Starting prisma db push...')

    try {
      const output = execSync('npx prisma db push --accept-data-loss 2>&1', {
        timeout: 60000,
        env: { ...process.env },
      })
      console.log('[Setup] prisma db push output:', output.toString())
      return NextResponse.json({
        success: true,
        message: 'Schema sincronizado com sucesso!',
        output: output.toString(),
      })
    } catch (pushError: any) {
      console.error('[Setup] prisma db push error:', pushError.message)
      return NextResponse.json({
        success: false,
        error: 'Falha ao sincronizar schema',
        details: pushError.message,
      }, { status: 500 })
    }
  } catch (error: any) {
    console.error('[Setup] Sync schema error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
