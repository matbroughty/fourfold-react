/**
 * Working out which round the competition is actually "on".
 *
 * Super 6 announces the next few rounds well ahead of time, so the
 * highest-numbered round we hold is usually one nobody can bet on yet. Showing
 * that as the headline round is wrong — at the start of 2026/27 it meant the home
 * page led with Round 3, three weeks away, while Round 1 was the one taking
 * entries.
 */
import type { Round } from './types'

/**
 * Why a round was chosen, so the UI can label it honestly rather than always
 * saying "latest".
 */
export type CurrentRoundKind =
  /** Fixtures are being played right now. */
  | 'inplay'
  /** Taking entries — this is the one to get a bet on. */
  | 'open'
  /** Nothing live or open; showing the most recently finished round. */
  | 'latest-result'
  /** Nothing has started yet; showing the next one up. */
  | 'next'

export interface CurrentRound<T> {
  round: T
  kind: CurrentRoundKind
}

type RoundLike = Pick<Round, 'status' | 'roundNumber'>

/**
 * Pick the round to lead with, in priority order:
 *
 *  1. in play — a match is on, so that is the news
 *  2. open — entries are being taken, so that is what people need
 *  3. the most recently finished round — the latest result
 *  4. the earliest future round — nothing has happened yet, so show what is next
 *
 * Returns undefined only when there are no rounds at all.
 */
export function pickCurrentRound<T extends RoundLike>(
  rounds: readonly T[],
): CurrentRound<T> | undefined {
  if (rounds.length === 0) return undefined

  const byNumberDesc = [...rounds].sort((a, b) => b.roundNumber - a.roundNumber)
  const byNumberAsc = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)

  const inplay = byNumberDesc.find((r) => r.status === 'inplay')
  if (inplay) return { round: inplay, kind: 'inplay' }

  // The earliest open round: if two were somehow open, the older one closes first.
  const open = byNumberAsc.find((r) => r.status === 'open')
  if (open) return { round: open, kind: 'open' }

  // `unknown` counts as started, consistent with stake calculation: better to
  // treat an unrecognised status as a played round than to ignore it.
  const finished = byNumberDesc.find(
    (r) => r.status === 'complete' || r.status === 'unknown',
  )
  if (finished) return { round: finished, kind: 'latest-result' }

  return { round: byNumberAsc[0], kind: 'next' }
}

/** Heading for the round shown on the home page. */
export function currentRoundHeading(kind: CurrentRoundKind): string {
  switch (kind) {
    case 'inplay':
      return 'This round — in play'
    case 'open':
      return 'This round'
    case 'latest-result':
      return 'Latest round'
    case 'next':
      return 'Next round'
  }
}

/** Short badge text, or null when a badge would add nothing. */
export function currentRoundBadge(kind: CurrentRoundKind): string | null {
  switch (kind) {
    case 'inplay':
      return 'In play'
    case 'open':
      return 'Current round'
    case 'next':
      return 'Next up'
    case 'latest-result':
      return null
  }
}
