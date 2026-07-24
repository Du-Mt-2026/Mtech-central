// API Route for bulk import of Warming Message Pool
// POST /api/warming/message-pool/bulk
//
// Body: { "messages": [{ "category": "saudacao", "content": "Bom dia!", "weight": 1 }, ...] }
//
// Returns: { "inserted": N, "skipped": N, "errors": [...] }
//
// Skips duplicates (same category + content, case-insensitive) to be idempotent.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidatePoolCache, AI_BOT_CATEGORIES } from '@/lib/ai-bot-warming'

interface BulkMessageInput {
  category: string
  content: string
  weight?: number
  active?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const messages: BulkMessageInput[] = Array.isArray(body) ? body : body.messages

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Body deve ser um array de mensagens ou { "messages": [...] }' },
        { status: 400 }
      )
    }

    if (messages.length > 5000) {
      return NextResponse.json(
        { error: 'Máximo de 5000 mensagens por bulk insert' },
        { status: 400 }
      )
    }

    // Carrega mensagens existentes (apenas category+content) para detectar duplicatas
    const existing = await db.warmingMessagePool.findMany({
      select: { category: true, content: true },
    })
    const existingSet = new Set(
      existing.map(e => `${e.category}|${e.content.trim().toLowerCase()}`)
    )

    const toInsert: Array<{ category: string; content: string; weight: number; active: boolean }> = []
    const errors: Array<{ index: number; error: string }> = []
    let skipped = 0

    messages.forEach((msg, index) => {
      if (!msg || typeof msg !== 'object') {
        errors.push({ index, error: 'Item não é um objeto' })
        return
      }

      const { category, content } = msg

      if (!category || !(AI_BOT_CATEGORIES as readonly string[]).includes(category)) {
        errors.push({ index, error: `Categoria inválida: ${category}` })
        return
      }

      if (!content || !content.trim()) {
        errors.push({ index, error: 'Conteúdo vazio' })
        return
      }

      const normalizedContent = content.trim()
      const key = `${category}|${normalizedContent.toLowerCase()}`

      if (existingSet.has(key)) {
        skipped++
        return
      }

      existingSet.add(key) // Evita duplicatas dentro do próprio batch

      toInsert.push({
        category,
        content: normalizedContent,
        weight: Math.max(1, Math.min(100, Number(msg.weight) || 1)),
        active: msg.active !== false,
      })
    })

    let inserted = 0
    if (toInsert.length > 0) {
      // Prisma createMany para inserção em lote (uma query só)
      const result = await db.warmingMessagePool.createMany({
        data: toInsert,
        skipDuplicates: true,
      })
      inserted = result.count
    }

    invalidatePoolCache()

    return NextResponse.json({
      inserted,
      skipped,
      errors,
      total: messages.length,
    })
  } catch (error: any) {
    console.error('[MessagePool Bulk API] Error:', error.message)
    return NextResponse.json(
      { error: 'Erro no bulk insert', detail: error.message },
      { status: 500 }
    )
  }
}
