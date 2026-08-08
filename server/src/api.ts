/**
 * The FourFold API.
 *
 * Written against a small transport-neutral request/response shape rather than
 * Lambda's event types, so the whole API can be tested without AWS. The Lambda
 * Function URL adapter lives in handler.ts.
 *
 * Public routes are read-only. Every mutation requires a valid admin token, and
 * every input is validated here on the server regardless of what the frontend
 * does.
 */
import { randomUUID } from 'node:crypto'
import { MoneyParseError, parseReturnToPence } from '../../shared/domain/money'
import { PLAYERS } from '../../shared/domain/players'
import {
  calculateSeasonSummary,
  calculateStandings,
  returnsForRound,
} from '../../shared/domain/standings'
import { pickCurrentRound } from '../../shared/domain/rounds'
import type { Return, Round, Season, StandingRow } from '../../shared/domain/types'
import { Super6Client } from '../../shared/super6/client'
import type { AppConfig } from './config'
import {
  LoginThrottle,
  bearerToken,
  issueToken,
  verifyPassword,
  verifyToken,
} from './auth'
import type { FourFoldRepository } from './repo/types'
import { syncSuper6 } from './sync'

export interface ApiRequest {
  method: string
  /** Path with any stage prefix already stripped, e.g. `/api/seasons/2026-27`. */
  path: string
  query: Record<string, string | undefined>
  headers: Record<string, string | undefined>
  /** Parsed JSON body, or undefined. */
  body?: unknown
  sourceIp: string
}

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface ApiDeps {
  repo: FourFoldRepository
  config: AppConfig
  super6?: Super6Client
  now?: () => string
  throttle?: LoginThrottle
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

/** Shared across invocations in the same container, like the throttle itself. */
const defaultThrottle = new LoginThrottle()

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body })

/* ------------------------------------------------------------------ *
 * Validation helpers. Everything crossing the wire goes through these.
 * ------------------------------------------------------------------ */

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Expected a JSON object')
  }
  return body as Record<string, unknown>
}

function requireString(
  source: Record<string, unknown>,
  field: string,
  maxLength = 200,
): string {
  const value = source[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `"${field}" is required`)
  }
  if (value.length > maxLength) {
    throw new HttpError(400, `"${field}" is too long`)
  }
  return value.trim()
}

function optionalNote(source: Record<string, unknown>): string | undefined {
  const value = source.note
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new HttpError(400, '"note" must be a string')
  if (value.length > 300) throw new HttpError(400, '"note" is too long')
  return value.trim()
}

/** Parse a money amount, converting a parse failure into a 400. */
function requireAmountPence(source: Record<string, unknown>): number {
  const raw = source.amount ?? source.amountPence
  if (raw === undefined || raw === null || raw === '') {
    throw new HttpError(400, '"amount" is required')
  }

  // amountPence is accepted as an integer for API callers; amount is the
  // human-entered pounds string the admin form sends.
  if (source.amountPence !== undefined && source.amount === undefined) {
    if (!Number.isInteger(raw) || (raw as number) < 0) {
      throw new HttpError(400, '"amountPence" must be a non-negative integer')
    }
    return raw as number
  }

  try {
    return parseReturnToPence(raw as string | number)
  } catch (error) {
    if (error instanceof MoneyParseError) {
      throw new HttpError(400, 'Enter a valid amount in pounds, e.g. 18.40')
    }
    throw error
  }
}

/* ------------------------------------------------------------------ *
 * Read models
 * ------------------------------------------------------------------ */

interface RoundView extends Round {
  /** Aggregated per-player returns for this round, highest first. */
  returns: { playerId: string; playerName: string; amountPence: number }[]
  /** The individual records, so the admin page can edit or delete each one. */
  returnRecords: Return[]
}

async function seasonView(repo: FourFoldRepository, seasonId: string) {
  const bundle = await repo.getSeasonBundle(seasonId)
  if (!bundle) throw new HttpError(404, 'Season not found')

  const input = {
    seasonId: bundle.season.id,
    seasonName: bundle.season.name,
    playerIds: bundle.season.playerIds,
    rounds: bundle.rounds,
    returns: bundle.returns,
    participation: bundle.participation,
  }

  const rounds: RoundView[] = bundle.rounds.map((round) => ({
    ...round,
    returns: returnsForRound(bundle.returns, round.id),
    returnRecords: bundle.returns
      .filter((r) => r.roundId === round.id)
      .sort((a, b) => a.playerId.localeCompare(b.playerId)),
  }))

  // Which round the competition is actually on. Not simply the highest-numbered
  // one: Super 6 announces future rounds weeks ahead.
  const current = pickCurrentRound(bundle.rounds)

  return {
    season: bundle.season,
    summary: calculateSeasonSummary(input),
    standings: calculateStandings(input),
    currentRoundId: current?.round.id ?? null,
    currentRoundKind: current?.kind ?? null,
    // Newest first: the latest round is what people want to see.
    rounds: rounds.reverse(),
  }
}

