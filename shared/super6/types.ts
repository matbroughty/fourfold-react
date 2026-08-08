/**
 * The shape of the Sky Super 6 v2 API responses, as observed.
 *
 * Everything here is optional and nullable on purpose. This is somebody else's
 * undocumented API: fields may be added, optional fields may vanish, and the
 * only contract we actually rely on is asserted in normalize.ts. Treat these
 * types as "what we hope to find", not as a guarantee.
 *
 * See docs/super6-api.md for how these were discovered.
 */

export interface RawTeam {
  id?: number | null
  name?: string | null
  shortname?: string | null
  score?: number | null
  badgeUri?: string | null
}

export interface RawMatch {
  id?: number | null
  eventId?: number | null
  kickOffDateTime?: string | null
  status?: string | null
  shortStatus?: string | null
  isLocked?: boolean | null
  competitionId?: number | null
  competitionName?: string | null
  homeTeam?: RawTeam | null
  awayTeam?: RawTeam | null
}

/** One of the six fixtures in a round. Sky calls these "score challenges". */
export interface RawScoreChallenge {
  /**
   * A season-wide incrementing id, not a position within the round: round 1 uses
   * 1-6, round 2 uses 8-13, round 3 uses 15-20. Useful for ordering, useless as
   * a fixture number.
   */
  id?: number | null
  void?: boolean | null
  match?: RawMatch | null
}

/** A round as returned by `/round/{id}` or `/round/active`. */
export interface RawRoundDetail {
  id?: number | null
  status?: string | null
  season?: string | null
  isPaused?: boolean | null
  isSingleWinner?: boolean | null
  startDateTime?: string | null
  endDateTime?: string | null
  scoreChallenges?: RawScoreChallenge[] | null
  /** Present on `/round`, absent on `/round/{id}`. */
  matchDates?: string[] | null
}

/** A summary entry from `GET /round`. Note: no `season` and no fixtures. */
export type RawRoundSummary = Omit<RawRoundDetail, 'scoreChallenges'>
