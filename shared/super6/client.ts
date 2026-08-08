/**
 * Super6Client — the only place in FourFold that talks HTTP to Sky.
 *
 * Everything else depends on this interface, so if Sky changes their API,
 * disables it, or we move to a different fixture provider, this file and
 * normalize.ts are the only things that need to change.
 *
 * No authentication is required for the endpoints we use (see
 * docs/super6-api.md). We send no credentials and only ever issue GETs.
 */
import type { Round } from '../domain/types'
import { normalizeRound, type NormalizeRoundOptions } from './normalize'
import type { RawRoundDetail, RawRoundSummary } from './types'

export const SUPER6_DEFAULT_BASE_URL = 'https://api.s6.sbgservices.com/v2'

/** Sky is unreachable, timed out, or returned a server error. Retryable. */
export class Super6UnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'Super6UnavailableError'
  }
}

/** Sky responded, but the thing we asked for does not exist. Not retryable. */
export class Super6NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Super6NotFoundError'
  }
}

/** A lightweight round summary from `GET /round` (no season, no fixtures). */
export interface Super6RoundSummary {
  externalRoundId: number
  status: string | null
  startsAt: string | null
  endsAt: string | null
}

export interface Super6ClientOptions {
  baseUrl?: string
  /** Injected in tests; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Attempts per request, including the first. */
  maxAttempts?: number
  /** Injected in tests to avoid real delays. */
  sleepFn?: (ms: number) => Promise<void>
  /** Diagnostics sink. Defaults to console. */
  logger?: Pick<Console, 'warn' | 'info'>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class Super6Client {
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly logger: Pick<Console, 'warn' | 'info'>

  constructor(options: Super6ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? SUPER6_DEFAULT_BASE_URL).replace(/\/$/, '')
    this.fetchFn = options.fetchFn ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 8000
    this.maxAttempts = options.maxAttempts ?? 3
    this.sleepFn = options.sleepFn ?? defaultSleep
    this.logger = options.logger ?? console

    if (typeof this.fetchFn !== 'function') {
      throw new Error('Super6Client requires fetch (Node 18+) or an injected fetchFn')
    }
  }

  /** Liveness check against `GET /ping`, which returns the string `healthy`. */
  async ping(): Promise<boolean> {
    try {
      const response = await this.fetchOnce('/ping')
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * The round currently accepting entries, via `GET /round/active`.
   *
   * This response includes both `season` and the six fixtures, which makes it
   * the cheapest useful call and the anchor for discovering the current season.
   */
  async getCurrentRound(options: NormalizeRoundOptions = {}): Promise<Round> {
    const raw = await this.getJson<RawRoundDetail>('/round/active')
    return normalizeRound(raw, options)
  }

  /**
   * A specific round via `GET /round/{roundId}`.
   *
   * `roundId` is Sky's per-season id, not our composite key. Sky only serves
   * rounds from the current season; older ids 404.
   */
  async getRound(
    externalRoundId: number,
    options: NormalizeRoundOptions = {},
  ): Promise<Round> {
    const raw = await this.getJson<RawRoundDetail>(`/round/${externalRoundId}`)
    return normalizeRound(raw, options)
  }

  /**
   * Every round Sky is currently advertising, via `GET /round`.
   *
   * Only the current season is returned, and the entries carry no season field
   * and no fixtures — fetch each round individually for those.
   */
  async getAvailableRounds(): Promise<Super6RoundSummary[]> {
    const raw = await this.getJson<RawRoundSummary[]>('/round')
    if (!Array.isArray(raw)) {
      throw new Super6UnavailableError('GET /round did not return an array')
    }
    return raw
      .map((entry) => ({
        externalRoundId: typeof entry?.id === 'number' ? Math.trunc(entry.id) : null,
        status: typeof entry?.status === 'string' ? entry.status : null,
        startsAt: typeof entry?.startDateTime === 'string' ? entry.startDateTime : null,
        endsAt: typeof entry?.endDateTime === 'string' ? entry.endDateTime : null,
      }))
      .filter((r): r is Super6RoundSummary => r.externalRoundId !== null)
      .sort((a, b) => a.externalRoundId - b.externalRoundId)
  }

  private async getJson<T>(path: string): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchOnce(path)

        if (response.status === 404) {
          throw new Super6NotFoundError(`Super 6 has no resource at ${path}`)
        }
        // 4xx other than 404 means we asked wrongly; retrying will not help.
        if (response.status >= 400 && response.status < 500) {
          throw new Super6NotFoundError(
            `Super 6 rejected ${path} with status ${response.status}`,
          )
        }
        if (!response.ok) {
          throw new Super6UnavailableError(
            `Super 6 returned status ${response.status} for ${path}`,
          )
        }
        return (await response.json()) as T
      } catch (error) {
        // Never retry a definite "no".
        if (error instanceof Super6NotFoundError) throw error

        lastError = error
        if (attempt < this.maxAttempts) {
          const backoffMs = 250 * 2 ** (attempt - 1)
          this.logger.warn(
            `[super6] ${path} attempt ${attempt}/${this.maxAttempts} failed, ` +
              `retrying in ${backoffMs}ms: ${describeError(error)}`,
          )
          await this.sleepFn(backoffMs)
        }
      }
    }

    throw new Super6UnavailableError(
      `Super 6 request failed after ${this.maxAttempts} attempts: ${path}`,
      lastError,
    )
  }

  private async fetchOnce(path: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      throw new Super6UnavailableError(`Super 6 request to ${path} failed`, error)
    } finally {
      clearTimeout(timer)
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
