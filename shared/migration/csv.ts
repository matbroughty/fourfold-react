/**
 * Import the historical FourFold results.
 *
 * The competition's history lives in a set of CSVs, one per season, in the
 * format used by the old static site and the CSV-driven React app:
 *
 *     Dan,Mat,Paul S,Paul V,Frank,Jase,Ash    <- header: the season's roster
 *     0.00,0.00,0.00,0.00,0.00,0.00,16.84     <- round 1: Ash returned £16.84
 *     0.00,0.00,0.00,0.00,0.00,0.00,0.00      <- round 2: nobody won
 *
 * Each cell is the RETURN that player received for that round, in pounds. A
 * round is a row; the row's position is the only round identifier that exists,
 * because these files record no dates, no fixtures and no Super 6 round ids.
 *
 * Notes on the real data:
 *  - 2020-21 uses a different roster (Dan, Mat, Paul S, Paul V, Taz) and has
 *    stray leading spaces in its header row.
 *  - There is no 2021-22 file. That season is genuinely missing, not mislaid.
 *
 * The format has no quoting or embedded commas, so a plain split is correct and
 * saves a dependency. Anything that does not match is rejected loudly rather
 * than guessed at.
 */
import { parseReturnToPence } from '../domain/money'
import { playerIdFromCsvHeader } from '../domain/players'

export class HistoricalCsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HistoricalCsvError'
  }
}

export interface HistoricalReturn {
  playerId: string
  amountPence: number
}

export interface HistoricalRound {
  /** 1-based row position. The only round identity the CSVs carry. */
  roundNumber: number
  /** Only players who actually received something. Zero cells are omitted. */
  returns: HistoricalReturn[]
}

export interface ParsedHistoricalSeason {
  seasonId: string
  /** The roster, in CSV column order. */
  playerIds: string[]
  rounds: HistoricalRound[]
  /** Cross-check totals, used by the migration to verify the import. */
  totalReturnPence: number
  /** Player-rounds that produced a return — the old site's "Total Wins". */
  winningEntries: number
  totalsByPlayer: Record<string, number>
}

/**
 * Parse one season's CSV.
 *
 * Zero cells produce no return record. The absence of a return *is* zero, and
 * writing ~350 zero rows per season would be noise in the database and in the
 * admin UI. Standings treat a missing record as nothing won.
 */
export function parseHistoricalCsv(
  seasonId: string,
  text: string,
): ParsedHistoricalSeason {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    throw new HistoricalCsvError(`${seasonId}: file is empty`)
  }

  const headers = lines[0].split(',').map((h) => h.trim())
  const playerIds = headers.map((header) => {
    const playerId = playerIdFromCsvHeader(header)
    if (!playerId) {
      throw new HistoricalCsvError(
        `${seasonId}: unrecognised player column "${header}". ` +
          `Add them to CSV_HEADER_TO_PLAYER_ID in shared/domain/players.ts.`,
      )
    }
    return playerId
  })

  const duplicates = playerIds.filter((id, i) => playerIds.indexOf(id) !== i)
  if (duplicates.length > 0) {
    throw new HistoricalCsvError(
      `${seasonId}: duplicate player columns: ${[...new Set(duplicates)].join(', ')}`,
    )
  }

  const rounds: HistoricalRound[] = []
  const totalsByPlayer: Record<string, number> = Object.fromEntries(
    playerIds.map((id) => [id, 0]),
  )
  let totalReturnPence = 0
  let winningEntries = 0

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((c) => c.trim())
    const roundNumber = i

    if (cells.length !== playerIds.length) {
      throw new HistoricalCsvError(
        `${seasonId}: round ${roundNumber} has ${cells.length} values but the ` +
          `header declares ${playerIds.length} players`,
      )
    }

    const returns: HistoricalReturn[] = []
    for (let column = 0; column < cells.length; column += 1) {
      const playerId = playerIds[column]
      let amountPence: number
      try {
        amountPence = parseReturnToPence(cells[column] || '0')
      } catch {
        throw new HistoricalCsvError(
          `${seasonId}: round ${roundNumber}, ${playerId}: ` +
            `"${cells[column]}" is not a valid return`,
        )
      }

      totalsByPlayer[playerId] += amountPence
      totalReturnPence += amountPence

      if (amountPence > 0) {
        winningEntries += 1
        returns.push({ playerId, amountPence })
      }
    }

    rounds.push({ roundNumber, returns })
  }

  return {
    seasonId,
    playerIds,
    rounds,
    totalReturnPence,
    winningEntries,
    totalsByPlayer,
  }
}

/**
 * Derive a season id from a historical filename.
 * `"kent-24-25.csv"`, `"Kent_22_23.csv"` and `"2024-25.csv"` all work.
 */
export function seasonIdFromFilename(filename: string): string {
  const match = /(\d{2})[-_](\d{2})/.exec(filename.replace(/\.csv$/i, ''))
  if (!match) {
    throw new HistoricalCsvError(`Cannot work out the season from "${filename}"`)
  }
  const [, start, end] = match
  return `20${start}-${end}`
}
