import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { markChatAsRead } from "@/lib/evolution-api"

export async function GET(req: NextRequest) {
  try {
    const s = new URL(req.url).searchParams
    const chipId = s.get("chipId"), remoteJid = s.get("remoteJid"), before = s.get("before"), limit = parseInt(s.get("limit") || "50")
    if (!chipId || !remoteJid) return NextResponse.json({ error: "Erro" }, { status: 400 })

    const p = remoteJid.split("@")[0]

    // Gerar variações de telefone (com 9, sem 9, com 55, sem 55)
    function phoneVariants(phone: string): string[] {
      const variants = new Set<string>([phone])
      const withoutCountry = phone.replace(/^55/, "")
      if (withoutCountry !== phone) variants.add(withoutCountry)
      if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
        const without9 = withoutCountry.slice(0, 2) + withoutCountry.slice(3)
        variants.add(without9)
        variants.add("55" + without9)
      } else if (withoutCountry.length === 10) {
        const with9 = withoutCountry.slice(0, 2) + "9" + withoutCountry.slice(2)
        variants.add(with9)
        variants.add("55" + with9)
      }
      return Array.from(variants)
    }

    const variants = phoneVariants(p)
    const conds: any[] = [
      { remoteJid },
      ...variants.map(v => ({ remoteJid: `${v}@s.whatsapp.net` })),
      { remotePhone: { in: variants } },
      { remoteJid: { startsWith: p } },
    ]

    const conv = await db.conversation.findUnique({ where: { chipId_remoteJid: { chipId, remoteJid } } }).catch(() => null)
    if (conv?.contactName) conds.push({ contactName: conv.contactName })

    const where: any = { chipId, OR: conds }
    if (before) where.createdAt = { lt: new Date(before) }

    const msgs = await db.inboxMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: limit })
    await db.inboxMessage.updateMany({ where: { chipId, OR: conds, isRead: false, fromMe: false }, data: { isRead: true } }).catch(() => null)

    try {
      const c = await db.chip.findUnique({ where: { id: chipId }, select: { evolutionInstance: true, status: true } })
      if (c?.evolutionInstance && c.status === "connected") await markChatAsRead(c.evolutionInstance, remoteJid)
    } catch {}

    return NextResponse.json({ messages: msgs.reverse(), hasMore: msgs.length === limit })
  } catch (e) { console.error(e); return NextResponse.json({ error: "Erro" }, { status: 500 }) }
}
