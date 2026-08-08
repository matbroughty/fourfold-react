/**
 * Render smoke tests.
 *
 * These are not visual tests; they exist so that a broken component throws in CI
 * rather than in the browser, and so the awkward cases (no returns, no fixtures,
 * imported history, live scores) are known to render at all.
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Fixture, StandingRow } from '../../shared/domain/types'
import type { RoundView } from '../api'
import RoundCard from './RoundCard'
import StandingsTable from './StandingsTable'

function standing(overrides: Partial<StandingRow> = {}): StandingRow {
  return {
    position: 1,
    playerId: 'mat',
    playerName: 'Mat',
    totalReturnPence: 1840,
    totalStakePence: 500,
    profitPence: 1340,
    roi: 2.68,
    winningRounds: 1,
    roundsPlayed: 1,
    ...overrides,
  }
}

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    externalMatchId: 89447,
    externalChallengeId: 1,
    position: 1,
    homeTeam: 'Everton',
    awayTeam: 'Crystal Palace',
    homeTeamId: 156,
    awayTeamId: 178,
    homeShortName: 'EVT',
    awayShortName: 'PAL',
    kickOffAt: '2026-08-22T14:00:00.000Z',
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    rawStatus: 'Pre Live',
    competition: 'Premier League',
    void: false,
    ...overrides,
  }
}

function round(overrides: Partial<RoundView> = {}): RoundView {
  return {
    id: '2026-27:1',
    seasonId: '2026-27',
    externalRoundId: 1,
    name: 'Round 1',
    roundNumber: 1,
    status: 'open',
    startsAt: '2026-07-17T11:17:00.000Z',
    endsAt: '2026-08-22T14:00:00.000Z',
    fixtures: [fixture()],
    importedAt: '2026-08-08T12:00:00.000Z',
    lastSyncedAt: '2026-08-08T12:00:00.000Z',
    source: 'super6',
    returns: [],
    returnRecords: [],
    ...overrides,
  }
}

describe('StandingsTable', () => {
  it('renders a table with money and ROI formatted', () => {
    const html = renderToString(<StandingsTable standings={[standing()]} />)

    expect(html).toContain('Mat')
    expect(html).toContain('£18.40')
    expect(html).toContain('+268.0%')
  })

  it('shows a loss in the loss colour', () => {
    const html = renderToString(
      <StandingsTable standings={[standing({ profitPence: -2500, roi: -0.5 })]} />,
    )
    expect(html).toContain('money-down')
    expect(html).toContain('-£25.00')
  })

  it('renders a dash for undefined ROI rather than 0%', () => {
    const html = renderToString(
      <StandingsTable standings={[standing({ roi: null, totalStakePence: 0 })]} />,
    )
    expect(html).toContain('—')
  })

  it('handles an empty season', () => {
    expect(renderToString(<StandingsTable standings={[]} />)).toContain('No players')
  })
})

describe('RoundCard', () => {
  it('renders six fixtures with kick-off times and no scores before kick-off', () => {
    const fixtures = Array.from({ length: 6 }, (_, i) =>
      fixture({ position: i + 1, homeTeam: `Home ${i}`, awayTeam: `Away ${i}` }),
    )
    const html = renderToString(<RoundCard round={round({ fixtures })} />)

    expect(html).toContain('Round 1')
    expect(html).toContain('Home 0')
    expect(html).toContain('Away 5')
    // "v" rather than a misleading 0–0.
    expect(html).toContain('>v<')
    expect(html).not.toContain('0–0')
  })

  it('shows a final score and highlights the winner', () => {
    const html = renderToString(
      <RoundCard
        round={round({
          fixtures: [fixture({ homeScore: 2, awayScore: 1, status: 'finished', rawStatus: 'Full Time' })],
        })}
      />,
    )

    expect(html).toContain('2–1')
    expect(html).toContain('fixture-winner')
  })

  it('labels a draw', () => {
    const html = renderToString(
      <RoundCard
        round={round({ fixtures: [fixture({ homeScore: 1, awayScore: 1, status: 'finished' })] })}
      />,
    )
    expect(html).toContain('Draw')
  })

  it('says plainly when nobody won, without clutter', () => {
    const html = renderToString(<RoundCard round={round({ returns: [] })} />)

    expect(html).toContain('No returns this round.')
    expect(html).not.toContain('winner')
  })

  it('lists the winners when there were some', () => {
    const html = renderToString(
      <RoundCard
        round={round({
          returns: [
            { playerId: 'mat', playerName: 'Mat', amountPence: 1537 },
            { playerId: 'dan', playerName: 'Dan', amountPence: 1073 },
          ],
        })}
      />,
    )

    expect(html).toContain('2 winners')
    expect(html).toContain('£15.37')
    expect(html).toContain('Dan')
  })

  it('explains an imported round with no fixture record', () => {
    const html = renderToString(
      <RoundCard round={round({ fixtures: [], source: 'csv-import', externalRoundId: null })} />,
    )

    expect(html).toContain('No fixture record')
    expect(html).toContain('winnings only')
  })

  it('distinguishes unpublished fixtures from missing history', () => {
    const html = renderToString(<RoundCard round={round({ fixtures: [], status: 'future' })} />)
    expect(html).toContain('have not been published yet')
  })

  it('marks postponed, abandoned and void fixtures', () => {
    const html = renderToString(
      <RoundCard
        round={round({
          fixtures: [
            fixture({ position: 1, status: 'postponed' }),
            fixture({ position: 2, status: 'abandoned' }),
            fixture({ position: 3, void: true }),
          ],
        })}
      />,
    )

    expect(html).toContain('Postponed')
    expect(html).toContain('Abandoned')
    expect(html).toContain('Void')
  })

  it('marks the current round with a badge and highlights the card', () => {
    const html = renderToString(<RoundCard round={round()} badge="Current round" />)

    expect(html).toContain('Current round')
    expect(html).toContain('card-current')
  })

  it('renders no badge when none is given', () => {
    const html = renderToString(<RoundCard round={round()} />)

    expect(html).not.toContain('badge-current')
    expect(html).not.toContain('card-current')
  })

  it('shows a live indicator for a match in progress', () => {
    const html = renderToString(
      <RoundCard
        round={round({
          fixtures: [fixture({ status: 'live', homeScore: 1, awayScore: 0, rawStatus: 'Second Half Started' })],
        })}
      />,
    )
    expect(html).toContain('live-dot')
    expect(html).toContain('1–0')
  })
})
