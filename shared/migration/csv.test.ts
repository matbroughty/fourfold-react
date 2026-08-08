import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatPenceWithSeparators } from '../domain/money'
import {
  HistoricalCsvError,
  parseHistoricalCsv,
  seasonIdFromFilename,
} from './csv'

const HISTORY_DIR = join(import.meta.dirname, '../../data/history')
const readSeason = (seasonId: string) =>
  parseHistoricalCsv(seasonId, readFileSync(join(HISTORY_DIR, `${seasonId}.csv`), 'utf8'))

describe('parseHistoricalCsv', () => {
  it('parses a simple season', () => {
    const parsed = parseHistoricalCsv(
      '2026-27',
      ['Dan,Mat,Ash', '0.00,0.00,16.84', '0.00,0.00,0.00', '10.50,0.00,0.00'].join('\n'),
    )

    expect(parsed.playerIds).toEqual(['dan', 'mat', 'ash'])
    expect(parsed.rounds).toHaveLength(3)
    expect(parsed.totalReturnPence).toBe(2734)
    expect(parsed.winningEntries).toBe(2)
  })

  it('records no return at all for a round nobody won', () => {
    const parsed = parseHistoricalCsv('2026-27', ['Dan,Mat', '0.00,0.00'].join('\n'))

    expect(parsed.rounds).toHaveLength(1)
    // The round exists (a stake was laid) but carries no return records.
    expect(parsed.rounds[0].returns).toEqual([])
  })

  it('keeps several winners in the same round', () => {
    const parsed = parseHistoricalCsv(
      '2026-27',
      ['Dan,Mat,Paul S', '10.73,15.37,14.73'].join('\n'),
    )

    expect(parsed.rounds[0].returns).toEqual([
      { playerId: 'dan', amountPence: 1073 },
      { playerId: 'mat', amountPence: 1537 },
      { playerId: 'paul-s', amountPence: 1473 },
    ])
  })

  it('numbers rounds by row position, the only identity these files carry', () => {
    const parsed = parseHistoricalCsv(
      '2026-27',
      ['Dan', '1.00', '2.00', '3.00'].join('\n'),
    )
    expect(parsed.rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3])
  })

  it('tolerates blank lines and trailing newlines', () => {
    const parsed = parseHistoricalCsv('2026-27', 'Dan,Mat\n1.00,0.00\n\n2.00,0.00\n\n')
    expect(parsed.rounds).toHaveLength(2)
  })

  it('handles the 2020-21 header spacing and roster', () => {
    const parsed = parseHistoricalCsv(
      '2020-21',
      ['Dan, Mat, Paul S, Paul V, Taz', '0.00,0.00,0.00,0.00,104.23'].join('\n'),
    )

    expect(parsed.playerIds).toEqual(['dan', 'mat', 'paul-s', 'paul-v', 'taz'])
    expect(parsed.rounds[0].returns).toEqual([{ playerId: 'taz', amountPence: 10423 }])
  })

  it('rejects an unknown player column rather than dropping the data', () => {
    expect(() => parseHistoricalCsv('2026-27', 'Dan,Nigel\n1.00,2.00')).toThrow(
      HistoricalCsvError,
    )
  })

  it('rejects a row whose width does not match the header', () => {
    expect(() => parseHistoricalCsv('2026-27', 'Dan,Mat\n1.00,2.00,3.00')).toThrow(
      /has 3 values but the header declares 2/,
    )
  })

  it('rejects an unparseable amount rather than treating it as zero', () => {
    expect(() => parseHistoricalCsv('2026-27', 'Dan,Mat\n1.00,twelve')).toThrow(
      /is not a valid return/,
    )
    expect(() => parseHistoricalCsv('2026-27', 'Dan,Mat\n1.00,-5.00')).toThrow(
      /is not a valid return/,
    )
  })

  it('rejects duplicate player columns', () => {
    expect(() => parseHistoricalCsv('2026-27', 'Dan,Dan\n1.00,2.00')).toThrow(
      /duplicate player columns/,
    )
  })

  it('rejects an empty file', () => {
    expect(() => parseHistoricalCsv('2026-27', '   \n\n')).toThrow(/file is empty/)
  })
})

