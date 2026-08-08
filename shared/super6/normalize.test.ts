import { describe, expect, it } from 'vitest'
import roundDetail from './__fixtures__/round-detail.json'
import roundList from './__fixtures__/round-list.json'
import {
  Super6NormalizeError,
  fixtureOutcome,
  isRoundFinal,
  normalizeFixture,
  normalizeFixtureStatus,
  normalizeRound,
  normalizeRoundStatus,
  roundKey,
} from './normalize'
import type { RawRoundDetail, RawScoreChallenge } from './types'

const NOW = () => '2026-08-08T12:00:00.000Z'

/** The real `GET /round/1` response, captured 2026-08-08 (assets stripped). */
const REAL_ROUND = roundDetail as RawRoundDetail

describe('normalizeRound against the real captured response', () => {
  const round = normalizeRound(REAL_ROUND, { now: NOW })

  it('builds a season-scoped composite id', () => {
    // Sky's round id is just 1 — worthless as a key on its own.
    expect(REAL_ROUND.id).toBe(1)
    expect(round.id).toBe('2026-27:1')
    expect(round.seasonId).toBe('2026-27')
    expect(round.externalRoundId).toBe(1)
    expect(round.roundNumber).toBe(1)
    expect(round.name).toBe('Round 1')
  })

  it('extracts exactly the six fixtures', () => {
    expect(round.fixtures).toHaveLength(6)
    expect(round.fixtures.map((f) => `${f.homeTeam} v ${f.awayTeam}`)).toEqual([
      'Everton v Crystal Palace',
      'Nottm Forest v Leeds',
      'Brentford v Spurs',
      'Man City v Bournemouth',
      'Brighton v Aston Villa',
      'Newcastle v Liverpool',
    ])
  })

  it('keeps Sky match ids, which are stable across seasons', () => {
    expect(round.fixtures.map((f) => f.externalMatchId)).toEqual([
      89447, 89451, 89448, 89482, 89483, 89481,
    ])
  })

  it('numbers the fixtures 1-6 rather than using Sky challenge ids', () => {
    // Sky's scoreChallenges[].id is season-wide, not per-round: round 2 uses
    // 8-13 and round 3 uses 15-20. Round 1 happens to start at 1.
    expect(round.fixtures.map((f) => f.position)).toEqual([1, 2, 3, 4, 5, 6])
    expect(round.fixtures.map((f) => f.externalChallengeId)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('records kick-off times as ISO UTC', () => {
    expect(round.fixtures[0].kickOffAt).toBe('2026-08-22T14:00:00.000Z')
    expect(round.fixtures[5].kickOffAt).toBe('2026-08-23T15:30:00.000Z')
  })

  it('maps round and fixture status into our vocabulary', () => {
    expect(round.status).toBe('open')
    expect(round.fixtures.every((f) => f.status === 'scheduled')).toBe(true)
    expect(round.fixtures[0].rawStatus).toBe('Pre Live')
  })

  it('reports no score for fixtures that have not kicked off', () => {
    // Sky sends score: 0 for both teams pre-match. Surfacing that would make
    // every unplayed fixture look like a 0-0 draw.
    const raw = REAL_ROUND.scoreChallenges?.[0]?.match
    expect(raw?.homeTeam?.score).toBe(0)
    expect(round.fixtures[0].homeScore).toBeNull()
    expect(round.fixtures[0].awayScore).toBeNull()
    expect(fixtureOutcome(round.fixtures[0])).toBeNull()
  })

  it('carries the round window and competition through', () => {
    expect(round.startsAt).toBe('2026-07-17T11:17:00.000Z')
    expect(round.endsAt).toBe('2026-08-22T14:00:00.000Z')
    expect(round.fixtures[0].competition).toBe('Premier League')
  })

  it('marks the round as coming from Super 6 and stamps sync times', () => {
    expect(round.source).toBe('super6')
    expect(round.importedAt).toBe('2026-08-08T12:00:00.000Z')
    expect(round.lastSyncedAt).toBe('2026-08-08T12:00:00.000Z')
  })
})

describe('roundKey', () => {
  it('keeps rounds from different seasons apart', () => {
    // Super 6 restarts round ids at 1 every season, so this is the whole point.
    expect(roundKey('2026-27', 1)).toBe('2026-27:1')
    expect(roundKey('2025-26', 1)).toBe('2025-26:1')
    expect(roundKey('2026-27', 1)).not.toBe(roundKey('2025-26', 1))
  })
})

describe('status mapping', () => {
  it('maps every round status documented in the OpenAPI spec', () => {
    expect(normalizeRoundStatus('open')).toBe('open')
    expect(normalizeRoundStatus('inplay')).toBe('inplay')
    expect(normalizeRoundStatus('complete')).toBe('complete')
    expect(normalizeRoundStatus('future')).toBe('future')
  })

  it('maps every match status documented in the OpenAPI spec', () => {
    const expected: Record<string, string> = {
      'Pre Live': 'scheduled',
      'Kick Off': 'live',
      'Half Time': 'live',
      'Half Time Started': 'live',
      'Second Half Started': 'live',
      'Full Time': 'finished',
      'Match Complete': 'finished',
      Result: 'finished',
      Abandoned: 'abandoned',
      Postponed: 'postponed',
    }
    for (const [raw, normalized] of Object.entries(expected)) {
      expect(normalizeFixtureStatus(raw), raw).toBe(normalized)
    }
  })

  it('falls back to unknown for statuses Sky has not told us about', () => {
    // Resilience: a new status must not crash a sync.
    expect(normalizeRoundStatus('settling')).toBe('unknown')
    expect(normalizeRoundStatus(undefined)).toBe('unknown')
    expect(normalizeRoundStatus(42)).toBe('unknown')
    expect(normalizeFixtureStatus('Extra Time')).toBe('unknown')
    expect(normalizeFixtureStatus(null)).toBe('unknown')
  })
})

describe('normalizeFixture resilience', () => {
  const challenge = (match: Record<string, unknown>, extra = {}): RawScoreChallenge =>
    ({ id: 1, void: false, match, ...extra }) as RawScoreChallenge

  it('exposes scores once a match is live', () => {
    const fixture = normalizeFixture(
      challenge({
        id: 1,
        status: 'Second Half Started',
        homeTeam: { name: 'Everton', score: 2 },
        awayTeam: { name: 'Crystal Palace', score: 1 },
      }),
      1,
    )

    expect(fixture.status).toBe('live')
    expect(fixture.homeScore).toBe(2)
    expect(fixture.awayScore).toBe(1)
    // Still live, so no settled outcome.
    expect(fixtureOutcome(fixture)).toBeNull()
  })

  it('derives home, draw and away outcomes for finished matches', () => {
    const finished = (home: number, away: number) =>
      normalizeFixture(
        challenge({
          status: 'Full Time',
          homeTeam: { name: 'A', score: home },
          awayTeam: { name: 'B', score: away },
        }),
        1,
      )

    expect(fixtureOutcome(finished(2, 1))).toBe('home')
    expect(fixtureOutcome(finished(1, 1))).toBe('draw')
    expect(fixtureOutcome(finished(0, 3))).toBe('away')
  })

  it('tolerates missing optional fields', () => {
    const fixture = normalizeFixture(
      challenge({ homeTeam: { name: 'Everton' }, awayTeam: { name: 'Palace' } }),
      3,
    )

    expect(fixture.externalMatchId).toBeNull()
    expect(fixture.kickOffAt).toBeNull()
    expect(fixture.competition).toBeNull()
    expect(fixture.homeShortName).toBeNull()
    expect(fixture.status).toBe('unknown')
    expect(fixture.homeTeam).toBe('Everton')
  })

  it('ignores fields Sky adds that we do not know about', () => {
    const fixture = normalizeFixture(
      challenge(
        {
          id: 7,
          status: 'Pre Live',
          homeTeam: { name: 'A' },
          awayTeam: { name: 'B' },
          someNewSkyField: { nested: true },
        },
        { anotherNewField: 'ignored' },
      ),
      1,
    )

    expect(fixture.externalMatchId).toBe(7)
    expect(Object.keys(fixture)).not.toContain('someNewSkyField')
  })

  it('falls back to the ordinal position when Sky omits one', () => {
    const fixture = normalizeFixture(
      { match: { homeTeam: { name: 'A' }, awayTeam: { name: 'B' } } },
      4,
    )
    expect(fixture.position).toBe(4)
  })

  it('flags void fixtures rather than dropping them', () => {
    const fixture = normalizeFixture(
      challenge({ homeTeam: { name: 'A' }, awayTeam: { name: 'B' } }, { void: true }),
      1,
    )
    expect(fixture.void).toBe(true)
  })

  it('refuses a fixture with no team names', () => {
    expect(() => normalizeFixture(challenge({ homeTeam: {}, awayTeam: {} }), 1)).toThrow(
      Super6NormalizeError,
    )
    expect(() => normalizeFixture({}, 1)).toThrow(Super6NormalizeError)
  })
})

describe('normalizeRound validation', () => {
  it('orders fixtures by Sky challenge id but numbers them from 1', () => {
    const round = normalizeRound(
      {
        id: 5,
        season: '2026-27',
        status: 'open',
        scoreChallenges: [
          { id: 3, match: { homeTeam: { name: 'C' }, awayTeam: { name: 'D' } } },
          { id: 1, match: { homeTeam: { name: 'A' }, awayTeam: { name: 'B' } } },
        ],
      },
      { now: NOW },
    )

    expect(round.fixtures.map((f) => f.position)).toEqual([1, 2])
    expect(round.fixtures.map((f) => f.externalChallengeId)).toEqual([1, 3])
    expect(round.fixtures[0].homeTeam).toBe('A')
  })

  it('renumbers a later round whose challenge ids do not start at 1', () => {
    // Real shape of round 2 from the live API: ids 8-13, with 7 taken by the
    // golden goal challenge.
    const round = normalizeRound(
      {
        id: 2,
        season: '2026-27',
        status: 'future',
        scoreChallenges: [8, 9, 10, 11, 12, 13].map((id) => ({
          id,
          match: { homeTeam: { name: `H${id}` }, awayTeam: { name: `A${id}` } },
        })),
      },
      { now: NOW },
    )

    expect(round.fixtures.map((f) => f.position)).toEqual([1, 2, 3, 4, 5, 6])
    expect(round.fixtures[0].externalChallengeId).toBe(8)
    expect(round.fixtures[0].homeTeam).toBe('H8')
  })

  it('uses a fallback season, because GET /round omits it', () => {
    const summary = (roundList as RawRoundDetail[])[0]
    expect(summary.season).toBeUndefined()

    const round = normalizeRound(summary, {
      fallbackSeasonId: '2026-27',
      now: NOW,
    })
    expect(round.id).toBe('2026-27:1')
    // A summary carries no fixtures.
    expect(round.fixtures).toEqual([])
  })

  it('refuses to guess when there is no season at all', () => {
    expect(() => normalizeRound({ id: 1, status: 'open' }, { now: NOW })).toThrow(
      Super6NormalizeError,
    )
  })

  it('refuses a round with no usable id', () => {
    for (const bad of [{}, { id: null }, { id: 0 }, { id: -1 }, { id: 'one' }]) {
      expect(() =>
        normalizeRound(bad as RawRoundDetail, { fallbackSeasonId: '2026-27', now: NOW }),
      ).toThrow(Super6NormalizeError)
    }
  })

  it('refuses a payload that is not an object', () => {
    for (const bad of [null, undefined, 'nope', 42]) {
      expect(() => normalizeRound(bad as unknown as RawRoundDetail)).toThrow(
        Super6NormalizeError,
      )
    }
  })

  it('tolerates scoreChallenges being absent or the wrong type', () => {
    for (const value of [undefined, null, 'six']) {
      const round = normalizeRound(
        { id: 2, season: '2026-27', scoreChallenges: value as never },
        { now: NOW },
      )
      expect(round.fixtures).toEqual([])
    }
  })

  it('preserves the original importedAt when re-normalizing', () => {
    const round = normalizeRound(REAL_ROUND, {
      now: () => '2026-09-01T00:00:00.000Z',
      importedAt: '2026-08-01T00:00:00.000Z',
    })

    expect(round.importedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(round.lastSyncedAt).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('isRoundFinal', () => {
  const build = (status: string, fixtureStatuses: string[]) =>
    normalizeRound(
      {
        id: 1,
        season: '2026-27',
        status,
        scoreChallenges: fixtureStatuses.map((s, i) => ({
          id: i + 1,
          match: {
            status: s,
            homeTeam: { name: `H${i}`, score: 1 },
            awayTeam: { name: `A${i}`, score: 0 },
          },
        })),
      },
      { now: NOW },
    )

  it('is final when Sky says complete and every fixture is settled', () => {
    expect(isRoundFinal(build('complete', Array(6).fill('Full Time')))).toBe(true)
  })

  it('treats postponed and abandoned fixtures as settled', () => {
    expect(
      isRoundFinal(
        build('complete', ['Full Time', 'Full Time', 'Postponed', 'Abandoned', 'Result', 'Full Time']),
      ),
    ).toBe(true)
  })

  it('is not final while a fixture is still running', () => {
    expect(
      isRoundFinal(build('complete', ['Full Time', 'Second Half Started'])),
    ).toBe(false)
  })

  it('is not final while Sky still calls the round inplay or open', () => {
    expect(isRoundFinal(build('inplay', Array(6).fill('Full Time')))).toBe(false)
    expect(isRoundFinal(build('open', Array(6).fill('Pre Live')))).toBe(false)
  })

  it('is not final when we hold no fixtures, so we keep trying to fill them in', () => {
    expect(isRoundFinal(build('complete', []))).toBe(false)
  })
})
