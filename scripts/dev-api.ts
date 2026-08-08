/**
 * Local development API.
 *
 *   npm run dev:api
 *
 * Serves the same routes as the deployed Lambda, backed by an in-memory store
 * that is seeded from the historical CSVs and (unless --offline) one live Super 6
 * sync. Nothing is persisted, so restarting gives a clean slate.
 *
 * The admin password defaults to "fourfold-dev" and can be changed with
 * FOURFOLD_DEV_PASSWORD. This server is for localhost only.
 */
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseHistoricalCsv } from '../shared/migration/csv'
import { Super6Client } from '../shared/super6/client'
import { handleRequest, type ApiRequest } from '../server/src/api'
import { hashPassword } from '../server/src/auth'
import type { AppConfig } from '../server/src/config'
import { InMemoryRepository } from '../server/src/repo/memory'
import { syncSuper6 } from '../server/src/sync'

const PORT = Number(process.env.PORT ?? 3000)
const HISTORY_DIR = join(import.meta.dirname, '../data/history')
const COMPLETE_SEASONS = new Set(['2020-21', '2022-23', '2023-24', '2024-25', '2025-26'])

async function seed(repo: InMemoryRepository): Promise<void> {
  const nowIso = new Date().toISOString()

  for (const file of readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.csv')).sort()) {
    const seasonId = file.replace(/\.csv$/, '')
    const parsed = parseHistoricalCsv(seasonId, readFileSync(join(HISTORY_DIR, file), 'utf8'))

    await repo.putSeason({
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
      await repo.putRound({
        id: roundId,
        seasonId,
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
        await repo.putReturn({
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
  console.log(`Seeded ${(await repo.listSeasons()).length} historical seasons`)
}

async function main(): Promise<void> {
  const repo = new InMemoryRepository()
  await seed(repo)

  if (!process.argv.includes('--offline')) {
    console.log('Syncing the live Super 6 round…')
    const result = await syncSuper6({ client: new Super6Client(), repo })
    console.log(
      result.ok
        ? `Synced ${result.seasonId}: ${result.roundsCreated} round(s)`
        : `Sync failed (${result.error}) — carrying on with historical data only`,
    )
  }

  const password = process.env.FOURFOLD_DEV_PASSWORD ?? 'fourfold-dev'
  const config: AppConfig = {
    tableName: 'dev',
    adminPasswordHash: await hashPassword(password),
    tokenSecret: randomBytes(32).toString('hex'),
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    super6BaseUrl: process.env.SUPER6_BASE_URL,
  }

  createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))

    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
        const raw = Buffer.concat(chunks).toString('utf8')

        let body: unknown
        if (raw) {
          try {
            body = JSON.parse(raw)
          } catch {
            body = { __malformed: true }
          }
        }

        const request: ApiRequest = {
          method: req.method ?? 'GET',
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers as Record<string, string | undefined>,
          body,
          sourceIp: req.socket.remoteAddress ?? 'local',
        }

        const origin = req.headers.origin
        const cors: Record<string, string> =
          origin && config.allowedOrigins.includes(origin)
            ? {
                'access-control-allow-origin': origin,
                'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'access-control-allow-headers': 'authorization,content-type',
              }
            : {}

        if (request.method === 'OPTIONS') {
          res.writeHead(204, cors).end()
          return
        }

        const response = await handleRequest(request, { repo, config })
        console.log(`${request.method} ${request.path} -> ${response.status}`)

        res
          .writeHead(response.status, { 'content-type': 'application/json', ...cors })
          .end(JSON.stringify(response.body))
      })()
    })
  }).listen(PORT, () => {
    console.log(`\nFourFold dev API on http://localhost:${PORT}`)
    console.log(`Admin password: ${password}`)
    console.log('Now run `npm run dev` in another terminal.\n')
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
