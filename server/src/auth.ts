/**
 * Admin authentication.
 *
 * One shared password, held as a scrypt hash in SSM Parameter Store. On success
 * the client gets a short-lived HMAC-signed token, which it sends back as a
 * bearer token on every mutation. There are no user accounts, no registration
 * and no Cognito — for a site with one administrator, those would be more
 * moving parts to secure, not fewer.
 *
 * What this does provide:
 *  - the password never appears in source control or in frontend JavaScript
 *  - the stored form is a salted scrypt hash, not the password
 *  - comparisons are constant-time
 *  - tokens are signed and expire, and carry no secrets
 *  - repeated failed logins are throttled
 */
import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/** scrypt parameters. Deliberately slow; login happens a handful of times a season. */
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 } as const

const HASH_PREFIX = 'scrypt'

/** How long an admin session lasts. Long enough to enter winnings unhurried. */
export const TOKEN_TTL_SECONDS = 12 * 60 * 60

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

const b64url = (buffer: Buffer): string => buffer.toString('base64url')

/**
 * Hash a password for storage.
 *
 * Output format: `scrypt$16384$8$1$<salt-b64url>$<hash-b64url>`
 * Generate one with `npx tsx scripts/hash-password.ts`.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 8) {
    throw new AuthError('Password must be at least 8 characters')
  }
  const salt = randomBytes(16)
  const derived = (await scrypt(password, salt, SCRYPT.keyLength)) as Buffer
  return [HASH_PREFIX, SCRYPT.N, SCRYPT.r, SCRYPT.p, b64url(salt), b64url(derived)].join('$')
}

/**
 * Verify a password against a stored hash, in constant time.
 *
 * Returns false rather than throwing on a malformed stored hash, so a
 * misconfigured parameter denies access instead of leaking the reason.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string') return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false

  const keyLength = Buffer.from(parts[5], 'base64url').length
  if (keyLength === 0) return false

  let derived: Buffer
  try {
    derived = (await scrypt(password, Buffer.from(parts[4], 'base64url'), keyLength)) as Buffer
  } catch {
    return false
  }

  const expected = Buffer.from(parts[5], 'base64url')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(expected, derived)
}

interface TokenPayload {
  /** Issued-at, epoch seconds. */
  iat: number
  /** Expiry, epoch seconds. */
  exp: number
}

/**
 * Mint a signed session token.
 *
 * Format: `<payload-b64url>.<hmac-b64url>`. The payload is not encrypted — it
 * holds only timestamps — but it cannot be tampered with.
 */
export function issueToken(
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): string {
  if (!secret) throw new AuthError('Token secret is not configured')

  const payload: TokenPayload = { iat: nowSeconds, exp: nowSeconds + ttlSeconds }
  const encoded = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${encoded}.${sign(encoded, secret)}`
}

function sign(encodedPayload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(encodedPayload).digest())
}

/**
 * Validate a session token. Returns true only for a well-formed, correctly
 * signed, unexpired token.
 */
export function verifyToken(
  token: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!token || !secret) return false

  const dot = token.indexOf('.')
  if (dot <= 0) return false

  const encodedPayload = token.slice(0, dot)
  const provided = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(encodedPayload, secret), 'base64url')

  if (provided.length !== expected.length) return false
  if (!timingSafeEqual(provided, expected)) return false

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as TokenPayload
    if (typeof payload.exp !== 'number') return false
    return payload.exp > nowSeconds
  } catch {
    return false
  }
}

/** Read a bearer token out of an Authorization header. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : undefined
}

/**
 * Login throttle.
 *
 * Held in Lambda memory, so it is per-container rather than global — a
 * determined attacker across many cold starts gets more attempts than the limit
 * suggests. That is an accepted trade-off: the alternative is a DynamoDB write
 * on every login attempt for a site with one user. The scrypt cost is the real
 * defence; this just stops casual hammering.
 */
export class LoginThrottle {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly maxAttempts = 8,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  /** True if this key has run out of attempts. */
  isBlocked(key: string, now: number = Date.now()): boolean {
    const entry = this.attempts.get(key)
    if (!entry) return false
    if (now >= entry.resetAt) {
      this.attempts.delete(key)
      return false
    }
    return entry.count >= this.maxAttempts
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const entry = this.attempts.get(key)
    if (!entry || now >= entry.resetAt) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs })
      return
    }
    entry.count += 1
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key)
  }
}
