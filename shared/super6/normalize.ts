/**
 * Translate Sky Super 6 responses into FourFold's domain model.
 *
 * These functions are pure and total: given any input, including garbage, they
 * either produce a valid `Round` or throw a `Super6NormalizeError`. They never
 * return a half-populated object, because a partially-parsed round could
 * otherwise overwrite good data during a sync.
 */
import type {
  Fixture,
  FixtureStatus,
  Round,
  RoundStatus,
} from '../domain/types'
import type { RawMatch, RawRoundDetail, RawScoreChallenge } from './types'

export class Super6NormalizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Super6NormalizeError'
  }
}

/** Sky's round statuses, as documented in the OpenAPI spec's `Round` schema. */
const ROUND_STATUS: Readonly<Record<string, RoundStatus>> = {
  open: 'open',
  inplay: 'inplay',
  complete: 'complete',
  future: 'future',
}

/**
 * Sky's match statuses, from the spec's `Match.status` pattern:
 * `Pre Live|Kick Off|Half Time|Half Time Started|Second Half Started|Full Time|
 *  Match Complete|Result|Abandoned|Postponed`
 */
const FIXTURE_STATUS: Readonly<Record<string, FixtureStatus>> = {
  'pre live': 'scheduled',
  'kick off': 'live',
  'half time': 'live',
  'half time started': 'live',
  'second half started': 'live',
  'full time': 'finished',
  'match complete': 'finished',
  result: 'finished',
  abandoned: 'abandoned',
  postponed: 'postponed',
}

export function normalizeRoundStatus(raw: unknown): RoundStatus {
  if (typeof raw !== 'string') return 'unknown'
  return ROUND_STATUS[raw.trim().toLowerCase()] ?? 'unknown'
}

export function normalizeFixtureStatus(raw: unknown): FixtureStatus {
  if (typeof raw !== 'string') return 'unknown'
  return FIXTURE_STATUS[raw.trim().toLowerCase()] ?? 'unknown'
}

/** True once the fixture has started, i.e. once a score means something. */
function hasMeaningfulScore(status: FixtureStatus): boolean {
  return status === 'live' || status === 'finished'
}

function asIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString()
}

function asIntOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.trunc(value)
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Normalise one fixture.
 *
 * Scores are reported as `null` until the match has actually started. Sky
 * returns `score: 0` for both teams before kick-off, and surfacing that as a
 * 0-0 result would make every unplayed fixture look like a score draw.
 */
export function normalizeFixture(
  challenge: RawScoreChallenge,
  /** Our 1-6 ordinal within the round. Sky's challenge id is not usable for this. */
  position: number,
): Fixture {
  const match: RawMatch = challenge?.match ?? {}
  const status = normalizeFixtureStatus(match.status)
  const scoresMeaningful = hasMeaningfulScore(status)

  const homeTeam = asStringOrNull(match.homeTeam?.name)
  const awayTeam = asStringOrNull(match.awayTeam?.name)
  if (!homeTeam || !awayTeam) {
    throw new Super6NormalizeError(
      `Fixture at position ${position} is missing team names`,
    )
  }

  return {
    externalMatchId: asIntOrNull(match.id),
    externalChallengeId: asIntOrNull(challenge?.id),
    position,
    homeTeam,
    awayTeam,
    homeTeamId: asIntOrNull(match.homeTeam?.id),
    awayTeamId: asIntOrNull(match.awayTeam?.id),
    homeShortName: asStringOrNull(match.homeTeam?.shortname),
    awayShortName: asStringOrNull(match.awayTeam?.shortname),
    kickOffAt: asIsoOrNull(match.kickOffDateTime),
    homeScore: scoresMeaningful ? asIntOrNull(match.homeTeam?.score) : null,
    awayScore: scoresMeaningful ? asIntOrNull(match.awayTeam?.score) : null,
    status,
    rawStatus: asStringOrNull(match.status),
    competition: asStringOrNull(match.competitionName),
    void: challenge?.void === true,
  }
}

export interface NormalizeRoundOptions {
  /**
   * Season to attribute the round to. `GET /round` omits `season`, so callers
   * that only have a summary must supply it (normally from `/round/active`).
   */
  fallbackSeasonId?: string
  /** Injected for deterministic tests. */
  now?: () => string
  /** Preserved from an existing record so re-syncing does not reset it. */
  importedAt?: string
}

/**
 * Build our composite round id.
 *
 * Super 6 round ids restart at 1 each season, so the season must be part of the
 * key or 2026-27 round 1 would collide with 2025-26 round 1.
 */
export function roundKey(seasonId: string, externalRoundId: number): string {
  return `${seasonId}:${externalRoundId}`
}

export function normalizeRound(
  raw: RawRoundDetail,
  options: NormalizeRoundOptions = {},
): Round {
  if (!raw || typeof raw !== 'object') {
    throw new Super6NormalizeError('Round payload is not an object')
  }

  const externalRoundId = asIntOrNull(raw.id)
  if (externalRoundId === null || externalRoundId <= 0) {
    throw new Super6NormalizeError(`Round payload has no usable id: ${String(raw.id)}`)
  }

  const seasonId = asStringOrNull(raw.season) ?? options.fallbackSeasonId ?? null
  if (!seasonId) {
    throw new Super6NormalizeError(
      `Round ${externalRoundId} has no season and no fallback was supplied`,
    )
  }

  // Order by Sky's challenge id (which ascends within a round) and then number
  // the fixtures 1-6 ourselves. Sky's ids are season-wide, so using them
  // directly would label round 2's fixtures "8" to "13".
  const rawChallenges = Array.isArray(raw.scoreChallenges) ? [...raw.scoreChallenges] : []
  rawChallenges.sort((a, b) => (asIntOrNull(a?.id) ?? 0) - (asIntOrNull(b?.id) ?? 0))
  const fixtures = rawChallenges.map((challenge, index) =>
    normalizeFixture(challenge, index + 1),
  )

  const nowIso = (options.now ?? (() => new Date().toISOString()))()

  return {
    id: roundKey(seasonId, externalRoundId),
    seasonId,
    externalRoundId,
    name: `Round ${externalRoundId}`,
    roundNumber: externalRoundId,
    status: normalizeRoundStatus(raw.status),
    startsAt: asIsoOrNull(raw.startDateTime),
    endsAt: asIsoOrNull(raw.endDateTime),
    fixtures,
    importedAt: options.importedAt ?? nowIso,
    lastSyncedAt: nowIso,
    source: 'super6',
  }
}

/** Which way a finished fixture went, or null if it is not decided yet. */
export function fixtureOutcome(fixture: Fixture): 'home' | 'draw' | 'away' | null {
  if (fixture.status !== 'finished') return null
  const { homeScore, awayScore } = fixture
  if (homeScore === null || awayScore === null) return null
  if (homeScore > awayScore) return 'home'
  if (homeScore < awayScore) return 'away'
  return 'draw'
}

/**
 * True once a round can be treated as immutable history.
 *
 * Used by the sync to stop rewriting old rounds. A round is only final when Sky
 * says it is complete AND every fixture has reached a terminal state, so a
 * late-finishing or postponed match still gets picked up.
 */
export function isRoundFinal(round: Round): boolean {
  if (round.status !== 'complete') return false
  if (round.fixtures.length === 0) return false
  return round.fixtures.every(
    (f) =>
      f.void ||
      f.status === 'finished' ||
      f.status === 'abandoned' ||
      f.status === 'postponed',
  )
}
