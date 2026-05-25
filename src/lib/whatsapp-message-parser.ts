// WhatsApp Message Parser
// ==============================================
// Extrai conteúdo legível de mensagens do WhatsApp no formato Evolution API v3.
// O webhook recebe mensagens no formato proto do WhatsApp (data.Message),
// que contém diversos tipos de mensagem aninhados.
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
//
// v1.0 — Initial implementation

export interface ParsedMessage {
  content: string          // Texto legível para exibir na UI
  type: string             // Tipo da mensagem (text, image, audio, template, etc.)
  mediaUrl: string | null  // URL da mídia se houver
  caption: string | null   // Legenda separada (para imagens/vídeos/documentos)
}

/**
 * Parse a WhatsApp message object (from Evolution API v3 data.Message)
 * into a structured format with readable content.
 */
export function parseWhatsAppMessage(msg: Record<string, any>): ParsedMessage {
  if (!msg || typeof msg !== 'object') {
    return { content: '', type: 'unknown', mediaUrl: null, caption: null }
  }

  // ===== TEXTO SIMPLES =====
  if (msg.conversation) {
    return { content: msg.conversation, type: 'text', mediaUrl: null, caption: null }
  }

  // ===== TEXTO COM RESPOSTA/CITAÇÃO =====
  if (msg.extendedTextMessage?.text) {
    return { content: msg.extendedTextMessage.text, type: 'text', mediaUrl: null, caption: null }
  }

  // ===== IMAGEM =====
  if (msg.imageMessage) {
    return {
      content: msg.imageMessage.caption || '',
      type: 'image',
      mediaUrl: msg.imageMessage.url || null,
      caption: msg.imageMessage.caption || null,
    }
  }

  // ===== VÍDEO =====
  if (msg.videoMessage) {
    return {
      content: msg.videoMessage.caption || '',
      type: 'video',
      mediaUrl: msg.videoMessage.url || null,
      caption: msg.videoMessage.caption || null,
    }
  }

  // ===== ÁUDIO / NOTA DE VOZ =====
  if (msg.audioMessage) {
    const isPtt = msg.audioMessage.ptt || msg.audioMessage.mimetype?.includes('ogg') || false
    return {
      content: isPtt ? '' : '',
      type: isPtt ? 'audio' : 'audio',
      mediaUrl: msg.audioMessage.url || null,
      caption: null,
    }
  }

  // ===== DOCUMENTO =====
  if (msg.documentMessage) {
    return {
      content: msg.documentMessage.caption || msg.documentMessage.fileName || '',
      type: 'document',
      mediaUrl: msg.documentMessage.url || null,
      caption: msg.documentMessage.caption || null,
    }
  }

  // ===== FIGURINHA =====
  if (msg.stickerMessage) {
    return {
      content: '',
      type: 'sticker',
      mediaUrl: msg.stickerMessage.url || null,
      caption: null,
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
    }
  }

  // ===== TEMPLATE MESSAGE (marketing/fluido) =====
  if (msg.templateMessage) {
    const template = msg.templateMessage
    // Template messages can have different formats:
    // 1. hydratedTemplate (WhatsApp Business)
    // 2. interactiveMessageTemplate (new format)
    // 3. fourRowTemplate (legacy)
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
      }
    }

    // interactiveMessageTemplate (newer format)
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
      }
    }

    // Generic template fallback — try to extract any text
    const templateText = extractAnyText(template)
    return {
      content: templateText || 'Mensagem de template',
      type: 'template',
      mediaUrl: null,
      caption: null,
    }
  }

  // ===== INTERACTIVE MESSAGE (botões/lista) =====
  if (msg.interactiveMessage) {
    const interactive = msg.interactiveMessage
    const header = interactive.header?.text || ''
    const body = interactive.body?.text || ''
    const footer = interactive.footer?.text || ''
    const parts = [header, body, footer].filter(Boolean)

    // Extract button labels
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
    }
  }

  // ===== REAÇÃO (emoji) =====
  if (msg.reactionMessage) {
    const text = msg.reactionMessage.text || ''
    return {
      content: text ? `Reação: ${text}` : 'Reação',
      type: 'reaction',
      mediaUrl: null,
      caption: null,
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
    }
  }

  // ===== ATUALIZAÇÃO DE ENQUETE =====
  if (msg.pollUpdateMessage) {
    return {
      content: 'Atualização de enquete',
      type: 'poll_update',
      mediaUrl: null,
      caption: null,
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
    }
  }

  // ===== MENSAGEM EPHEMERAL (não é um tipo real, mas pode vir) =====
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
      return { content: 'Mensagem apagada', type: 'deleted', mediaUrl: null, caption: null }
    }
    return { content: 'Mensagem do sistema', type: 'system', mediaUrl: null, caption: null }
  }

  // ===== MENSAGEM DE SISTEMA / NOTIFICAÇÃO DE GRUPO =====
  if (msg.groupNotificationMessage) {
    // This isn't a standard proto field, but some versions send it
    return {
      content: msg.groupNotificationMessage.message || 'Notificação de grupo',
      type: 'system',
      mediaUrl: null,
      caption: null,
    }
  }

  // ===== FALLBACK INTELIGENTE =====
  // Em vez de JSON.stringify (que mostra JSON cru na UI), tenta extrair qualquer texto
  const extractedText = extractAnyText(msg)
  if (extractedText) {
    return {
      content: extractedText,
      type: detectMessageType(msg),
      mediaUrl: extractMediaUrl(msg),
      caption: null,
    }
  }

  // Último recurso — indica que o tipo não foi reconhecido mas não mostra JSON
  const unhandledType = Object.keys(msg).find(k => k.endsWith('Message') || k.endsWith('message'))
  return {
    content: unhandledType ? `Mensagem de ${unhandledType}` : 'Mensagem não suportada',
    type: 'unknown',
    mediaUrl: null,
    caption: null,
  }
}

/**
 * Tenta extrair qualquer texto útil de uma mensagem desconhecida.
 * Percorre recursivamente procurando campos de texto comuns.
 */
function extractAnyText(obj: any, depth = 0): string {
  if (!obj || typeof obj !== 'object' || depth > 3) return ''
  if (Array.isArray(obj)) return ''

  // Campos de texto comuns no proto do WhatsApp
  const textFields = ['text', 'conversation', 'caption', 'content', 'body', 'title',
                      'displayName', 'name', 'description', 'fileName', 'selectedDisplayText',
                      'selectedButtonId', 'address', 'footer', 'subtitle', 'summary']

  for (const field of textFields) {
    if (obj[field] && typeof obj[field] === 'string' && obj[field].trim()) {
      return obj[field].trim().substring(0, 500)
    }
    // Nested .text (e.g., { body: { text: "..." } })
    if (obj[field] && typeof obj[field] === 'object' && obj[field].text && typeof obj[field].text === 'string') {
      return obj[field].text.trim().substring(0, 500)
    }
  }

  // Recurse into sub-objects that look like message types
  for (const key of Object.keys(obj)) {
    if (key.endsWith('Message') || key === 'message' || key === 'Message') {
      const nested = extractAnyText(obj[key], depth + 1)
      if (nested) return nested
    }
  }

  return ''
}

/**
 * Detecta o tipo de mensagem a partir das chaves do objeto.
 */
function detectMessageType(msg: Record<string, any>): string {
  const keys = Object.keys(msg)
  for (const key of keys) {
    if (key.endsWith('Message')) {
      // Convert camelCase to snake_case for type
      return key.replace('Message', '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
    }
  }
  return 'unknown'
}

/**
 * Tenta extrair uma URL de mídia de uma mensagem desconhecida.
 */
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
