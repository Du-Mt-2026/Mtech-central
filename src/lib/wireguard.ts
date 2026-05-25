import crypto from 'crypto'

// Generate REAL WireGuard x25519 keypair using Node.js crypto
export function generateWireGuardKeys(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  const privBuf = privateKey.export({ type: 'pkcs8', format: 'der' })
  const pubBuf = publicKey.export({ type: 'spki', format: 'der' })
  // Extract raw 32 bytes from end of DER encoded keys
  return {
    privateKey: privBuf.slice(-32).toString('base64'),
    publicKey: pubBuf.slice(-32).toString('base64'),
  }
}

// Get the server's public key from .env (persistent across restarts)
export function getServerPublicKey(): string {
  return process.env.WIREGUARD_SERVER_PUB_KEY || ''
}

// Get the server's private key from .env (persistent across restarts)
export function getServerPrivateKey(): string {
  return process.env.WIREGUARD_SERVER_PRIV_KEY || ''
}

// Get server endpoint (configured via env)
export function getServerEndpoint(): string {
  const port = process.env.WIREGUARD_SERVER_PORT || '51820'
  return process.env.WIREGUARD_SERVER_ENDPOINT || `187.77.48.22:${port}`
}

// Generate the next available WireGuard IP
// Range: 10.0.0.100 to 10.0.0.254 for chips
// Reserved: 10.0.0.1 to 10.0.0.99 for infrastructure (KVM4=10.0.0.1, KVM8=10.0.0.2, etc.)
const WG_CHIP_IP_START = parseInt(process.env.WIREGUARD_CHIP_IP_START || '100', 10)

export function generateWireGuardIp(usedIps: string[]): string {
  const baseIp = process.env.WIREGUARD_SUBNET || '10.0.0'
  for (let i = WG_CHIP_IP_START; i <= 254; i++) {
    const ip = `${baseIp}.${i}`
    if (!usedIps.includes(ip)) {
      return ip
    }
  }
  throw new Error('No available WireGuard IPs')
}

// Generate SOCKS port — default 8080 (Every Proxy default port on Android)
export function generateSocksPort(usedPorts: number[]): number {
  for (let port = 8080; port <= 8099; port++) {
    if (!usedPorts.includes(port)) {
      return port
    }
  }
  // Fallback to legacy range
  for (let port = 1080; port <= 1099; port++) {
    if (!usedPorts.includes(port)) {
      return port
    }
  }
  throw new Error('No available SOCKS ports')
}