/**
 * The winner of a completed season, for the seasons list.
 *
 * Null while a season has produced no returns at all — everyone is level on
 * nothing, so naming a "winner" would be meaningless.
 */
function seasonWinner(standings: StandingRow[]): {
  playerId: string
  playerName: string
  totalReturnPence: number
} | null {
  const top = standings[0]
  if (!top || top.totalReturnPence <= 0) return null
  return {
    playerId: top.playerId,
    playerName: top.playerName,
    totalReturnPence: top.totalReturnPence,
  }
}

/**
 * Pick the season to show by default: the active one, else the most recent.
 */
function pickCurrentSeason(seasons: Season[]): Season | undefined {
  return seasons.find((s) => s.status === 'active') ?? seasons[0]
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

export async function handleRequest(
  request: ApiRequest,
  deps: ApiDeps,
): Promise<ApiResponse> {
  const logger = deps.logger ?? console

  try {
    return await route(request, deps)
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { error: error.message } }
    }
    // Never leak a stack trace or an AWS error detail to the browser.
    logger.error('[api] unhandled error', error)
    return { status: 500, body: { error: 'Something went wrong' } }
  }
}

async function route(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { repo } = deps
  const path = request.path.replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean)

  // Strip the leading "api" so the routes read the same locally and deployed.
  if (segments[0] === 'api') segments.shift()

  const [first, second, third] = segments
  const method = request.method.toUpperCase()

  /* ---------------- public ---------------- */

  if (method === 'GET' && first === 'health') {
    return ok({ status: 'ok' })
  }

  if (method === 'GET' && first === 'players') {
    return ok({ players: PLAYERS })
  }

  if (method === 'GET' && first === 'seasons' && !second) {
    const seasons = await repo.listSeasons()

    // Each season's winner and totals, so the seasons page can show who won
    // without the browser fetching every season separately. Five seasons of a
    // few hundred rows each; the whole thing is a handful of queries.
    const withResults = await Promise.all(
      seasons.map(async (season) => {
        const bundle = await repo.getSeasonBundle(season.id)
        if (!bundle) return { ...season, summary: null, winner: null }

        const input = {
          seasonId: season.id,
          seasonName: season.name,
          playerIds: season.playerIds,
          rounds: bundle.rounds,
          returns: bundle.returns,
          participation: bundle.participation,
        }
        return {
          ...season,
          summary: calculateSeasonSummary(input),
          winner: seasonWinner(calculateStandings(input)),
        }
      }),
    )

    return ok({
      seasons: withResults,
      currentSeasonId: pickCurrentSeason(seasons)?.id ?? null,
    })
  }

  if (method === 'GET' && first === 'seasons' && second && !third) {
    return ok(await seasonView(repo, decodeURIComponent(second)))
  }

  /**
   * Everything the home page needs in one request: the current season's table,
   * its rounds and fixtures, and when Sky was last synced.
   */
  if (method === 'GET' && first === 'current') {
    const seasons = await repo.listSeasons()
    const current = pickCurrentSeason(seasons)
    if (!current) {
      return ok({ seasons: [], season: null, standings: [], rounds: [], summary: null, sync: null })
    }

    const view = await seasonView(repo, current.id)
    const sync = await repo.getSyncState()
    return ok({
      ...view,
      seasons,
      // Only the successful-sync time is public; errors are for the admin.
      sync: sync ? { lastSuccessAt: sync.lastSuccessAt, latestRoundId: sync.latestRoundId } : null,
    })
  }

  /* ---------------- admin ---------------- */

  if (method === 'POST' && first === 'admin' && second === 'login') {
    return await login(request, deps)
  }

  if (first === 'admin') {
    // Every remaining admin route is a mutation or exposes diagnostics.
    requireAdmin(request, deps.config)

    if (method === 'GET' && second === 'sync') {
      const state = await repo.getSyncState()
      return ok({ sync: state ?? null })
    }

    if (method === 'POST' && second === 'sync') {
      const client =
        deps.super6 ??
        new Super6Client(
          deps.config.super6BaseUrl ? { baseUrl: deps.config.super6BaseUrl } : {},
        )
      const result = await syncSuper6({ client, repo, now: deps.now, logger: deps.logger })
      const state = await repo.getSyncState()
      // A failed sync is reported as 200 with ok:false — the request itself
      // succeeded, and the admin page renders the detail.
      return ok({ result, sync: state ?? null })
    }

    if (second === 'returns') {
      if (method === 'POST' && !third) return await createReturn(request, deps)
      if (method === 'PUT' && third) return await updateReturn(request, deps, third)
      if (method === 'DELETE' && third) return await deleteReturn(request, deps, third)
    }
  }

  throw new HttpError(404, 'Not found')
}

