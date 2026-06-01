// WhatsApp Message Parser v2.0
// ==============================================
// Extrai conteúdo legível de mensagens do WhatsApp no formato Evolution API v3.
// O webhook recebe mensagens no formato proto do WhatsApp (data.Message),
// que contém diversos tipos de mensagem aninhados.
//
// NOVO NA v2.0:
//   - Quoted message extraction (contextInfo/stanzaId)
//   - Reaction message data (target msg ID + emoji)
//   - Enriched media metadata (fileName, mimeType, duration)
//   - WhatsApp text formatting preservation
//   - Separate caption tracking for media messages
//
// TIPOS SUPORTADOS:
//   - conversation (texto simples)
//   - extendedTextMessage (texto com resposta/citação)
//   - imageMessage (imagem com legenda opcional)
//   - videoMessage (vídeo com legenda opcional)
//   - audioMessage (áudio/nota de voz)
//   - documentMessage (documento com legenda opcional)
//   - stickerMessage (figurinha)
//   - contactMessage (contato compartilhado)
//   - locationMessage (localização)
//   - documentWithCaptionMessage (documento com legenda)
//   - templateMessage (mensagem de template — marketing/fluido)
//   - buttonsResponseMessage (resposta de botão)
//   - listResponseMessage (resposta de lista)
//   - reactionMessage (reação/emoji)
//   - contactsArrayMessage (múltiplos contatos)
//   - groupInviteMessage (convite de grupo)
//   - pollCreationMessage (enquete)
//   - pollUpdateMessage (atualização de enquete)
//   - orderMessage (pedido)
//   - productMessage (produto/catálogo)

export interface ParsedMessage {
  content: string          // Texto legível para exibir na UI
  type: string             // Tipo da mensagem (text, image, audio, template, etc.)
  mediaUrl: string | null  // URL da mídia se houver
  caption: string | null   // Legenda separada (para imagens/vídeos/documentos)

  // === v2.0: Quoted message (reply) ===
  quotedMsgId: string | null      // evolutionMsgId of the message being replied to (from contextInfo.stanzaId)
  quotedContent: string | null    // Preview text of the quoted message
  quotedType: string | null       // Type of the quoted message
  quotedPushName: string | null   // pushName of the quoted message sender

  // === v2.0: Reaction ===
  reactionTargetId: string | null // evolutionMsgId of the message being reacted to
  reactionEmoji: string | null    // The emoji used in the reaction (empty string = removed)

  // === v2.0: Enriched media metadata ===
  fileName: string | null         // Original file name (for documents)
  mimeType: string | null         // MIME type
  mediaDuration: number | null    // Duration in seconds (for audio/video)
}

/**
 * Extract contextInfo from any message type.
 * WhatsApp puts contextInfo inside the message type object (imageMessage, videoMessage, etc.)
 * or inside extendedTextMessage for text replies.
 * 
 * contextInfo contains:
 *   - stanzaId: the ID of the message being replied to
 *   - participant: the JID of the sender of the quoted message
 *   - quotedMessage: the full message object of the quoted message (sometimes)
 */
function extractContextInfo(msg: Record<string, any>): {
  quotedMsgId: string | null
  quotedContent: string | null
  quotedType: string | null
  quotedPushName: string | null
} {
  // Try to find contextInfo in any message type
  const msgTypes = Object.keys(msg).filter(k => k.endsWith('Message') || k === 'conversation')
  
  for (const msgType of msgTypes) {
    const msgObj = msg[msgType]
    if (!msgObj || typeof msgObj !== 'object') continue
    
    const ctx = msgObj.contextInfo
    if (!ctx) continue
    
    const stanzaId = ctx.stanzaId || null
    if (!stanzaId) continue
    
    // Try to extract preview content from the quoted message
    let quotedContent: string | null = null
    let quotedType: string | null = null
    
    if (ctx.quotedMessage) {
      const parsed = parseWhatsAppMessage(ctx.quotedMessage)
      quotedContent = parsed.content?.substring(0, 200) || null
      quotedType = parsed.type
    }
    
    // Try to get the sender's name from participant JID
    // Format: "5511999999999@s.whatsapp.net" or just the JID
    const quotedPushName = ctx.participant || null
    
    return {
      quotedMsgId: stanzaId,
      quotedContent,
      quotedType,
      quotedPushName,
    }
  }
  
  return {
    quotedMsgId: null,
    quotedContent: null,
    quotedType: null,
    quotedPushName: null,
  }
}

