import { NextResponse } from 'next/server'
import { testConnection, clearCredentialsCache } from '@/lib/evolution-api'

// POST /api/whatsapp/test-connection — Test Evolution API credentials
export async function POST() {
  try {
    // Clear cache so we test the latest credentials from DB
    clearCredentialsCache()
    const result = await testConnection()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao testar conexão' },
      { status: 500 }
    )
  }
}
