import { NextResponse } from 'next/server'
import { sendMediaMessage, formatPhoneNumber } from '@/lib/evolution-api'
import { db } from '@/lib/db'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()

    const instanceName = formData.get('instanceName') as string
    const number = formData.get('number') as string
    const mediatype = formData.get('mediatype') as 'image' | 'document' | 'video' | 'audio'
    const mediaFile = formData.get('media') as File | null
    const caption = (formData.get('caption') as string) || ''
    const delay = formData.get('delay') ? parseInt(formData.get('delay') as string) : undefined

    if (!instanceName || !number || !mediatype || !mediaFile) {
      return NextResponse.json(
        { error: 'instanceName, number, mediatype e media são obrigatórios' },
        { status: 400 }
      )
    }

    const validMediaTypes = ['image', 'document', 'video', 'audio']
    if (!validMediaTypes.includes(mediatype)) {
      return NextResponse.json(
        { error: `mediatype deve ser um de: ${validMediaTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Convert file to base64 data URI
    const arrayBuffer = await mediaFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64Data = buffer.toString('base64')
    const mediaDataUri = `data:${mediaFile.type};base64,${base64Data}`

    // Format phone number
    const formattedPhone = formatPhoneNumber(number)

    // Send media message via Evolution API
    const result = await sendMediaMessage(instanceName, formattedPhone, mediaDataUri, mediatype, {
      caption,
      fileName: mediaFile.name,
      delay,
    })

    return NextResponse.json({
      success: true,
      messageId: result.key?.id,
      remoteJid: result.key?.remoteJid,
    })
  } catch (error: any) {
    console.error('Send media error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao enviar mídia' },
      { status: 500 }
    )
  }
}
