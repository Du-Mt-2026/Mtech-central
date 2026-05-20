import { NextResponse } from 'next/server'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

/**
 * POST /api/upload
 * Upload a media file for use in campaigns.
 * 
 * For audio files:
 * - If audioMode === 'whatsapp': the client-side code already converts to OGG/Opus before uploading
 *   (using @ffmpeg/ffmpeg WASM in the browser), so the file arrives already in the correct format
 * - If audioMode === 'original': keeps the original file format as-is
 * 
 * If the client couldn't convert (WASM not supported), the file is saved as-is and
 * we attempt server-side conversion with ffmpeg-static or system ffmpeg as a fallback.
 * 
 * Returns: { mediaUrl, mediatype, originalName, converted }
 */

// Try to load ffmpeg-static for server-side fallback conversion
let ffmpegPath: string | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ffmpegPath = require('ffmpeg-static') as string
} catch {
  ffmpegPath = null
}

import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const mediatype = (formData.get('mediatype') as string) || ''
    const audioMode = (formData.get('audioMode') as string) || 'whatsapp'
    const clientConverted = formData.get('clientConverted') === 'true' // Client already converted?

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

    // Save the file
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let finalFileName: string
    let finalMediatype = mediatype
    let converted = false

    // Handle audio conversion (only if client didn't already convert)
    if (mediatype === 'audio' && audioMode === 'whatsapp' && !clientConverted) {
      const isOgg = ext === '.ogg' || ext === '.oga' || file.type === 'audio/ogg' || file.type === 'audio/opus'

      if (isOgg) {
        // Already in WhatsApp-compatible format, just save
        finalFileName = `${safeFileName}${ext}`
        const filePath = path.join(uploadDir, finalFileName)
        await writeFile(filePath, buffer)
      } else {
        // Try server-side conversion as fallback
        const tempFileName = `${safeFileName}${ext}`
        const tempFilePath = path.join(uploadDir, tempFileName)
        await writeFile(tempFilePath, buffer)

        finalFileName = `${safeFileName}.ogg`
        const outputFilePath = path.join(uploadDir, finalFileName)

        const ffmpegBin = ffmpegPath || 'ffmpeg'
        const ffmpegSource = ffmpegPath ? 'ffmpeg-static' : 'system'

        try {
          console.log(`[Upload] Server-side audio conversion with ${ffmpegSource}: ${tempFilePath} → ${outputFilePath}`)

          await execFileAsync(ffmpegBin, [
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
          console.log(`[Upload] Server-side conversion successful (${ffmpegSource})`)
        } catch (ffmpegErr: any) {
          console.error(`[Upload] Server-side conversion failed (${ffmpegSource}):`, ffmpegErr?.message)
          
          // Try system ffmpeg as fallback if ffmpeg-static failed
          if (ffmpegPath) {
            try {
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
            } catch {
              finalFileName = tempFileName
              converted = false
            }
          } else {
            finalFileName = tempFileName
            converted = false
          }
        }
      }
    } else {
      // No conversion needed (non-audio, original mode, or client already converted)
      finalFileName = `${safeFileName}${ext}`
      const filePath = path.join(uploadDir, finalFileName)
      await writeFile(filePath, buffer)
      converted = clientConverted
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
