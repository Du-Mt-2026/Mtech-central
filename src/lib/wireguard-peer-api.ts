/**
 * WireGuard Peer Management — calls the KVM4 WireGuard Peer API
 * to add/remove peers on the WireGuard server automatically.
 * API runs on KVM4 port 51821.
 */

const WG_API_URL = process.env.WIREGUARD_API_URL || ''
const WG_API_TOKEN = process.env.WIREGUARD_API_TOKEN || ''

interface PeerResult {
  success: boolean
  message?: string
  error?: string
}

/**
 * Add a WireGuard peer on the KVM8 server
 * Called automatically when a chip is created
 */
export async function addWireGuardPeer(publicKey: string, ip: string): Promise<PeerResult> {
  if (!WG_API_URL || !WG_API_TOKEN) {
    console.log('[WG-Peer-API] No WIREGUARD_API_URL configured, skipping peer add')
    return { success: false, error: 'API not configured' }
  }

  try {
    const response = await fetch(`${WG_API_URL}/api/wireguard/peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        pubkey: publicKey,
        ip,
        token: WG_API_TOKEN,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    const data = await response.json()
    console.log(`[WG-Peer-API] Add peer ${ip}:`, data)
    return data
  } catch (error: any) {
    console.error(`[WG-Peer-API] Failed to add peer ${ip}:`, error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Remove a WireGuard peer from the KVM8 server
 * Called automatically when a chip is deleted
 */
export async function removeWireGuardPeer(publicKey: string, ip: string): Promise<PeerResult> {
  if (!WG_API_URL || !WG_API_TOKEN) {
    console.log('[WG-Peer-API] No WIREGUARD_API_URL configured, skipping peer remove')
    return { success: false, error: 'API not configured' }
  }

  try {
    const response = await fetch(`${WG_API_URL}/api/wireguard/peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'remove',
        pubkey: publicKey,
        ip,
        token: WG_API_TOKEN,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    const data = await response.json()
    console.log(`[WG-Peer-API] Remove peer ${ip}:`, data)
    return data
  } catch (error: any) {
    console.error(`[WG-Peer-API] Failed to remove peer ${ip}:`, error.message)
    return { success: false, error: error.message }
  }
}