/**
 * Parse a WhatsApp message object (from Evolution API v3 data.Message)
 * into a structured format with readable content.
 */
export function parseWhatsAppMessage(msg: Record<string, any>): ParsedMessage {
  if (!msg || typeof msg !== 'object') {
    return { content: '', type: 'unknown', mediaUrl: null, caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null }
  }

  // ===== REAÇÃO (emoji) — process FIRST because it's special =====
  if (msg.reactionMessage) {
    const text = msg.reactionMessage.text || ''
    const targetId = msg.reactionMessage.key?.id || null
    return {
      content: text ? `Reação: ${text}` : 'Reação removida',
      type: 'reaction',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: targetId,
      reactionEmoji: text || '',
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== TEXTO SIMPLES =====
  if (msg.conversation) {
    const ctx = extractContextInfo(msg)
    return {
      content: msg.conversation, type: 'text', mediaUrl: null, caption: null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== TEXTO COM RESPOSTA/CITAÇÃO =====
  if (msg.extendedTextMessage?.text) {
    const ctx = extractContextInfo(msg)
    return {
      content: msg.extendedTextMessage.text, type: 'text', mediaUrl: null, caption: null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== IMAGEM =====
  if (msg.imageMessage) {
    const ctx = extractContextInfo(msg)
    return {
      content: msg.imageMessage.caption || '',
      type: 'image',
      mediaUrl: msg.imageMessage.url || null,
      caption: msg.imageMessage.caption || null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null,
      mimeType: msg.imageMessage.mimetype || null,
      mediaDuration: null,
    }
  }

  // ===== VÍDEO =====
  if (msg.videoMessage) {
    const ctx = extractContextInfo(msg)
    return {
      content: msg.videoMessage.caption || '',
      type: 'video',
      mediaUrl: msg.videoMessage.url || null,
      caption: msg.videoMessage.caption || null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null,
      mimeType: msg.videoMessage.mimetype || null,
      mediaDuration: msg.videoMessage.seconds || null,
    }
  }

  // ===== ÁUDIO / NOTA DE VOZ =====
  if (msg.audioMessage) {
    const isPtt = msg.audioMessage.ptt || msg.audioMessage.mimetype?.includes('ogg') || false
    const ctx = extractContextInfo(msg)
    return {
      content: '',
      type: isPtt ? 'audio' : 'audio',
      mediaUrl: msg.audioMessage.url || null,
      caption: null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null,
      mimeType: msg.audioMessage.mimetype || null,
      mediaDuration: msg.audioMessage.seconds || null,
    }
  }

  // ===== DOCUMENTO =====
  if (msg.documentMessage) {
    const ctx = extractContextInfo(msg)
    return {
      content: msg.documentMessage.caption || msg.documentMessage.fileName || '',
      type: 'document',
      mediaUrl: msg.documentMessage.url || null,
      caption: msg.documentMessage.caption || null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: msg.documentMessage.fileName || null,
      mimeType: msg.documentMessage.mimetype || null,
      mediaDuration: null,
    }
  }

  // ===== FIGURINHA =====
  if (msg.stickerMessage) {
    const ctx = extractContextInfo(msg)
    return {
      content: '',
      type: 'sticker',
      mediaUrl: msg.stickerMessage.url || null,
      caption: null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null,
      mimeType: msg.stickerMessage.mimetype || null,
      mediaDuration: null,
    }
  }

  // ===== CONTATO COMPARTILHADO =====
  if (msg.contactMessage) {
    const name = msg.contactMessage.displayName || 'Contato'
    return {
      content: `Contato: ${name}`,
      type: 'contact',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== MÚLTIPLOS CONTATOS =====
  if (msg.contactsArrayMessage) {
    const contacts = msg.contactsArrayMessage?.contacts || []
    const names = contacts
      .map((c: any) => c?.displayName || 'Desconhecido')
      .filter(Boolean)
      .join(', ')
    return {
      content: `Contatos: ${names || 'múltiplos contatos'}`,
      type: 'contact',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== LOCALIZAÇÃO =====
  if (msg.locationMessage) {
    const lat = msg.locationMessage.degreesLatitude || msg.locationMessage.degreesLat
    const lng = msg.locationMessage.degreesLongitude || msg.locationMessage.degreesLong
    const name = msg.locationMessage.name || ''
    const addr = msg.locationMessage.address || ''
    const locationText = name || addr || `${lat}, ${lng}`
    return {
      content: `Localização: ${locationText}`,
      type: 'location',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== DOCUMENTO COM LEGENDA (aninhado) =====
  if (msg.documentWithCaptionMessage?.message?.documentMessage) {
    const doc = msg.documentWithCaptionMessage.message.documentMessage
    return {
      content: doc.caption || doc.fileName || '',
      type: 'document',
      mediaUrl: doc.URL || doc.url || null,
      caption: doc.caption || null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: doc.fileName || null,
      mimeType: doc.mimetype || null,
      mediaDuration: null,
    }
  }

  // ===== TEMPLATE MESSAGE (marketing/fluido) =====
  if (msg.templateMessage) {
    const template = msg.templateMessage
    const hydrated = template.hydratedTemplate || template.hydratedFourRowTemplate
    if (hydrated) {
      const title = hydrated.title?.text || hydrated.title || ''
      const body = hydrated.content?.text || hydrated.body?.text || hydrated.content || ''
      const footer = hydrated.footer?.text || hydrated.footer || ''
      const buttons = (hydrated.hydratedButtons || [])
        .map((b: any) => {
          if (b.quickReplyButton) return b.quickReplyButton.displayText || b.quickReplyButton.id
          if (b.urlButton) return b.urlButton.displayText || b.urlButton.url
          if (b.callButton) return b.callButton.displayText || b.callButton.phoneNumber
          return ''
        })
        .filter(Boolean)
        .join(' | ')

      const parts = [title, body, footer, buttons].filter(Boolean)
      return {
        content: parts.join('\n'),
        type: 'template',
        mediaUrl: null,
        caption: null,
        quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
        reactionTargetId: null, reactionEmoji: null,
        fileName: null, mimeType: null, mediaDuration: null,
      }
    }

    const interactive = template.interactiveMessageTemplate
    if (interactive) {
      const header = interactive.header?.text || ''
      const body = interactive.body?.text || ''
      const footer = interactive.footer?.text || ''
      const parts = [header, body, footer].filter(Boolean)
      return {
        content: parts.join('\n'),
        type: 'template',
        mediaUrl: null,
        caption: null,
        quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
        reactionTargetId: null, reactionEmoji: null,
        fileName: null, mimeType: null, mediaDuration: null,
      }
    }

    const templateText = extractAnyText(template)
    return {
      content: templateText || 'Mensagem de template',
      type: 'template',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== INTERACTIVE MESSAGE (botões/lista) =====
  if (msg.interactiveMessage) {
    const interactive = msg.interactiveMessage
    const header = interactive.header?.text || ''
    const body = interactive.body?.text || ''
    const footer = interactive.footer?.text || ''
    const parts = [header, body, footer].filter(Boolean)

    if (interactive.nativeFlowMessage?.buttons) {
      const btnLabels = interactive.nativeFlowMessage.buttons
        .map((b: any) => b.name || b.buttonText?.displayText || '')
        .filter(Boolean)
        .join(' | ')
      if (btnLabels) parts.push(btnLabels)
    }

    return {
      content: parts.join('\n') || 'Mensagem interativa',
      type: 'interactive',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== BOTÕES DE RESPOSTA =====
  if (msg.buttonsResponseMessage) {
    const text = msg.buttonsResponseMessage.selectedDisplayText ||
                 msg.buttonsResponseMessage.selectedButtonId || ''
    return {
      content: text || 'Resposta de botão',
      type: 'button_response',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== LISTA DE RESPOSTA =====
  if (msg.listResponseMessage) {
    const title = msg.listResponseMessage.title || ''
    const desc = msg.listResponseMessage.description || ''
    const text = [title, desc].filter(Boolean).join(' — ')
    return {
      content: text || 'Resposta de lista',
      type: 'list_response',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== CONVITE DE GRUPO =====
  if (msg.groupInviteMessage) {
    const name = msg.groupInviteMessage.groupName || ''
    const caption = msg.groupInviteMessage.caption || ''
    return {
      content: `Convite de grupo: ${name}${caption ? ` — ${caption}` : ''}`,
      type: 'group_invite',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== ENQUETE =====
  if (msg.pollCreationMessage) {
    const name = msg.pollCreationMessage.name || ''
    const options = (msg.pollCreationMessage.options || [])
      .map((o: any) => o.optionName || '')
      .filter(Boolean)
      .join(' | ')
    return {
      content: `Enquete: ${name}${options ? ` — ${options}` : ''}`,
      type: 'poll',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== ATUALIZAÇÃO DE ENQUETE =====
  if (msg.pollUpdateMessage) {
    return {
      content: 'Atualização de enquete',
      type: 'poll_update',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== PEDIDO =====
  if (msg.orderMessage) {
    const item = msg.orderMessage.itemCount ? `${msg.orderMessage.itemCount} item(s)` : 'Pedido'
    const title = msg.orderMessage.title || ''
    return {
      content: `Pedido: ${title || item}`,
      type: 'order',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== PRODUTO / CATÁLOGO =====
  if (msg.productMessage) {
    const title = msg.productMessage?.product?.title || ''
    const desc = msg.productMessage?.product?.description || ''
    return {
      content: `Produto: ${title}${desc ? ` — ${desc}` : ''}`,
      type: 'product',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== MENSAGEM EPHEMERAL =====
  if (msg.ephemeralMessage?.message) {
    return parseWhatsAppMessage(msg.ephemeralMessage.message)
  }

  // ===== VIEW ONCE =====
  if (msg.viewOnceMessage?.message) {
    return parseWhatsAppMessage(msg.viewOnceMessage.message)
  }
  if (msg.viewOnceMessageV2?.message) {
    return parseWhatsAppMessage(msg.viewOnceMessageV2.message)
  }

  // ===== MENSAGEM COM CITAÇÃO (protocolMessage) =====
  if (msg.protocolMessage) {
    const type = msg.protocolMessage.type
    if (type === 0) {
      return {
        content: 'Mensagem apagada', type: 'deleted', mediaUrl: null, caption: null,
        quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
        reactionTargetId: null, reactionEmoji: null,
        fileName: null, mimeType: null, mediaDuration: null,
      }
    }
    return {
      content: 'Mensagem do sistema', type: 'system', mediaUrl: null, caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== MENSAGEM DE SISTEMA / NOTIFICAÇÃO DE GRUPO =====
  if (msg.groupNotificationMessage) {
    return {
      content: msg.groupNotificationMessage.message || 'Notificação de grupo',
      type: 'system',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== FALLBACK INTELIGENTE =====
  const extractedText = extractAnyText(msg)
  if (extractedText) {
    const ctx = extractContextInfo(msg)
    return {
      content: extractedText,
      type: detectMessageType(msg),
      mediaUrl: extractMediaUrl(msg),
      caption: null,
      ...ctx,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== ENCRYPTED REACTION (device couldn't decrypt) =====
  if (msg.encReactionMessage) {
    return {
      content: 'Reação',
      type: 'reaction',
      mediaUrl: null,
      caption: null,
      quotedMsgId: msg.encReactionMessage?.key?.id || null,
      quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: msg.encReactionMessage?.key?.id || null,
      reactionEmoji: '', // Can't decrypt the emoji
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // ===== ENCRYPTED MESSAGE (device couldn't decrypt) =====
  if (msg.encMessage || msg.encryptedMessage) {
    return {
      content: 'Mensagem criptografada',
      type: 'unknown',
      mediaUrl: null,
      caption: null,
      quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
      reactionTargetId: null, reactionEmoji: null,
      fileName: null, mimeType: null, mediaDuration: null,
    }
  }

  // Último recurso
  const unhandledType = Object.keys(msg).find(k => k.endsWith('Message') || k.endsWith('message'))
  return {
    content: 'Mensagem não suportada',
    type: 'unknown',
    mediaUrl: null,
    caption: null,
    quotedMsgId: null, quotedContent: null, quotedType: null, quotedPushName: null,
    reactionTargetId: null, reactionEmoji: null,
    fileName: null, mimeType: null, mediaDuration: null,
  }
}

// ============================================================
// WHATSAPP TEXT FORMATTING
// ============================================================
// WhatsApp uses these markers for text formatting:
//   *bold*   → **bold**
//   _italic_ → _italic_
//   ~strikethrough~ → ~~strikethrough~~
//   ```monospace``` → `monospace`
//   > quote  → blockquote
//
// This function converts WhatsApp formatting markers to HTML
// for safe rendering in the UI (React dangerouslySetInnerHTML).
// ============================================================

export function formatWhatsAppText(text: string): string {
  if (!text) return ''
  
  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // Triple backtick monospace (must be before single backtick)
  html = html.replace(/```([^`]+?)```/g, '<code class="whatsapp-mono">$1</code>')
  
  // Single backtick monospace
  html = html.replace(/`([^`]+?)`/g, '<code class="whatsapp-mono">$1</code>')
  
  // Bold (*text*) — but not inside already-processed tags
  html = html.replace(/\*([^*]+?)\*/g, '<strong>$1</strong>')
  
  // Italic (_text_) — but avoid matching inside words
  html = html.replace(/(^|\s)_([^_]+?)_(\s|$|[.,!?;:])/g, '$1<em>$2</em>$3')
  
  // Strikethrough (~text~)
  html = html.replace(/~([^~]+?)~/g, '<del>$1</del>')
  
  // Block quote (> text at start of line)
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="whatsapp-quote">$1</blockquote>')
  
  // Bullet list (* item at start of line — but not if it's bold)
  // Only match if * is followed by space (list marker, not bold marker)
  html = html.replace(/^\*\s+(.+)$/gm, '<span class="whatsapp-bullet">• $1</span>')
  
  return html
}

/**
 * Check if text contains WhatsApp formatting markers.
 * Used to decide whether to apply formatting in the UI.
 */
export function hasWhatsAppFormatting(text: string): boolean {
  if (!text) return false
  return /[*_~`]/.test(text) || /^>/m.test(text)
}

/**
 * Tenta extrair qualquer texto útil de uma mensagem desconhecida.
 */
function extractAnyText(obj: any, depth = 0): string {
  if (!obj || typeof obj !== 'object' || depth > 3) return ''
  if (Array.isArray(obj)) return ''

  const textFields = ['text', 'conversation', 'caption', 'content', 'body', 'title',
                      'displayName', 'name', 'description', 'fileName', 'selectedDisplayText',
                      'selectedButtonId', 'address', 'footer', 'subtitle', 'summary']

  for (const field of textFields) {
    if (obj[field] && typeof obj[field] === 'string' && obj[field].trim()) {
      return obj[field].trim().substring(0, 500)
    }
    if (obj[field] && typeof obj[field] === 'object' && obj[field].text && typeof obj[field].text === 'string') {
      return obj[field].text.trim().substring(0, 500)
    }
  }

  for (const key of Object.keys(obj)) {
    if (key.endsWith('Message') || key === 'message' || key === 'Message') {
      const nested = extractAnyText(obj[key], depth + 1)
      if (nested) return nested
    }
  }

  return ''
}

function detectMessageType(msg: Record<string, any>): string {
  const keys = Object.keys(msg)
  for (const key of keys) {
    if (key.endsWith('Message')) {
      return key.replace('Message', '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
    }
  }
  return 'unknown'
}

function extractMediaUrl(msg: Record<string, any>): string | null {
  if (msg.url && typeof msg.url === 'string') return msg.url
  if (msg.URL && typeof msg.URL === 'string') return msg.URL

  for (const key of Object.keys(msg)) {
    if (key.endsWith('Message') && msg[key]) {
      if (msg[key].url && typeof msg[key].url === 'string') return msg[key].url
      if (msg[key].URL && typeof msg[key].URL === 'string') return msg[key].URL
    }
  }

  return null
}
