import { NextResponse } from 'next/server'
import { testAllConnections } from '@/lib/evolution-router'
import { clearCredentialsCache } from '@/lib/evolution-api'

// POST /api/whatsapp/test-connection — Test Evolution Go API credentials
export async function POST() {
  try {
    // Clear cache so we test the latest credentials from DB
    clearCredentialsCache()
    const result = await testAllConnections()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao testar conexão' },
      { status: 500 }
    )
  }
}
