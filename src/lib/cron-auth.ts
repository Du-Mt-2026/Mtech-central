import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * Fail-closed CRON authentication helper.
 *
 * SECURITY: In production (NODE_ENV=production), if CRON_SECRET is not set,
 * the endpoint returns 503 — refusing to process the request. This prevents
 * the "footgun" scenario where CRON_SECRET defaults to empty in docker-compose
 * and the endpoint becomes publicly accessible.
 *
 * In development (NODE_ENV !== production), if CRON_SECRET is not set, the
 * endpoint allows the request with a warning (useful for local dev).
 *
 * Supported auth methods (any of):
 *   - Header: x-cron-secret: <secret>
 *   - Header: authorization: Bearer <secret>
 *   - Query:  ?cron_secret=<secret>
 *   - Body:   { "cron_secret": "<secret>" }   (cloned, doesn't consume body)
 *
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * Usage:
 *   import { verifyCronAuth } from '@/lib/cron-auth'
 *   export async function POST(request: NextRequest) {
 *     const authError = await verifyCronAuth(request)
 *     if (authError) return authError
 *     // ... handler body
 *   }
 */
export async function verifyCronAuth(request: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET
  const isProduction = process.env.NODE_ENV === 'production'

  // Fail-closed: in production without CRON_SECRET configured, refuse all requests.
  if (!cronSecret) {
    if (isProduction) {
      console.error('[CronAuth] CRON_SECRET not configured in production — endpoint disabled (fail-closed)')
      return NextResponse.json(
        {
          error: 'Endpoint disabled — CRON_SECRET not configured',
          hint: 'Set CRON_SECRET in environment variables to enable this cron endpoint',
        },
        { status: 503 }
      )
    }
    // Dev mode: allow with warning
    console.warn('[CronAuth] CRON_SECRET not set in development — allowing request (fail-open in dev only)')
    return null
  }

  // Collect the provided secret from any supported location
  const headerSecret = request.headers.get('x-cron-secret')
    || request.headers.get('authorization')?.replace('Bearer ', '')
    || null
  const querySecret = new URL(request.url).searchParams.get('cron_secret')

  let bodyCronSecret: string | undefined
  try {
    const clonedRequest = request.clone()
    const body = await clonedRequest.json()
    bodyCronSecret = body?.cron_secret
  } catch {
    // no body or invalid JSON — ignore
  }

  const providedSecret = headerSecret || querySecret || bodyCronSecret

  if (!providedSecret) {
    return NextResponse.json(
      { error: 'Unauthorized — missing cron secret' },
      { status: 401 }
    )
  }

  // Timing-safe comparison — both must be same length first
  const secretBuffer = Buffer.from(cronSecret, 'utf8')
  const providedBuffer = Buffer.from(providedSecret, 'utf8')

  if (secretBuffer.length !== providedBuffer.length) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid cron secret' },
      { status: 401 }
    )
  }

  if (!timingSafeEqual(secretBuffer, providedBuffer)) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid cron secret' },
      { status: 401 }
    )
  }

  return null // authorized
}

/**
 * GitHub webhook IP allowlist check.
 *
 * GitHub sends webhooks from a known set of IP ranges (both IPv4 and IPv6).
 * This function validates that the incoming request originates from GitHub.
 *
 * Source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses
 *
 * Usage:
 *   import { isGitHubWebhookIp } from '@/lib/cron-auth'
 *   if (!isGitHubWebhookIp(request)) {
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *   }
 *
 * Note: behind Cloudflare or other reverse proxy, this checks the x-forwarded-for
 * header (first IP in the chain) and the cf-connecting-ip header.
 */
const GITHUB_WEBHOOK_IPV4_RANGES = [
  '192.30.252.0/22',
  '185.199.108.0/22',
  '140.82.112.0/16',
  '143.55.64.0/20',
  '20.201.28.151/32',
  '20.220.46.146/32',
]

export function isGitHubWebhookIp(request: NextRequest): boolean {
  // Behind Cloudflare/Traefik, the real client IP is in these headers
  const cfIp = request.headers.get('cf-connecting-ip')
  const xff = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')

  const candidateIps: string[] = []
  if (cfIp) candidateIps.push(cfIp.trim())
  if (xff) candidateIps.push(xff.split(',')[0].trim())
  if (realIp) candidateIps.push(realIp.trim())

  // If no forwarded IP info at all, allow (deploy without reverse proxy)
  // — the X-Deploy-Secret still protects the endpoint in this case.
  if (candidateIps.length === 0) {
    console.warn('[GitHubIP] No forwarded IP headers found — allowing (relying on deploy secret only)')
    return true
  }

  for (const ip of candidateIps) {
    if (isIpInRanges(ip, GITHUB_WEBHOOK_IPV4_RANGES)) {
      return true
    }
  }

  return false
}

function isIpInRanges(ip: string, ranges: string[]): boolean {
  for (const range of ranges) {
    if (isIpInCidr(ip, range)) return true
  }
  return false
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)

  const ipParts = ip.split('.').map(p => parseInt(p, 10))
  const rangeParts = range.split('.').map(p => parseInt(p, 10))

  if (ipParts.length !== 4 || rangeParts.length !== 4) return false
  if (ipParts.some(p => isNaN(p) || p < 0 || p > 255)) return false
  if (rangeParts.some(p => isNaN(p) || p < 0 || p > 255)) return false

  // Convert to 32-bit integers
  const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]
  const rangeInt = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3]

  // Handle >>> to force unsigned
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0

  return (ipInt >>> 0 & mask) === (rangeInt >>> 0 & mask)
}
