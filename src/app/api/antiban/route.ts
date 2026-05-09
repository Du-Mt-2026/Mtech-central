import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      settings = await db.antiBanSettings.create({ data: {} })
    }
    return NextResponse.json(settings)
  } catch (error) {
    console.error('AntiBan GET error:', error)
    return NextResponse.json({ error: 'Erro ao carregar configurações anti-ban' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      settings = await db.antiBanSettings.create({ data: {} })
    }
    const body = await request.json()
    const updated = await db.antiBanSettings.update({
      where: { id: settings.id },
      data: body,
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('AntiBan PATCH error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar configurações anti-ban' }, { status: 500 })
  }
}
