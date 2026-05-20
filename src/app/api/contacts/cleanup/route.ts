import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// DISABLED: Previously cleaned up name/phone keys from customFields.
// Now we KEEP name/phone keys in customFields so {{whatsapp}}, {{nome}}, etc. resolve in templates.
// This endpoint is kept for backwards compatibility but does nothing.
export async function POST() {
  try {
    return NextResponse.json({ success: true, cleaned: 0, total: 0, message: 'Cleanup disabled — name/phone keys are now kept in customFields for template variable resolution' })
  } catch (error) {
    console.error('Cleanup error:', error)
    return NextResponse.json({ error: 'Erro ao limpar customFields' }, { status: 500 })
  }
}
