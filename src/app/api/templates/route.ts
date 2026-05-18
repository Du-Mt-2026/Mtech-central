import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const templates = await db.messageTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(templates)
  } catch (error) {
    console.error('Templates GET error:', error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, content, category, mediatype, mediaDescription, linkUrl, linkPreview } = body

    if (!name || !content) {
      return NextResponse.json({ error: 'Nome e conteúdo são obrigatórios' }, { status: 400 })
    }

    const template = await db.messageTemplate.create({
      data: {
        name,
        content,
        category: category || 'geral',
        mediatype: mediatype || 'text',
        mediaDescription: mediaDescription || '',
        linkUrl: linkUrl || '',
        linkPreview: linkPreview !== undefined ? linkPreview : true,
      },
    })
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    console.error('Templates POST error:', error)
    return NextResponse.json({ error: 'Erro ao criar template' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID é obrigatório' }, { status: 400 })
    }

    await db.messageTemplate.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Templates DELETE error:', error)
    return NextResponse.json({ error: 'Erro ao remover template' }, { status: 500 })
  }
}
