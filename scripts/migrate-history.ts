/**
 * Import the historical FourFold seasons into the database.
 *
 *   npm run migrate:history              # dry run — prints what it would write
 *   npm run migrate:history -- --write   # actually writes
 *
 * Safe to run repeatedly. Every record id is derived from the season, round and
 * player, so a second run overwrites the same rows instead of adding duplicates.
 *
 * The imported seasons have returns but no fixtures: the source CSVs contain no
 * dates, teams or Super 6 round ids, and none of that is invented here. Rounds
 * are marked `source: 'csv-import'` so the UI can say so honestly.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatPenceWithSeparators } from '../shared/domain/money'
import { playerName } from '../shared/domain/players'
import { calculateStandings } from '../shared/domain/standings'
import type { Return, Round, Season } from '../shared/domain/types'
import { parseHistoricalCsv } from '../shared/migration/csv'
import { DynamoRepository } from '../server/src/repo/dynamo'
import { InMemoryRepository } from '../server/src/repo/memory'
import type { FourFoldRepository } from '../server/src/repo/types'

const HISTORY_DIR = join(import.meta.dirname, '../data/history')

/**
 * Seasons that are finished. 2025-26 ended in May 2026; the current season is
 * created by the Super 6 sync, not by this script.
 */
const COMPLETE_SEASONS = new Set(['2020-21', '2022-23', '2023-24', '2024-25', '2025-26'])

interface Plan {
  seasons: Season[]
  rounds: Round[]
  returns: Return[]
}

function buildPlan(nowIso: string): Plan {
  const files = readdirSync(HISTORY_DIR)
    .filter((f) => f.endsWith('.csv'))
    .sort()

  const plan: Plan = { seasons: [], rounds: [], returns: [] }

  for (const file of files) {
    const seasonId = file.replace(/\.csv$/, '')
    const parsed = parseHistoricalCsv(seasonId, readFileSync(join(HISTORY_DIR, file), 'utf8'))

    plan.seasons.push({
      id: seasonId,
      name: seasonId.replace('-', '/'),
      startYear: Number.parseInt(seasonId.slice(0, 4), 10),
      status: COMPLETE_SEASONS.has(seasonId) ? 'complete' : 'active',
      playerIds: parsed.playerIds,
      imported: true,
      createdAt: nowIso,
    })

    for (const round of parsed.rounds) {
      const roundId = `${seasonId}:${round.roundNumber}`

      plan.rounds.push({
        id: roundId,
        seasonId,
        // These predate our Super 6 integration; there is no Sky id for them.
        externalRoundId: null,
        name: `Round ${round.roundNumber}`,
        roundNumber: round.roundNumber,
        status: 'complete',
        startsAt: null,
        endsAt: null,
        fixtures: [],
        importedAt: nowIso,
        lastSyncedAt: nowIso,
        source: 'csv-import',
      })

      for (const entry of round.returns) {
        plan.returns.push({
          // Deterministic, so re-running the import is idempotent.
          id: `import-${seasonId}-${round.roundNumber}-${entry.playerId}`,
          seasonId,
          roundId,
          playerId: entry.playerId,
          amountPence: entry.amountPence,
          note: 'Imported from historical CSV',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      }
    }
  }

  return plan
}

async function apply(repo: FourFoldRepository, plan: Plan): Promise<void> {
  for (const season of plan.seasons) await repo.putSeason(season)
  for (const round of plan.rounds) await repo.putRound(round)
  for (const value of plan.returns) await repo.putReturn(value)
}

/** Recompute standings from what was written, and print them for eyeballing. */
async function report(repo: FourFoldRepository, plan: Plan): Promise<void> {
  for (const season of plan.seasons) {
    const bundle = await repo.getSeasonBundle(season.id)
    if (!bundle) throw new Error(`${season.id} was not stored`)

    const standings = calculateStandings({
      seasonId: season.id,
      seasonName: season.name,
      playerIds: season.playerIds,
      rounds: bundle.rounds,
      returns: bundle.returns,
      participation: bundle.participation,
    })

    const total = standings.reduce((sum, row) => sum + row.totalReturnPence, 0)
    console.log(
      `\n${season.name}  ${bundle.rounds.length} rounds  ` +
        `total returns ${formatPenceWithSeparators(total)}`,
    )
    for (const row of standings) {
      console.log(
        `  ${String(row.position).padStart(2)}. ${playerName(row.playerId).padEnd(8)} ` +
          `${formatPenceWithSeparators(row.totalReturnPence).padStart(10)}  ` +
          `stake ${formatPenceWithSeparators(row.totalStakePence).padStart(9)}  ` +
          `p/l ${formatPenceWithSeparators(row.profitPence).padStart(10)}  ` +
          `wins ${String(row.winningRounds).padStart(2)}`,
      )
    }
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const tableName = process.env.FOURFOLD_TABLE_NAME
  const nowIso = new Date().toISOString()

  const plan = buildPlan(nowIso)
  console.log(
    `Planned: ${plan.seasons.length} seasons, ${plan.rounds.length} rounds, ` +
      `${plan.returns.length} return records`,
  )

  if (!write) {
    // Apply to a throwaway repository so the printed standings are computed
    // from real stored data rather than from the plan.
    const repo = new InMemoryRepository()
    await apply(repo, plan)
    await report(repo, plan)
    console.log('\nDRY RUN — nothing was written. Re-run with --write to persist.')
    return
  }

  if (!tableName) {
    console.error('FOURFOLD_TABLE_NAME must be set to write to DynamoDB.')
    process.exit(1)
  }

  const repo = new DynamoRepository({ tableName })
  await apply(repo, plan)
  await report(repo, plan)
  console.log(`\nWritten to DynamoDB table "${tableName}".`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
