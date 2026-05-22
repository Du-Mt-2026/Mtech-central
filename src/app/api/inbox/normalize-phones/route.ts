import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/inbox/normalize-phones
 * Normalizes Brazilian phone numbers in InboxMessage table.
 * Adds the mobile "9" prefix where missing (55+DDD+8digits → 55+DDD+9+8digits).
 * Also merges conversations that were split due to different phone formats.
 */
export async function POST() {
  try {
    // Find all InboxMessage records with Brazilian phone numbers missing the 9
    // Format: 55 + DDD(2) + 8 digits + @s.whatsapp.net = 12 digit phone number
    const allMessages = await db.inboxMessage.findMany({
      where: {
        remoteJid: { contains: '@s.whatsapp.net' },
      },
      select: {
        id: true,
        remoteJid: true,
        remotePhone: true,
      },
    })

    let updated = 0
    let skipped = 0
    const updates: Array<{ from: string; to: string; count: number }> = []

    for (const msg of allMessages) {
      const phonePart = msg.remoteJid.split('@')[0]

      // Check if it's a Brazilian number without the 9 (12 digits starting with 55)
      if (phonePart.startsWith('55') && phonePart.length === 12) {
        const normalizedPhone = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
        const normalizedJid = `${normalizedPhone}@s.whatsapp.net`

        try {
          await db.inboxMessage.update({
            where: { id: msg.id },
            data: {
              remoteJid: normalizedJid,
              remotePhone: normalizedPhone,
            },
          })
          updated++
        } catch (err: any) {
          // Unique constraint violation - a record with the normalized JID already exists
          if (err.code === 'P2002') {
            // Delete the duplicate instead
            try {
              await db.inboxMessage.delete({ where: { id: msg.id } })
              updated++
            } catch {
              skipped++
            }
          } else {
            skipped++
          }
        }
      } else {
        skipped++
      }
    }

    return NextResponse.json({
      totalChecked: allMessages.length,
      updated,
      skipped,
    })
  } catch (error) {
    console.error('Normalize phones error:', error)
    return NextResponse.json(
      { error: 'Erro ao normalizar telefones' },
      { status: 500 }
    )
  }
}