async function login(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const throttle = deps.throttle ?? defaultThrottle
  const key = request.sourceIp || 'unknown'

  if (throttle.isBlocked(key)) {
    throw new HttpError(429, 'Too many attempts. Try again later.')
  }

  const body = asObject(request.body)
  const password = body.password

  if (!deps.config.adminPasswordHash || !deps.config.tokenSecret) {
    ;(deps.logger ?? console).error('[api] admin secrets are not configured')
    throw new HttpError(503, 'Admin access is not configured')
  }

  const valid =
    typeof password === 'string' &&
    (await verifyPassword(password, deps.config.adminPasswordHash))

  if (!valid) {
    throttle.recordFailure(key)
    // Deliberately vague: no hint about whether a password was even set.
    throw new HttpError(401, 'Incorrect password')
  }

  throttle.recordSuccess(key)
  const token = issueToken(deps.config.tokenSecret)
  return ok({ token })
}

function requireAdmin(request: ApiRequest, config: AppConfig): void {
  const header = request.headers.authorization ?? request.headers.Authorization
  const token = bearerToken(header)
  if (!verifyToken(token, config.tokenSecret)) {
    throw new HttpError(401, 'Sign in again')
  }
}

/** Check the season exists, and that the round and player belong to it. */
async function resolveTarget(
  repo: FourFoldRepository,
  seasonId: string,
  roundId: string,
  playerId: string,
) {
  const bundle = await repo.getSeasonBundle(seasonId)
  if (!bundle) throw new HttpError(404, 'Season not found')

  if (!bundle.rounds.some((r) => r.id === roundId)) {
    throw new HttpError(404, 'Round not found in that season')
  }
  if (!bundle.season.playerIds.includes(playerId)) {
    throw new HttpError(400, 'That player did not play in that season')
  }
  return bundle
}

async function createReturn(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const body = asObject(request.body)
  const seasonId = requireString(body, 'seasonId', 20)
  const roundId = requireString(body, 'roundId', 40)
  const playerId = requireString(body, 'playerId', 40)
  const amountPence = requireAmountPence(body)
  const note = optionalNote(body)

  await resolveTarget(deps.repo, seasonId, roundId, playerId)

  const nowIso = (deps.now ?? (() => new Date().toISOString()))()
  const value: Return = {
    id: randomUUID(),
    seasonId,
    roundId,
    playerId,
    amountPence,
    note,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  await deps.repo.putReturn(value)

  return { status: 201, body: { return: value } }
}

async function updateReturn(
  request: ApiRequest,
  deps: ApiDeps,
  returnId: string,
): Promise<ApiResponse> {
  const body = asObject(request.body)
  const seasonId = requireString(body, 'seasonId', 20)
  const amountPence = requireAmountPence(body)
  const note = optionalNote(body)

  const existing = await deps.repo.getReturn(seasonId, returnId)
  if (!existing) throw new HttpError(404, 'Return not found')

  const updated: Return = {
    ...existing,
    amountPence,
    note: note ?? existing.note,
    updatedAt: (deps.now ?? (() => new Date().toISOString()))(),
  }
  await deps.repo.putReturn(updated)

  return ok({ return: updated })
}

async function deleteReturn(
  request: ApiRequest,
  deps: ApiDeps,
  returnId: string,
): Promise<ApiResponse> {
  const seasonId =
    request.query.seasonId ??
    (request.body ? (asObject(request.body).seasonId as string | undefined) : undefined)

  if (!seasonId) throw new HttpError(400, '"seasonId" is required')

  const existing = await deps.repo.getReturn(seasonId, returnId)
  if (!existing) throw new HttpError(404, 'Return not found')

  await deps.repo.deleteReturn(seasonId, returnId)
  return ok({ deleted: returnId })
}

/* ------------------------------------------------------------------ *
 * CORS
 * ------------------------------------------------------------------ */

/**
 * Build CORS headers for a request.
 *
 * Only exact configured origins are reflected. With none configured the API is
 * same-origin only, which is the right default — the browser needs no CORS
 * header when the SPA and API share a host.
 */
export function corsHeaders(
  origin: string | undefined,
  config: AppConfig,
): Record<string, string> {
  if (!origin || !config.allowedOrigins.includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '3600',
    vary: 'origin',
  }
}
