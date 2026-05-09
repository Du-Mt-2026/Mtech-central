import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/settings — Returns all settings as key-value pairs
export async function GET() {
  try {
    const settings = await db.settings.findMany()
    const result: Record<string, string> = {}
    for (const s of settings) {
      result[s.key] = s.value
    }
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Settings GET error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar configurações' },
      { status: 500 }
    )
  }
}

// PUT /api/settings — Accepts { key: value, ... } and upserts all settings
export async function PUT(request: Request) {
  try {
    const body = await request.json()

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Body deve ser um objeto { key: value, ... }' },
        { status: 400 }
      )
    }

    const entries = Object.entries(body)
    const results = []

    for (const [key, value] of entries) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        continue // Skip non-string key/value pairs
      }
      const setting = await db.settings.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
      results.push(setting)
    }

    return NextResponse.json({ updated: results.length, settings: results })
  } catch (error: any) {
    console.error('Settings PUT error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao salvar configurações' },
      { status: 500 }
    )
  }
}
