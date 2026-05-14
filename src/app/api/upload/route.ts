import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    // Validate file size (max 16MB — WhatsApp limit)
    const MAX_SIZE = 16 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Arquivo muito grande (máximo 16MB)' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/3gp', 'video/webm',
      'audio/ogg', 'audio/mp3', 'audio/mpeg', 'audio/amr',
      'application/pdf']

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: `Tipo de arquivo não suportado: ${file.type}` }, { status: 400 })
    }

    // Determine mediatype from MIME
    let mediatype = 'document'
    if (file.type.startsWith('image/')) mediatype = 'image'
    else if (file.type.startsWith('video/')) mediatype = 'video'
    else if (file.type.startsWith('audio/')) mediatype = 'audio'

    // Convert to base64 — store as data URI so the Evolution API can use it directly
    // This avoids needing file storage on Vercel (serverless = read-only filesystem)
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const dataUri = `data:${file.type};base64,${base64}`

    return NextResponse.json({
      mediaUrl: dataUri,
      mediatype,
      fileName: file.name,
      size: file.size,
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao fazer upload do arquivo' },
      { status: 500 }
    )
  }
}
