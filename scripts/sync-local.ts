/**
 * Run a Super 6 sync locally.
 *
 *   npm run sync:local              # against an in-memory store (safe, no AWS)
 *   npm run sync:local -- --write    # against DynamoDB (needs FOURFOLD_TABLE_NAME)
 *   npm run sync:local -- --twice    # prove the sync is idempotent
 *
 * This calls the real, read-only Super 6 API. Useful for checking the
 * integration still works after Sky changes something, without deploying.
 */
import { formatPence } from '../shared/domain/money'
import { Super6Client } from '../shared/super6/client'
import { DynamoRepository } from '../server/src/repo/dynamo'
import { InMemoryRepository } from '../server/src/repo/memory'
import type { FourFoldRepository } from '../server/src/repo/types'
import { syncSuper6 } from '../server/src/sync'

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const twice = process.argv.includes('--twice')

  let repo: FourFoldRepository
  if (write) {
    const tableName = process.env.FOURFOLD_TABLE_NAME
    if (!tableName) {
      console.error('FOURFOLD_TABLE_NAME must be set with --write')
      process.exit(1)
    }
    repo = new DynamoRepository({ tableName })
    console.log(`Writing to DynamoDB table "${tableName}"`)
  } else {
    repo = new InMemoryRepository()
    console.log('Using an in-memory store (nothing is persisted)')
  }

  const client = new Super6Client(
    process.env.SUPER6_BASE_URL ? { baseUrl: process.env.SUPER6_BASE_URL } : {},
  )

  console.log(`Super 6 /ping: ${(await client.ping()) ? 'healthy' : 'unreachable'}\n`)

  const first = await syncSuper6({ client, repo })
  report('First run', first)

  if (twice) {
    const second = await syncSuper6({ client, repo })
    report('Second run', second)

    if (second.roundsCreated > 0) {
      console.error(
        `\nFAIL: the second run created ${second.roundsCreated} rounds. ` +
          `Syncing is meant to be idempotent.`,
      )
      process.exit(1)
    }
    console.log('\nOK: the second run created nothing. Syncing is idempotent.')
  }

  if (!first.seasonId) return

  const bundle = await repo.getSeasonBundle(first.seasonId)
  if (!bundle) return

  console.log(`\n${bundle.season.name} — ${bundle.rounds.length} round(s) stored`)
  for (const round of bundle.rounds) {
    console.log(`\n  ${round.name} (${round.status}) ${round.startsAt ?? 'no start time'}`)
    for (const fixture of round.fixtures) {
      const score =
        fixture.homeScore === null || fixture.awayScore === null
          ? 'v'
          : `${fixture.homeScore}-${fixture.awayScore}`
      console.log(
        `    ${fixture.position}. ${fixture.homeTeam} ${score} ${fixture.awayTeam}` +
          `  [${fixture.status}] ${fixture.kickOffAt ?? ''}`,
      )
    }
  }

  const totalReturns = bundle.returns.reduce((sum, r) => sum + r.amountPence, 0)
  console.log(`\nStored returns for this season: ${formatPence(totalReturns)}`)
}

function report(label: string, result: Awaited<ReturnType<typeof syncSuper6>>): void {
  console.log(
    `${label}: ok=${result.ok} season=${result.seasonId ?? '-'} ` +
      `created=${result.roundsCreated} updated=${result.roundsUpdated} ` +
      `unchanged=${result.roundsSkipped}`,
  )
  for (const warning of result.warnings) console.log(`  warning: ${warning}`)
  if (result.error) console.log(`  error: ${result.error}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
