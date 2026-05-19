import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * POST /api/upload
 * Upload a media file for use in campaigns.
 * 
 * For audio files:
 * - If audioMode === 'whatsapp' (default): converts to OGG/Opus format (WhatsApp native)
 *   - If already OGG/Opus, no conversion needed
 * - If audioMode === 'original': keeps the original file format
 * 
 * Returns: { mediaUrl, mediatype, originalName, converted }
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const mediatype = (formData.get('mediatype') as string) || ''
    const audioMode = (formData.get('audioMode') as string) || 'whatsapp' // 'whatsapp' | 'original'

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }

    // Generate unique filename
    const ext = path.extname(file.name).toLowerCase()
    const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, '_')
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7)
    const safeFileName = `${baseName}_${uniqueId}`

    // Save the original file
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let finalFileName: string
    let finalMediatype = mediatype
    let converted = false

    // Handle audio conversion
    if (mediatype === 'audio' && audioMode === 'whatsapp') {
      const isOgg = ext === '.ogg' || ext === '.oga' || file.type === 'audio/ogg' || file.type === 'audio/opus'

      if (isOgg) {
        // Already in WhatsApp-compatible format, just save
        finalFileName = `${safeFileName}${ext}`
        const filePath = path.join(uploadDir, finalFileName)
        await writeFile(filePath, buffer)
      } else {
        // Need to convert to OGG/Opus
        // First save the original
        const tempFileName = `${safeFileName}${ext}`
        const tempFilePath = path.join(uploadDir, tempFileName)
        await writeFile(tempFilePath, buffer)

        // Convert using ffmpeg
        finalFileName = `${safeFileName}.ogg`
        const outputFilePath = path.join(uploadDir, finalFileName)

        try {
          await execFileAsync('ffmpeg', [
            '-i', tempFilePath,
            '-c:a', 'libopus',       // Opus codec (WhatsApp native)
            '-b:a', '64k',           // Bitrate — good quality for voice
            '-ar', '48000',          // Sample rate
            '-ac', '1',              // Mono (voice messages are mono)
            '-vn',                   // No video
            '-y',                    // Overwrite output
            outputFilePath,
          ], { timeout: 30000 })

          converted = true

          // Remove temp file
          try {
            const { unlink } = await import('fs/promises')
            await unlink(tempFilePath)
          } catch { /* ignore cleanup error */ }
        } catch (ffmpegErr) {
          console.error('Audio conversion failed:', ffmpegErr)
          // Fall back to saving the original file
          finalFileName = tempFileName
          converted = false
        }
      }
    } else {
      // No conversion needed (non-audio or original mode)
      finalFileName = `${safeFileName}${ext}`
      const filePath = path.join(uploadDir, finalFileName)
      await writeFile(filePath, buffer)
    }

    // Build the public URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || ''
    const mediaUrl = `${baseUrl}/uploads/${finalFileName}`

    return NextResponse.json({
      mediaUrl,
      mediatype: finalMediatype,
      originalName: file.name,
      converted,
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao fazer upload' },
      { status: 500 }
    )
  }
}
