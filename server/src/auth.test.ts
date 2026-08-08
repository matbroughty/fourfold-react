import { describe, expect, it } from 'vitest'
import {
  AuthError,
  LoginThrottle,
  TOKEN_TTL_SECONDS,
  bearerToken,
  hashPassword,
  issueToken,
  verifyPassword,
  verifyToken,
} from './auth'

const SECRET = 'a'.repeat(64)

describe('password hashing', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('correct horse battery')

    expect(await verifyPassword('correct horse battery', stored)).toBe(true)
    expect(await verifyPassword('Correct horse battery', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
    expect(await verifyPassword('correct horse batter', stored)).toBe(false)
  })

  it('never stores the password itself', async () => {
    const stored = await hashPassword('hunter2hunter2')

    expect(stored).not.toContain('hunter2')
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true)
  })

  it('salts, so the same password hashes differently each time', async () => {
    const a = await hashPassword('the same password')
    const b = await hashPassword('the same password')

    expect(a).not.toBe(b)
    expect(await verifyPassword('the same password', a)).toBe(true)
    expect(await verifyPassword('the same password', b)).toBe(true)
  })

  it('refuses to hash a trivially short password', async () => {
    await expect(hashPassword('short')).rejects.toThrow(AuthError)
  })

  it('denies access when the stored hash is malformed, without throwing', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$16384$8$1$aa$bb', 'scrypt$16384$8$1$aa$']) {
      expect(await verifyPassword('anything', bad), bad).toBe(false)
    }
  })
})

describe('session tokens', () => {
  it('issues a token that verifies', () => {
    const token = issueToken(SECRET, 1_000_000)
    expect(verifyToken(token, SECRET, 1_000_000)).toBe(true)
  })

  it('expires', () => {
    const token = issueToken(SECRET, 1_000_000)

    expect(verifyToken(token, SECRET, 1_000_000 + TOKEN_TTL_SECONDS - 1)).toBe(true)
    expect(verifyToken(token, SECRET, 1_000_000 + TOKEN_TTL_SECONDS + 1)).toBe(false)
  })

  it('rejects a token signed with a different secret', () => {
    const token = issueToken(SECRET, 1_000_000)
    expect(verifyToken(token, 'b'.repeat(64), 1_000_000)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const token = issueToken(SECRET, 1_000_000)
    const [, signature] = token.split('.')

    const forged = Buffer.from(
      JSON.stringify({ iat: 1_000_000, exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url')

    expect(verifyToken(`${forged}.${signature}`, SECRET, 1_000_000)).toBe(false)
  })

  it('rejects junk', () => {
    for (const bad of [undefined, '', '.', 'nodot', 'a.b', '.abc', 'abc.']) {
      expect(verifyToken(bad, SECRET, 1_000_000), String(bad)).toBe(false)
    }
  })

  it('rejects everything when no secret is configured', () => {
    const token = issueToken(SECRET, 1_000_000)
    expect(verifyToken(token, '', 1_000_000)).toBe(false)
    expect(() => issueToken('')).toThrow(AuthError)
  })

  it('carries no secret in the payload', () => {
    const token = issueToken(SECRET, 1_000_000)
    const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8')

    expect(payload).not.toContain(SECRET)
    expect(JSON.parse(payload)).toEqual({ iat: 1_000_000, exp: 1_000_000 + TOKEN_TTL_SECONDS })
  })
})

describe('bearerToken', () => {
  it('extracts a bearer token case-insensitively', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def')
    expect(bearerToken('bearer abc.def')).toBe('abc.def')
    expect(bearerToken('  Bearer   abc.def  ')).toBe('abc.def')
  })

  it('ignores anything else', () => {
    expect(bearerToken(undefined)).toBeUndefined()
    expect(bearerToken('')).toBeUndefined()
    expect(bearerToken('Basic abc')).toBeUndefined()
    expect(bearerToken('abc.def')).toBeUndefined()
  })
})

describe('LoginThrottle', () => {
  it('blocks after the configured number of failures', () => {
    const throttle = new LoginThrottle(3, 60_000)

    expect(throttle.isBlocked('1.2.3.4', 0)).toBe(false)
    throttle.recordFailure('1.2.3.4', 0)
    throttle.recordFailure('1.2.3.4', 0)
    expect(throttle.isBlocked('1.2.3.4', 0)).toBe(false)
    throttle.recordFailure('1.2.3.4', 0)
    expect(throttle.isBlocked('1.2.3.4', 0)).toBe(true)
  })

  it('forgets failures once the window passes', () => {
    const throttle = new LoginThrottle(2, 60_000)
    throttle.recordFailure('1.2.3.4', 0)
    throttle.recordFailure('1.2.3.4', 0)

    expect(throttle.isBlocked('1.2.3.4', 59_999)).toBe(true)
    expect(throttle.isBlocked('1.2.3.4', 60_001)).toBe(false)
  })

  it('clears on success', () => {
    const throttle = new LoginThrottle(2, 60_000)
    throttle.recordFailure('1.2.3.4', 0)
    throttle.recordSuccess('1.2.3.4')
    throttle.recordFailure('1.2.3.4', 0)

    expect(throttle.isBlocked('1.2.3.4', 0)).toBe(false)
  })

  it('tracks callers independently', () => {
    const throttle = new LoginThrottle(1, 60_000)
    throttle.recordFailure('1.2.3.4', 0)

    expect(throttle.isBlocked('1.2.3.4', 0)).toBe(true)
    expect(throttle.isBlocked('5.6.7.8', 0)).toBe(false)
  })
})
