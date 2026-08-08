/**
 * FourFold's internal domain model.
 *
 * This is deliberately OUR shape, not Sky's. The Super 6 API response is
 * normalised into these types at the edge (see shared/super6/normalize.ts) so
 * that a change to Sky's payload affects one file, not the whole application.
 */

/** A season, e.g. `2026-27`. The id is also the sort key, so it must sort lexically. */
export interface Season {
  /** `"2026-27"` — matches the `season` field Super 6 returns. */
  id: string
  /** Display name, e.g. `"2026/27"`. */
  name: string
  /** Calendar year the season starts in, e.g. `2026`. */
  startYear: number
  status: 'active' | 'complete'
  /** Player ids taking part this season. Rosters change between seasons. */
  playerIds: string[]
  /**
   * True when the season predates Super 6 syncing and was imported from the
   * historical CSVs. Such seasons have returns but no fixtures.
   */
  imported: boolean
  createdAt: string
}

export interface Player {
  /** Stable slug, e.g. `"paul-s"`. Never changes; used in URLs and keys. */
  id: string
  /** Display name as used on the old site, e.g. `"Paul S"`. */
  name: string
}

/** Which way a result went. */
export type Outcome = 'home' | 'draw' | 'away'

/** Our normalised view of the status of a single fixture. */
export type FixtureStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'abandoned'
  | 'unknown'

/** One of the six matches Sky selected for a round. */
export interface Fixture {
  /**
   * Sky's match id (`scoreChallenges[].match.id`), e.g. 89447. Stable across
   * requests and, unlike the round id, appears to be globally unique — so it
   * is worth persisting.
   */
  externalMatchId: number | null
  /**
   * Sky's `scoreChallenges[].id`. Despite appearances this is NOT a 1-6 position
   * within the round — it increments across the whole season (round 2 uses 8-13,
   * round 3 uses 15-20, with gaps). Retained only for traceability.
   */
  externalChallengeId: number | null
  /** Our own 1-6 ordering within the round, derived from Sky's ordering. */
  position: number
  homeTeam: string
  awayTeam: string
  /** Sky's team ids, retained for future badge/lookup use. */
  homeTeamId: number | null
  awayTeamId: number | null
  homeShortName: string | null
  awayShortName: string | null
  /** ISO 8601 UTC kick-off time. */
  kickOffAt: string | null
  homeScore: number | null
  awayScore: number | null
  status: FixtureStatus
  /** Sky's raw status string, kept for diagnostics, e.g. `"Pre Live"`. */
  rawStatus: string | null
  competition: string | null
  /** Sky marks a fixture void if it is pulled from the round. */
  void: boolean
}

/** Round lifecycle, normalised from Sky's `open|inplay|complete|future`. */
export type RoundStatus = 'future' | 'open' | 'inplay' | 'complete' | 'unknown'

/**
 * A Super 6 round, as FourFold stores it.
 *
 * IMPORTANT: Super 6 round ids restart at 1 every season, so `externalRoundId`
 * alone is NOT unique. The identity of a round is (`seasonId`, `externalRoundId`).
 */
export interface Round {
  /** Our composite id: `"2026-27:1"`. */
  id: string
  seasonId: string
  /** Sky's round id — unique only within a season. */
  externalRoundId: number | null
  /** Display name, e.g. `"Round 1"`. */
  name: string
  /** Ordinal within the season, 1-based. Drives history ordering. */
  roundNumber: number
  status: RoundStatus
  /** ISO 8601. When the round opened for entries. */
  startsAt: string | null
  /** ISO 8601. When the last fixture is expected to finish. */
  endsAt: string | null
  fixtures: Fixture[]
  /** First time we saw this round. Never overwritten. */
  importedAt: string
  /** Last time a sync touched this round. */
  lastSyncedAt: string
  /**
   * Historical rounds imported from CSV have no fixture data at all. Flagged so
   * the UI can say "no fixture record" instead of implying Sky returned nothing.
   */
  source: 'super6' | 'csv-import'
}

/**
 * A monetary return paid by the bookmaker to one player for one round.
 *
 * There is one record per entry, not one per player/round, and several may
 * exist for the same player and round. Reads aggregate them. This makes
 * corrections trivial (add an offsetting entry or edit/delete one line) and
 * means an accidental double-entry is visible rather than silently overwriting.
 */
export interface Return {
  id: string
  seasonId: string
  /** Our composite round id. */
  roundId: string
  playerId: string
  /** Integer pence. Always >= 0. This is the RETURN, not the profit. */
  amountPence: number
  /** Optional free-text note, e.g. "corrected from £18.40". */
  note?: string
  createdAt: string
  updatedAt: string
}

/**
 * Whether a player took part in a round.
 *
 * Everyone is assumed to play every round, so no record is written in the
 * normal case. A record exists only to record an exception. This keeps today's
 * data clean while allowing a skipped round to be represented later without a
 * schema change.
 */
export interface Participation {
  seasonId: string
  roundId: string
  playerId: string
  participated: boolean
  reason?: string
  updatedAt: string
}

/** A player's computed position in the season table. */
export interface StandingRow {
  position: number
  playerId: string
  playerName: string
  /** Integer pence, summed across all returns. The ranking metric. */
  totalReturnPence: number
  /** Integer pence: rounds played x £5. */
  totalStakePence: number
  /** Integer pence, may be negative. */
  profitPence: number
  /** Ratio, or null when no stake. */
  roi: number | null
  /** Rounds in which this player received any return. */
  winningRounds: number
  /** Rounds this player is counted as having staked in. */
  roundsPlayed: number
}

/** Season-level totals shown above the table. */
export interface SeasonSummary {
  seasonId: string
  seasonName: string
  /** Every round we know about, including ones Super 6 has only announced. */
  roundCount: number
  /** Rounds that have actually been played, and so been staked on. */
  playedRoundCount: number
  totalReturnPence: number
  totalStakePence: number
  profitPence: number
  /** Total number of player-rounds that produced a return. */
  winningEntries: number
}

/** Outcome of a sync run, persisted so the admin page can show health. */
export interface SyncState {
  lastRunAt: string
  lastSuccessAt: string | null
  lastError: string | null
  /** Composite round id of the most recent round we know about. */
  latestRoundId: string | null
  roundsCreated: number
  roundsUpdated: number
}
