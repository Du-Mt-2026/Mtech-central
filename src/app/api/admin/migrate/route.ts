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
    const body = await req.json().catch(() => ({}))
    const action = body.action || 'default'

    // Mark existing campaign messages in inbox as isCampaign=true
    if (action === 'mark-campaign-inbox') {
      // Find all InboxMessages that match a campaign Message record
      const campaignMessages = await db.message.findMany({
        where: { evolutionMessageId: { not: null } },
        select: { evolutionMessageId: true },
      })

      const campaignMsgIds = campaignMessages
        .map(m => m.evolutionMessageId)
        .filter((id): id is string => !!id)

      const updateResult = await db.inboxMessage.updateMany({
        where: {
          evolutionMsgId: { in: campaignMsgIds },
          isCampaign: false,
        },
        data: { isCampaign: true },
      })

      return NextResponse.json({
        success: true,
        action: 'mark-campaign-inbox',
        campaignMsgIdsFound: campaignMsgIds.length,
        inboxMessagesUpdated: updateResult.count,
        message: `Marcadas ${updateResult.count} mensagens de campanha no inbox. Elas desaparecerão da caixa de entrada.`,
      })
    }

    // Mark chip-to-chip (warming) messages as isCampaign
    // These are phantom conversations from the warming engine between chips
    if (action === 'mark-warming-inbox') {
      // Get all chip phone numbers
      const chips = await db.chip.findMany({
        select: { phoneNumber: true, name: true },
      })

      let totalUpdated = 0

      for (const chip of chips) {
        // Find inbox messages where the remote phone matches a chip's phone number
        // This means the message was chip-to-chip (warming), not a real conversation
        const updated = await db.inboxMessage.updateMany({
          where: {
            isCampaign: false,
            OR: [
              { remotePhone: chip.phoneNumber },
              { remotePhone: { contains: chip.phoneNumber.replace(/^55/, '') } },
              { remotePhone: { contains: chip.phoneNumber } },
            ],
          },
          data: { isCampaign: true },
        })
        totalUpdated += updated.count
      }

      return NextResponse.json({
        success: true,
        action: 'mark-warming-inbox',
        chipsChecked: chips.length,
        inboxMessagesUpdated: totalUpdated,
        message: `Marcadas ${totalUpdated} mensagens chip-to-chip (aquecimento) como isCampaign. Elas desaparecerão da caixa de entrada.`,
      })
    }

    // Fix: Clear invalid profilePicUrl values (JIDs stored instead of URLs)
    if (action === 'fix-profile-pic-urls') {
      const result = await db.chip.updateMany({
        where: {
          profilePicUrl: { contains: '@s.whatsapp.net' },
        },
        data: { profilePicUrl: null },
      })
      return NextResponse.json({
        success: true,
        action: 'fix-profile-pic-urls',
        chipsFixed: result.count,
        message: `Limpos ${result.count} profilePicUrl inválidos (JIDs salvos como URL).`,
      })
    }

    // Default: Add pausedAt column to Campaign table if it doesn't exist
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
