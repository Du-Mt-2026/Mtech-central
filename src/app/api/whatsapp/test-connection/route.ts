import { NextResponse } from 'next/server'
import { testAllConnections } from '@/lib/evolution-router'
import { clearCredentialsCache } from '@/lib/evolution-api'
import { clearV2CredentialsCache } from '@/lib/evolution-api-v2'

// POST /api/whatsapp/test-connection — Test Evolution API credentials (both v2 and v3)
export async function POST() {
  try {
    // Clear caches so we test the latest credentials from DB
    clearCredentialsCache()
    clearV2CredentialsCache()
    const result = await testAllConnections()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao testar conexão' },
      { status: 500 }
    )
  }
}
