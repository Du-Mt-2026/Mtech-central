// Cache em memória para QR codes recebidos via webhook.
// QR codes expiram em ~20s na Evolution Go, então usamos TTL de 60s.

const QR_CACHE_TTL_MS = 60_000 // 60 segundos

interface QRCacheEntry {
  qrcode: string      // data:image/png;base64,... ou base64 raw
  code: string | null // pairing code
  timestamp: number
}

const qrCache = new Map<string, QRCacheEntry>()

/**
 * Salva QR code recebido via webhook.
 */
export function setQRCode(instanceName: string, qrcode: string, code: string | null = null): void {
  qrCache.set(instanceName, {
    qrcode,
    code,
    timestamp: Date.now(),
  })
  console.log(`[QRCache] Saved QR code for ${instanceName} (expires in ${QR_CACHE_TTL_MS / 1000}s)`)
}

/**
 * Busca QR code do cache. Retorna null se expirou ou não existe.
 */
export function getQRCode(instanceName: string): { qrcode: string; code: string | null } | null {
  const entry = qrCache.get(instanceName)
  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > QR_CACHE_TTL_MS) {
    qrCache.delete(instanceName)
    return null
  }

  return { qrcode: entry.qrcode, code: entry.code }
}

/**
 * Remove QR code do cache (quando chip conecta ou desconecta).
 */
export function clearQRCode(instanceName: string): void {
  qrCache.delete(instanceName)
}
