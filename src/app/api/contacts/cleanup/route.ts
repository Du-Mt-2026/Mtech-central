import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Clean up duplicate name/phone keys from customFields
// After import code was fixed to skip name/phone columns, existing data may still have them
const NAME_ALIASES = ['nome', 'name', 'nombre', 'cliente']
const PHONE_ALIASES = ['telefone', 'phone', 'tel', 'numero', 'número', 'celular', 'whatsapp']
const ALIASES_TO_REMOVE = new Set([...NAME_ALIASES, ...PHONE_ALIASES])

export async function POST() {
  try {
    // Find all contacts that have customFields
    const contacts = await db.contact.findMany({
      where: { customFields: { not: null } },
      select: { id: true, customFields: true },
    })

    let cleaned = 0
    for (const contact of contacts) {
      if (!contact.customFields) continue
      try {
        const cf: Record<string, string> = JSON.parse(contact.customFields)
        const keys = Object.keys(cf)
        const hasDuplicate = keys.some(k => ALIASES_TO_REMOVE.has(k))
        if (hasDuplicate) {
          const cleanedCf: Record<string, string> = {}
          for (const [k, v] of Object.entries(cf)) {
            if (!ALIASES_TO_REMOVE.has(k)) {
              cleanedCf[k] = v
            }
          }
          await db.contact.update({
            where: { id: contact.id },
            data: { customFields: Object.keys(cleanedCf).length > 0 ? JSON.stringify(cleanedCf) : null },
          })
          cleaned++
        }
      } catch {
        // Skip contacts with invalid JSON
      }
    }

    return NextResponse.json({ success: true, cleaned, total: contacts.length })
  } catch (error) {
    console.error('Cleanup error:', error)
    return NextResponse.json({ error: 'Erro ao limpar customFields' }, { status: 500 })
  }
}
