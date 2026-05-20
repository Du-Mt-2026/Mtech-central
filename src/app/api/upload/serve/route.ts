import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

/**
 * GET /api/upload/serve?file=filename.ext
 * Serves uploaded media files from /tmp/uploads directory.
 * This is the fallback serving mechanism when Vercel Blob is not configured.
 * Files in /tmp are ephemeral and will be lost on redeployment.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileName = searchParams.get('file')

    if (!fileName) {
      return NextResponse.json({ error: 'Parâmetro file é obrigatório' }, { status: 400 })
    }

    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '')
    if (safeName !== fileName) {
      return NextResponse.json({ error: 'Nome de arquivo inválido' }, { status: 400 })
    }

    const filePath = path.join('/tmp/uploads', safeName)

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })
    }

    const fileBuffer = await readFile(filePath)
    const fileStat = await stat(filePath)

    // Determine content type from extension
    const ext = path.extname(safeName).toLowerCase()
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'audio/ogg',
      '.oga': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }

    const contentType = contentTypes[ext] || 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error: any) {
    console.error('[Upload Serve] Error:', error)
    return NextResponse.json(
      { error: 'Erro ao servir arquivo' },
      { status: 500 }
    )
  }
}
