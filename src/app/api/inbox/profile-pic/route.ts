import { NextRequest, NextResponse } from 'next/server'
import { fetchProfilePicture } from '@/lib/evolution-api'
import { db } from '@/lib/db'

/**
 * GET /api/inbox/profile-pic
 * Fetches a contact's WhatsApp profile picture URL.
 * Caches the result in the Conversation table for future fast loads.
 *
 * Query params:
 * - chipId: required
 * - phone: phone number (without @s.whatsapp.net)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId')
    const phone = searchParams.get('phone')

    if (!chipId || !phone) {
      return NextResponse.json({ error: 'chipId e phone são obrigatórios' }, { status: 400 })
    }

    // Find the chip
    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { evolutionInstance: true, status: true },
    })

    if (!chip?.evolutionInstance || chip.status !== 'connected') {
      return NextResponse.json({ profilePicUrl: null })
    }

    // Try to fetch from Evolution API
    const profilePicUrl = await fetchProfilePicture(chip.evolutionInstance, phone)

    // Cache in Conversation if available
    if (profilePicUrl) {
      try {
        const remoteJid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
        await db.conversation.updateMany({
          where: { chipId, remoteJid },
          data: { profilePicUrl },
        })
      } catch {
        // Cache failure is non-critical
      }
    }

    return NextResponse.json({ profilePicUrl })
  } catch (error) {
    console.error('Profile pic fetch error:', error)
    return NextResponse.json({ profilePicUrl: null })
  }
}
