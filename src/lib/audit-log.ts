import { db } from '@/lib/db'

interface AuditLogData {
  userId?: string
  userName?: string
  userRole?: string
  action: string
  category?: string
  targetId?: string
  targetType?: string
  details?: Record<string, any>
  ipAddress?: string
}

export async function logAction(data: AuditLogData): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: data.userId || null,
        userName: data.userName || null,
        userRole: data.userRole || null,
        action: data.action,
        category: data.category || 'general',
        targetId: data.targetId || null,
        targetType: data.targetType || null,
        details: data.details ?? undefined,
        ipAddress: data.ipAddress || null,
      },
    })
  } catch (error) {
    console.error('[AuditLog] Erro ao registrar log:', error)
  }
}

export async function getAuditLogs(options: {
  limit?: number
  offset?: number
  category?: string
  targetType?: string
  targetId?: string
  userId?: string
} = {}) {
  const { limit = 50, offset = 0, category, targetType, targetId, userId } = options

  const where: any = {}
  if (category) where.category = category
  if (targetType) where.targetType = targetType
  if (targetId) where.targetId = targetId
  if (userId) where.userId = userId

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.auditLog.count({ where }),
  ])

  return { logs, total }
}
