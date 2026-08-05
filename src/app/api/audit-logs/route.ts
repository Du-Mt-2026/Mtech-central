import { NextResponse } from 'next/server'
import { getAuditLogs } from '@/lib/audit-log'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const category = searchParams.get('category') || undefined
    const targetType = searchParams.get('targetType') || undefined
    const targetId = searchParams.get('targetId') || undefined
    const userId = searchParams.get('userId') || undefined

    const result = await getAuditLogs({ limit, offset, category, targetType, targetId, userId })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error fetching audit logs:', error)
    return NextResponse.json({ error: error.message || 'Erro ao buscar logs' }, { status: 500 })
  }
}
