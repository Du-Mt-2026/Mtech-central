// Auth utility: JWT creation/verification + password hashing
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'octupuszap-dev-secret-change-in-production'
)

const COOKIE_NAME = 'octupuszap-session'
const TOKEN_EXPIRY = '7d'

export interface SessionPayload {
  userId: string
  username: string
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

/**
 * Verify a password against a bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Create a JWT token for a user session
 */
export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(AUTH_SECRET)
}

/**
 * Verify a JWT token and return the payload
 */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, AUTH_SECRET)
    return {
      userId: payload.userId as string,
      username: payload.username as string,
    }
  } catch {
    return null
  }
}

/**
 * Set the session cookie in the response
 */
export function setSessionCookie(token: string): {
  name: string
  value: string
  options: {
    httpOnly: boolean
    secure: boolean
    sameSite: 'lax' | 'strict' | 'none'
    path: string
    maxAge: number
  }
} {
  return {
    name: COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  }
}

/**
 * Get the current session from cookies (server-side)
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null
    return verifyToken(token)
  } catch {
    return null
  }
}

/**
 * Get cookie name for clearing
 */
export function getCookieName(): string {
  return COOKIE_NAME
}
