import { NextResponse } from 'next/server'
import { writeFile, mkdir, unlink, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

/**
 * POST /api/upload
 * Upload a media file for use in campaigns.
 *
 * Storage strategy:
 * - On Vercel: Uses Vercel Blob for persistent cloud storage
 *   (BLOB_READ_WRITE_TOKEN is auto-provisioned when Blob Store is created in Vercel dashboard)
 * - On local dev: Falls back to writing to public/uploads/ directory
 * - Last resort on Vercel: Uses /tmp (ephemeral, but at least upload won't crash)
 *
 * For audio files:
 * - If audioMode === 'whatsapp': the client-side code already converts to OGG/Opus before uploading
 *   (using @ffmpeg/ffmpeg WASM in the browser), so the file arrives already in the correct format
 * - If audioMode === 'original': keeps the original file format as-is
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

// Check if we're running on Vercel
const isVercel = !!process.env.VERCEL

/**
 * Upload to Vercel Blob storage.
 * Requires BLOB_READ_WRITE_TOKEN env var (auto-provisioned when Blob Store is linked in Vercel dashboard).
 */
async function uploadToVercelBlob(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  const { put } = await import('@vercel/blob')
  const blob = await put(`campaigns/${fileName}`, buffer, {
    contentType,
    access: 'public',
  })
  return blob.url
}

/**
 * Upload to local filesystem (for dev environment).
 * Uses public/uploads/ directory which is served statically by Next.js.
 */
async function uploadToLocal(buffer: Buffer, fileName: string): Promise<string> {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads')
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true })
  }
  const filePath = path.join(uploadDir, fileName)
  await writeFile(filePath, buffer)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${baseUrl}/uploads/${fileName}`
}

/**
 * Fallback for Vercel when Blob is not available: save to /tmp.
 * NOTE: Files in /tmp are ephemeral and will be lost on redeployment.
 * This is only meant as a last-resort fallback to prevent upload crashes.
 */
async function uploadToVercelTmp(buffer: Buffer, fileName: string): Promise<string> {
  const tmpDir = '/tmp/uploads'
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true })
  }
  const filePath = path.join(tmpDir, fileName)
  await writeFile(filePath, buffer)

  // Return a relative URL — the client will need to use the API to access this
  // Since /tmp isn't served statically, we return a data-encoded URL or a proxy path
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || ''
  // Use the /api/upload/serve proxy route to serve files from /tmp
  return `${baseUrl}/api/upload/serve?file=${encodeURIComponent(fileName)}`
}

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

    // Generate unique filename
    const ext = path.extname(file.name).toLowerCase()
    const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, '_')
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7)
    const safeFileName = `${baseName}_${uniqueId}`

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let finalFileName: string
    let finalBuffer: Buffer = buffer
    let finalContentType: string = file.type || 'application/octet-stream'
    let finalMediatype = mediatype
    let converted = false

    // Handle audio conversion (only if client didn't already convert)
    if (mediatype === 'audio' && audioMode === 'whatsapp' && !clientConverted) {
      const isOgg = ext === '.ogg' || ext === '.oga' || file.type === 'audio/ogg' || file.type === 'audio/opus'

      if (isOgg) {
        finalFileName = `${safeFileName}${ext}`
        finalContentType = 'audio/ogg'
      } else {
        // Need server-side conversion - use /tmp for temporary files
        const tmpDir = '/tmp/audio-conversions'
        if (!existsSync(tmpDir)) {
          await mkdir(tmpDir, { recursive: true })
        }

        const tempFileName = `${safeFileName}${ext}`
        const tempFilePath = path.join(tmpDir, tempFileName)
        await writeFile(tempFilePath, buffer)

        finalFileName = `${safeFileName}.ogg`
        const outputFilePath = path.join(tmpDir, finalFileName)

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
          finalBuffer = await readFile(outputFilePath)
          finalContentType = 'audio/ogg'
          try { await unlink(tempFilePath) } catch { /* ignore */ }
          try { await unlink(outputFilePath) } catch { /* ignore */ }
          console.log(`[Upload] Server-side conversion successful (${ffmpegSource})`)
        } catch (ffmpegErr: any) {
          console.error(`[Upload] Server-side conversion failed (${ffmpegSource}):`, ffmpegErr?.message)

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
              finalBuffer = await readFile(outputFilePath)
              finalContentType = 'audio/ogg'
              try { await unlink(tempFilePath) } catch { /* ignore */ }
              try { await unlink(outputFilePath) } catch { /* ignore */ }
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
      converted = clientConverted
    }

    // Upload to appropriate storage
    let mediaUrl: string

    if (isVercel) {
      // On Vercel: Try Vercel Blob first (requires BLOB_READ_WRITE_TOKEN)
      try {
        mediaUrl = await uploadToVercelBlob(finalBuffer, finalFileName, finalContentType)
        console.log(`[Upload] Uploaded to Vercel Blob: ${mediaUrl}`)
      } catch (blobErr: any) {
        console.error('[Upload] Vercel Blob upload failed:', blobErr?.message)
        // Blob not available — use /tmp as ephemeral fallback
        console.warn('[Upload] Falling back to /tmp storage (ephemeral — files will be lost on redeployment)')
        try {
          mediaUrl = await uploadToVercelTmp(finalBuffer, finalFileName)
          console.log(`[Upload] Uploaded to /tmp: ${mediaUrl}`)
        } catch (tmpErr: any) {
          console.error('[Upload] /tmp upload also failed:', tmpErr?.message)
          return NextResponse.json(
            { error: 'Falha no upload. Configure o Vercel Blob Store no dashboard do Vercel para persistência de mídia.' },
            { status: 500 }
          )
        }
      }
    } else {
      // Local dev: save to public/uploads/
      mediaUrl = await uploadToLocal(finalBuffer, finalFileName)
    }

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