describe('seasonIdFromFilename', () => {
  it('handles every naming convention used across the two old repos', () => {
    expect(seasonIdFromFilename('kent-24-25.csv')).toBe('2024-25')
    expect(seasonIdFromFilename('Kent_22_23.csv')).toBe('2022-23')
    expect(seasonIdFromFilename('kent-20-21.csv')).toBe('2020-21')
    expect(seasonIdFromFilename('2025-26.csv')).toBe('2025-26')
  })

  it('refuses to guess', () => {
    expect(() => seasonIdFromFilename('kent.csv')).toThrow(HistoricalCsvError)
  })
})

/**
 * These assertions are the safety net for the migration: they pin the imported
 * figures to the totals the old site published. If a future change to the money
 * or parsing code alters our history, these fail.
 */
describe('the real historical data', () => {
  it('imports 2024-25 and matches the published standings', () => {
    const parsed = readSeason('2024-25')

    expect(parsed.playerIds).toEqual([
      'dan', 'mat', 'paul-s', 'paul-v', 'frank', 'jase', 'ash',
    ])
    expect(parsed.rounds).toHaveLength(51)
    expect(formatPenceWithSeparators(parsed.totalReturnPence)).toBe('£1,154.38')
    expect(parsed.winningEntries).toBe(64)

    // Per-player totals, cross-checked against the archived standings page.
    // The page showed 50 rounds / £1,140.05 / Frank £96.65 / 63 wins; the live
    // CSV carries one extra round (Frank £14.33), hence Frank £110.98 and 64.
    expect(parsed.totalsByPlayer).toEqual({
      'paul-v': 26791,
      dan: 22093,
      mat: 16432,
      'paul-s': 15111,
      ash: 12565,
      jase: 11348,
      frank: 11098,
    })
  })

  it('imports 2025-26', () => {
    const parsed = readSeason('2025-26')

    expect(parsed.rounds).toHaveLength(38)
    expect(formatPenceWithSeparators(parsed.totalReturnPence)).toBe('£1,019.19')
    expect(parsed.winningEntries).toBe(49)
    // The biggest single return in the file.
    expect(parsed.totalsByPlayer.jase).toBe(22451)
  })

  it('imports 2023-24', () => {
    const parsed = readSeason('2023-24')

    expect(parsed.rounds).toHaveLength(55)
    expect(formatPenceWithSeparators(parsed.totalReturnPence)).toBe('£2,105.00')
    expect(parsed.winningEntries).toBe(82)
  })

  it('imports 2022-23, including the corrected round 6 typo', () => {
    const parsed = readSeason('2022-23')

    expect(parsed.rounds).toHaveLength(56)
    expect(formatPenceWithSeparators(parsed.totalReturnPence)).toBe('£1,335.44')
    expect(parsed.winningEntries).toBe(65)

    // Round 6 originally read "0.00,0,00,13.90,..." — a comma typed instead of
    // a decimal point, which split into 8 fields for a 7-player header. The
    // repaired row assigns the £13.90 to Paul S. See docs/data-provenance.md.
    expect(parsed.rounds[5].returns).toEqual([{ playerId: 'paul-s', amountPence: 1390 }])
    expect(parsed.totalsByPlayer).toEqual({
      jase: 33624,
      ash: 25414,
      'paul-v': 21789,
      mat: 17154,
      frank: 16745,
      dan: 13797,
      'paul-s': 5021,
    })
  })

  it('imports 2020-21, which has a different roster', () => {
    const parsed = readSeason('2020-21')

    expect(parsed.playerIds).toEqual(['dan', 'mat', 'paul-s', 'paul-v', 'taz'])
    expect(parsed.rounds).toHaveLength(54)
    expect(formatPenceWithSeparators(parsed.totalReturnPence)).toBe('£1,351.69')
    expect(parsed.winningEntries).toBe(38)
    expect(parsed.totalsByPlayer.taz).toBe(10423)
  })

  it('accounts for every penny across all five seasons', () => {
    const seasons = ['2020-21', '2022-23', '2023-24', '2024-25', '2025-26']
    const total = seasons.reduce((sum, id) => sum + readSeason(id).totalReturnPence, 0)

    // £1,351.69 + £1,335.44 + £2,105.00 + £1,154.38 + £1,019.19
    expect(formatPenceWithSeparators(total)).toBe('£6,965.70')
  })
})
