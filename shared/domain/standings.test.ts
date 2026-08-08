import { describe, expect, it } from 'vitest'
import { formatPenceWithSeparators, parsePoundsToPence } from './money'
import {
  aggregateReturns,
  calculateSeasonSummary,
  calculateStandings,
  returnsForRound,
} from './standings'
import type { Participation, Return, Round } from './types'

const ROSTER = ['dan', 'mat', 'paul-s', 'paul-v', 'frank', 'jase', 'ash']

function rounds(count: number, seasonId = '2026-27'): Pick<Round, 'id'>[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${seasonId}:${i + 1}` }))
}

let sequence = 0
function ret(
  playerId: string,
  roundNumber: number,
  amount: string,
  seasonId = '2026-27',
): Return {
  sequence += 1
  return {
    id: `r${sequence}`,
    seasonId,
    roundId: `${seasonId}:${roundNumber}`,
    playerId,
    amountPence: parsePoundsToPence(amount),
    createdAt: '2026-08-23T12:00:00.000Z',
    updatedAt: '2026-08-23T12:00:00.000Z',
  }
}

function base(overrides: Partial<Parameters<typeof calculateStandings>[0]> = {}) {
  return {
    seasonId: '2026-27',
    seasonName: '2026/27',
    playerIds: ROSTER,
    rounds: rounds(1),
    returns: [] as Return[],
    ...overrides,
  }
}

describe('calculateStandings', () => {
  it('ranks on total returns, highest first', () => {
    const standings = calculateStandings(
      base({
        rounds: rounds(2),
        returns: [
          ret('dan', 1, '10.00'),
          ret('mat', 1, '50.00'),
          ret('ash', 2, '25.00'),
        ],
      }),
    )

    expect(standings.slice(0, 3).map((r) => [r.playerId, r.position])).toEqual([
      ['mat', 1],
      ['ash', 2],
      ['dan', 3],
    ])
  })

  it('charges £5 per round to every player, including those with no returns', () => {
    const standings = calculateStandings(base({ rounds: rounds(10) }))

    for (const row of standings) {
      expect(row.roundsPlayed).toBe(10)
      expect(row.totalStakePence).toBe(5000)
      expect(row.totalReturnPence).toBe(0)
      expect(row.profitPence).toBe(-5000)
      expect(row.roi).toBe(-1)
      expect(row.winningRounds).toBe(0)
    }
    expect(standings).toHaveLength(ROSTER.length)
  })

  it('computes profit as return minus stake, not return alone', () => {
    // The brief's example: stake £5, bookmaker pays £18.40, profit is £13.40.
    const [top] = calculateStandings(
      base({ rounds: rounds(1), returns: [ret('mat', 1, '18.40')] }),
    )

    expect(top.playerId).toBe('mat')
    expect(top.totalReturnPence).toBe(1840)
    expect(top.totalStakePence).toBe(500)
    expect(top.profitPence).toBe(1340)
  })

  it('handles a round where nobody won at all', () => {
    const standings = calculateStandings(base({ rounds: rounds(3), returns: [] }))

    expect(standings.every((r) => r.totalReturnPence === 0)).toBe(true)
    expect(standings.every((r) => r.winningRounds === 0)).toBe(true)
    // Everyone is level, so everyone shares first place.
    expect(standings.every((r) => r.position === 1)).toBe(true)
  })

  it('handles several winners in the same round', () => {
    const standings = calculateStandings(
      base({
        rounds: rounds(1),
        // A real round from 2025-26: three players returned in one round.
        returns: [ret('dan', 1, '10.73'), ret('mat', 1, '15.37'), ret('paul-s', 1, '14.73')],
      }),
    )

    const byId = new Map(standings.map((r) => [r.playerId, r]))
    expect(byId.get('mat')?.totalReturnPence).toBe(1537)
    expect(byId.get('paul-s')?.totalReturnPence).toBe(1473)
    expect(byId.get('dan')?.totalReturnPence).toBe(1073)
    expect(standings.filter((r) => r.winningRounds === 1)).toHaveLength(3)
  })

  it('aggregates multiple return records for one player and round', () => {
    // Two payouts recorded separately must total, and count as ONE winning round.
    const standings = calculateStandings(
      base({ rounds: rounds(1), returns: [ret('jase', 1, '8.50'), ret('jase', 1, '4.10')] }),
    )

    const jase = standings.find((r) => r.playerId === 'jase')
    expect(jase?.totalReturnPence).toBe(1260)
    expect(jase?.winningRounds).toBe(1)
  })

  it('treats a zero-amount return as not a win', () => {
    const standings = calculateStandings(
      base({ rounds: rounds(1), returns: [ret('ash', 1, '0.00')] }),
    )

    expect(standings.find((r) => r.playerId === 'ash')?.winningRounds).toBe(0)
  })

  it('ignores returns pointing at rounds outside the season', () => {
    const standings = calculateStandings(
      base({ rounds: rounds(1), returns: [ret('dan', 1, '10.00'), ret('dan', 99, '999.00')] }),
    )

    expect(standings.find((r) => r.playerId === 'dan')?.totalReturnPence).toBe(1000)
  })

  it('shares a position between players on equal returns', () => {
    const standings = calculateStandings(
      base({
        rounds: rounds(1),
        returns: [ret('dan', 1, '10.00'), ret('mat', 1, '10.00'), ret('ash', 1, '5.00')],
      }),
    )

    const byId = new Map(standings.map((r) => [r.playerId, r.position]))
    expect(byId.get('dan')).toBe(1)
    expect(byId.get('mat')).toBe(1)
    expect(byId.get('ash')).toBe(3)
  })

  it('reduces the stake for a player who sat a round out', () => {
    const participation: Participation[] = [
      {
        seasonId: '2026-27',
        roundId: '2026-27:2',
        playerId: 'frank',
        participated: false,
        reason: 'on holiday',
        updatedAt: '2026-08-30T09:00:00.000Z',
      },
    ]

    const standings = calculateStandings(
      base({ rounds: rounds(3), participation }),
    )

    const frank = standings.find((r) => r.playerId === 'frank')
    expect(frank?.roundsPlayed).toBe(2)
    expect(frank?.totalStakePence).toBe(1000)

    const dan = standings.find((r) => r.playerId === 'dan')
    expect(dan?.roundsPlayed).toBe(3)
    expect(dan?.totalStakePence).toBe(1500)
  })

  it('reproduces the published 2024-25 final table exactly', () => {
    // Totals taken from the live kent-24-25.csv (51 rounds), which is one round
    // ahead of the archived static page. Ranking order must match the old site.
    const published: [string, string][] = [
      ['paul-v', '267.91'],
      ['dan', '220.93'],
      ['mat', '164.32'],
      ['paul-s', '151.11'],
      ['ash', '125.65'],
      ['jase', '113.48'],
      ['frank', '110.98'],
    ]

    const returns = published.map(([playerId, amount], i) =>
      ret(playerId, i + 1, amount, '2024-25'),
    )

    const standings = calculateStandings({
      seasonId: '2024-25',
      seasonName: '2024/25',
      playerIds: ROSTER,
      rounds: rounds(51, '2024-25'),
      returns,
    })

    expect(standings.map((r) => r.playerId)).toEqual(published.map(([id]) => id))
    expect(formatPenceWithSeparators(standings[0].totalReturnPence)).toBe('£267.91')
    // 51 rounds x £5 = £255 staked by everyone.
    expect(standings.every((r) => r.totalStakePence === 25500)).toBe(true)
    // Paul V was the only player in profit that season.
    expect(standings.filter((r) => r.profitPence > 0).map((r) => r.playerId)).toEqual([
      'paul-v',
    ])
  })

  it('supports a historical season with a different roster', () => {
    // 2020-21 had five players including Taz, and no Frank, Jase or Ash.
    const standings = calculateStandings({
      seasonId: '2020-21',
      seasonName: '2020/21',
      playerIds: ['dan', 'mat', 'paul-s', 'paul-v', 'taz'],
      rounds: rounds(54, '2020-21'),
      returns: [ret('taz', 1, '104.23', '2020-21'), ret('paul-s', 2, '426.54', '2020-21')],
    })

    expect(standings).toHaveLength(5)
    expect(standings[0].playerId).toBe('paul-s')
    expect(standings.find((r) => r.playerId === 'taz')?.playerName).toBe('Taz')
    expect(standings.some((r) => r.playerId === 'frank')).toBe(false)
  })
})

describe('calculateSeasonSummary', () => {
  it('totals the season and counts winning entries like the old site', () => {
    const summary = calculateSeasonSummary(
      base({
        rounds: rounds(2),
        returns: [
          ret('dan', 1, '10.00'),
          ret('mat', 1, '20.00'),
          ret('ash', 2, '5.00'),
          ret('jase', 2, '0.00'),
        ],
      }),
    )

    expect(summary.roundCount).toBe(2)
    expect(summary.totalReturnPence).toBe(3500)
    // 7 players x 2 rounds x £5.
    expect(summary.totalStakePence).toBe(7000)
    expect(summary.profitPence).toBe(-3500)
    // The £0.00 entry is not a win.
    expect(summary.winningEntries).toBe(3)
  })

  it('reports zeroes for a season with no rounds yet', () => {
    const summary = calculateSeasonSummary(base({ rounds: [] }))

    expect(summary.roundCount).toBe(0)
    expect(summary.totalReturnPence).toBe(0)
    expect(summary.totalStakePence).toBe(0)
    expect(summary.winningEntries).toBe(0)
  })
})

describe('returnsForRound', () => {
  it('lists only paying players, highest first', () => {
    const list = returnsForRound(
      [
        ret('dan', 1, '10.73'),
        ret('mat', 1, '15.37'),
        ret('ash', 1, '0.00'),
        ret('jase', 2, '99.00'),
      ],
      '2026-27:1',
    )

    expect(list.map((r) => r.playerId)).toEqual(['mat', 'dan'])
    expect(list[0].amountPence).toBe(1537)
    expect(list[0].playerName).toBe('Mat')
  })

  it('is empty when nobody won, so the UI can say so plainly', () => {
    expect(returnsForRound([], '2026-27:1')).toEqual([])
  })
})

describe('aggregateReturns', () => {
  it('groups by player then round', () => {
    const map = aggregateReturns([ret('dan', 1, '5.00'), ret('dan', 1, '2.50')])
    expect(map.get('dan')?.get('2026-27:1')).toBe(750)
  })
})
