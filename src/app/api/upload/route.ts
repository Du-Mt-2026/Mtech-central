import { NextResponse } from 'next/server'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Use ffmpeg-static for serverless environments (Vercel) where system ffmpeg is not available
let ffmpegPath: string | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ffmpegPath = require('ffmpeg-static') as string
} catch {
  // ffmpeg-static not available, fall back to system ffmpeg
  ffmpegPath = null
}

/**
 * POST /api/upload
 * Upload a media file for use in campaigns.
 * 
 * For audio files:
 * - If audioMode === 'whatsapp' (default): converts to OGG/Opus format (WhatsApp native)
 *   - If already OGG/Opus, no conversion needed
 * - If audioMode === 'original': keeps the original file format
 * 
 * Uses ffmpeg-static (bundled ffmpeg binary) for serverless compatibility.
 * Falls back to system ffmpeg if ffmpeg-static is not available.
 * Falls back to original file if no ffmpeg is available at all.
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
        // First save the original as temp file
        const tempFileName = `${safeFileName}${ext}`
        const tempFilePath = path.join(uploadDir, tempFileName)
        await writeFile(tempFilePath, buffer)

        // Convert using ffmpeg (ffmpeg-static or system)
        finalFileName = `${safeFileName}.ogg`
        const outputFilePath = path.join(uploadDir, finalFileName)

        // Determine which ffmpeg to use
        const ffmpegBin = ffmpegPath || 'ffmpeg'
        const ffmpegSource = ffmpegPath ? 'ffmpeg-static' : 'system'

        try {
          console.log(`[Upload] Converting audio with ${ffmpegSource}: ${tempFilePath} → ${outputFilePath}`)

          await execFileAsync(ffmpegBin, [
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
          try { await unlink(tempFilePath) } catch { /* ignore cleanup error */ }

          console.log(`[Upload] Audio conversion successful (source: ${ffmpegSource})`)
        } catch (ffmpegErr: any) {
          console.error(`[Upload] Audio conversion failed (source: ${ffmpegSource}):`, ffmpegErr?.message || ffmpegErr)
          
          // If ffmpeg-static failed, try system ffmpeg as last resort
          if (ffmpegPath && ffmpegSource === 'ffmpeg-static') {
            try {
              console.log('[Upload] Trying system ffmpeg as fallback...')
              await execFileAsync('ffmpeg', [
                '-i', tempFilePath,
                '-c:a', 'libopus',
                '-b:a', '64k',
                '-ar', '48000',
                '-ac', '1',
                '-vn',
                '-y',
                outputFilePath,
              ], { timeout: 30000 })

              converted = true
              try { await unlink(tempFilePath) } catch { /* ignore */ }
              console.log('[Upload] Audio conversion successful with system ffmpeg fallback')
            } catch (sysErr: any) {
              console.error('[Upload] System ffmpeg also failed:', sysErr?.message || sysErr)
              // Fall back to saving the original file
              finalFileName = tempFileName
              converted = false
            }
          } else {
            // Fall back to saving the original file
            finalFileName = tempFileName
            converted = false
          }
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
