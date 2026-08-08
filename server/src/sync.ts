/**
 * Super 6 synchronisation.
 *
 * Run on a schedule and from the admin "Sync Super 6" button. The same function
 * serves both so there is only one code path to reason about.
 *
 * Guarantees:
 *  - Idempotent. Rounds are keyed on (season, Sky round id), so running this a
 *    hundred times creates one round, not a hundred.
 *  - Non-destructive. Local rounds are never deleted, and a round that Sky has
 *    finished with is never rewritten.
 *  - Never throws. A Sky outage is recorded in the sync state and reported to
 *    the admin page; it must not take the public site down or fail the schedule.
 */
import { CURRENT_PLAYER_IDS } from '../../shared/domain/players'
import type { Round, Season, SyncState } from '../../shared/domain/types'
import {
  Super6Client,
  Super6NotFoundError,
  Super6UnavailableError,
} from '../../shared/super6/client'
import { isRoundFinal } from '../../shared/super6/normalize'
import type { FourFoldRepository } from './repo/types'

export interface SyncOptions {
  client: Super6Client
  repo: FourFoldRepository
  now?: () => string
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface SyncResult {
  ok: boolean
  seasonId: string | null
  latestRoundId: string | null
  roundsCreated: number
  roundsUpdated: number
  roundsSkipped: number
  /** Non-fatal problems, e.g. one round failed while the rest succeeded. */
  warnings: string[]
  error: string | null
}

/**
 * Fields that never change once written, and the sync clock, are excluded when
 * deciding whether a round actually changed. Otherwise every run would look
 * like an update and rewrite the whole season.
 */
function contentFingerprint(round: Round): string {
  const { importedAt: _importedAt, lastSyncedAt: _lastSyncedAt, ...content } = round
  return stableStringify(content)
}

/**
 * Serialise with keys in a fixed order, ignoring `undefined`.
 *
 * `JSON.stringify` preserves insertion order, and DynamoDB returns an item's
 * attributes in its own order — so comparing a freshly-normalised round with one
 * read back from the database made every field look changed even when nothing
 * had. The deployed sync reported "3 updated" on a second identical run instead
 * of "3 unchanged", rewriting the whole season every three hours.
 *
 * `undefined` is skipped because the DocumentClient is configured with
 * `removeUndefinedValues`, so an undefined field and an absent one are the same
 * thing once stored and must compare equal.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function seasonNameFromId(seasonId: string): string {
  // Sky uses "2026-27"; the competition has always written "2026/27".
  return seasonId.replace('-', '/')
}

function startYearFromId(seasonId: string): number {
  const year = Number.parseInt(seasonId.slice(0, 4), 10)
  return Number.isFinite(year) ? year : new Date().getFullYear()
}

async function ensureSeason(
  repo: FourFoldRepository,
  seasonId: string,
  nowIso: string,
  logger: Pick<Console, 'info'>,
): Promise<Season> {
  const existing = await repo.getSeason(seasonId)
  if (existing) return existing

  const season: Season = {
    id: seasonId,
    name: seasonNameFromId(seasonId),
    startYear: startYearFromId(seasonId),
    status: 'active',
    playerIds: [...CURRENT_PLAYER_IDS],
    imported: false,
    createdAt: nowIso,
  }
  await repo.putSeason(season)
  logger.info(`[sync] created season ${season.id}`)
  return season
}

/**
 * Store a round, unless we already hold an identical or finalised copy.
 *
 * Returns what happened so the caller can report counts.
 */
async function upsertRound(
  repo: FourFoldRepository,
  incoming: Round,
  logger: Pick<Console, 'info'>,
): Promise<'created' | 'updated' | 'skipped'> {
  const existing = await repo.getRound(incoming.id)

  if (!existing) {
    await repo.putRound(incoming)
    logger.info(`[sync] created round ${incoming.id} (${incoming.fixtures.length} fixtures)`)
    return 'created'
  }

  // Once a round is done it is history. Leave it alone.
  if (existing.source === 'super6' && isRoundFinal(existing)) return 'skipped'

  // Never let a thin response overwrite fixtures we already hold. Sky returns
  // rounds with no scoreChallenges in some states, and losing six fixtures
  // because of a transient response would be silent data loss.
  if (incoming.fixtures.length === 0 && existing.fixtures.length > 0) {
    logger.info(
      `[sync] keeping ${existing.fixtures.length} stored fixtures for ${incoming.id}; ` +
        `Super 6 returned none`,
    )
    return 'skipped'
  }

  const merged: Round = {
    ...incoming,
    // First-seen time belongs to us, not to Sky.
    importedAt: existing.importedAt,
  }

  if (contentFingerprint(existing) === contentFingerprint(merged)) return 'skipped'

  await repo.putRound(merged)
  logger.info(`[sync] updated round ${merged.id} (status ${merged.status})`)
  return 'updated'
}

export async function syncSuper6(options: SyncOptions): Promise<SyncResult> {
  const { client, repo } = options
  const now = options.now ?? (() => new Date().toISOString())
  const logger = options.logger ?? console
  const startedAt = now()

  const result: SyncResult = {
    ok: false,
    seasonId: null,
    latestRoundId: null,
    roundsCreated: 0,
    roundsUpdated: 0,
    roundsSkipped: 0,
    warnings: [],
    error: null,
  }

  const previous = await repo.getSyncState()

  try {
    // /round/active is the anchor: it is the only cheap call that returns both
    // the season and the six fixtures.
    const activeRound = await client.getCurrentRound({ now })
    const seasonId = activeRound.seasonId
    result.seasonId = seasonId

    await ensureSeason(repo, seasonId, startedAt, logger)

    // Discover the rest of the season. Sky only advertises the current season,
    // and the summaries carry no fixtures, so each round is fetched in full.
    let summaries: { externalRoundId: number }[]
    try {
      summaries = await client.getAvailableRounds()
    } catch (error) {
      // Losing discovery is survivable: we still have the active round.
      summaries = []
      const message = describe(error)
      result.warnings.push(`Could not list rounds: ${message}`)
      logger.warn(`[sync] GET /round failed, continuing with the active round only: ${message}`)
    }

    const seen = new Set<string>()
    const tally = async (round: Round) => {
      if (seen.has(round.id)) return
      seen.add(round.id)
      const outcome = await upsertRound(repo, round, logger)
      if (outcome === 'created') result.roundsCreated += 1
      else if (outcome === 'updated') result.roundsUpdated += 1
      else result.roundsSkipped += 1
    }

    await tally(activeRound)

    for (const summary of summaries) {
      const roundId = `${seasonId}:${summary.externalRoundId}`
      if (seen.has(roundId)) continue

      // Skip a fetch entirely if we already hold the finished article.
      const existing = await repo.getRound(roundId)
      if (existing && existing.source === 'super6' && isRoundFinal(existing)) {
        seen.add(roundId)
        result.roundsSkipped += 1
        continue
      }

      try {
        const round = await client.getRound(summary.externalRoundId, {
          fallbackSeasonId: seasonId,
          now,
          importedAt: existing?.importedAt,
        })
        await tally(round)
      } catch (error) {
        if (error instanceof Super6NotFoundError) {
          // Sky no longer serves this round. Ours stays exactly as it is.
          result.warnings.push(`Round ${summary.externalRoundId} is no longer available from Super 6`)
          continue
        }
        // One bad round must not abandon the others.
        const message = describe(error)
        result.warnings.push(`Round ${summary.externalRoundId} failed: ${message}`)
        logger.warn(`[sync] round ${summary.externalRoundId} failed: ${message}`)
      }
    }

    // The latest round is the highest-numbered one we now hold for the season.
    const bundle = await repo.getSeasonBundle(seasonId)
    const latest = bundle?.rounds.at(-1)
    result.latestRoundId = latest?.id ?? activeRound.id
    result.ok = true

    logger.info(
      `[sync] ${seasonId}: ${result.roundsCreated} created, ${result.roundsUpdated} updated, ` +
        `${result.roundsSkipped} unchanged`,
    )
  } catch (error) {
    // Reached when Sky is unreachable, or returns something unusable.
    result.ok = false
    result.error =
      error instanceof Super6UnavailableError
        ? `Super 6 is unavailable: ${error.message}`
        : describe(error)
    logger.error(`[sync] failed: ${result.error}`)
  }

  const state: SyncState = {
    lastRunAt: startedAt,
    lastSuccessAt: result.ok ? startedAt : (previous?.lastSuccessAt ?? null),
    lastError: result.ok ? null : result.error,
    // Keep the previously known round on failure rather than blanking it.
    latestRoundId: result.latestRoundId ?? previous?.latestRoundId ?? null,
    roundsCreated: result.roundsCreated,
    roundsUpdated: result.roundsUpdated,
  }
  await repo.putSyncState(state)

  return result
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
