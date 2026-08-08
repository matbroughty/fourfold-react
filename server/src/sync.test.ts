import { beforeEach, describe, expect, it, vi } from 'vitest'
import roundDetail from '../../shared/super6/__fixtures__/round-detail.json'
import { Super6Client } from '../../shared/super6/client'
import type { RawRoundDetail } from '../../shared/super6/types'
import { InMemoryRepository } from './repo/memory'
import { syncSuper6 } from './sync'

const NOW = () => '2026-08-08T12:00:00.000Z'
const SILENT = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

type Handler = () => { status?: number; body?: unknown; throws?: boolean }

/** A Super6Client wired to canned responses instead of the network. */
function makeClient(routes: Record<string, Handler>) {
  const calls: string[] = []

  const fetchFn = (async (url: string) => {
    const path = new URL(url).pathname.replace(/^\/v2/, '')
    calls.push(path)

    const handler = routes[path]
    if (!handler) return { ok: false, status: 404, json: async () => ({}) } as Response

    const { status = 200, body, throws } = handler()
    if (throws) throw new Error('network down')

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }) as unknown as typeof fetch

  const client = new Super6Client({
    fetchFn,
    maxAttempts: 1,
    sleepFn: async () => {},
    logger: SILENT,
  })

  return { client, calls }
}

/** Build a round payload based on the real captured response. */
function round(
  id: number,
  overrides: Partial<RawRoundDetail> = {},
  fixtureOverrides: (index: number) => Record<string, unknown> = () => ({}),
): RawRoundDetail {
  const base = structuredClone(roundDetail) as RawRoundDetail
  return {
    ...base,
    id,
    scoreChallenges: (base.scoreChallenges ?? []).map((challenge, index) => ({
      ...challenge,
      match: { ...challenge.match, ...fixtureOverrides(index) },
    })),
    ...overrides,
  }
}

const THREE_ROUND_LIST = [
  { id: 1, status: 'open', startDateTime: '2026-07-17T11:17:00Z' },
  { id: 2, status: 'future', startDateTime: '2026-08-23T17:45:00Z' },
  { id: 3, status: 'future', startDateTime: '2026-08-30T17:45:00Z' },
]

function fullSeasonRoutes(): Record<string, Handler> {
  return {
    '/round/active': () => ({ body: round(1) }),
    '/round': () => ({ body: THREE_ROUND_LIST }),
    '/round/1': () => ({ body: round(1) }),
    '/round/2': () => ({ body: round(2, { status: 'future' }) }),
    '/round/3': () => ({ body: round(3, { status: 'future' }) }),
  }
}

describe('syncSuper6 — first run', () => {
  let repo: InMemoryRepository

  beforeEach(() => {
    repo = new InMemoryRepository()
  })

  it('creates the season and every advertised round', async () => {
    const { client } = makeClient(fullSeasonRoutes())
    const result = await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    expect(result.ok).toBe(true)
    expect(result.seasonId).toBe('2026-27')
    expect(result.roundsCreated).toBe(3)
    expect(result.roundsUpdated).toBe(0)
    expect(result.error).toBeNull()

    const rounds = repo.allRounds()
    expect(rounds.map((r) => r.id)).toEqual(['2026-27:1', '2026-27:2', '2026-27:3'])
    expect(rounds[0].fixtures).toHaveLength(6)
  })

  it('creates the season with the current roster', async () => {
    const { client } = makeClient(fullSeasonRoutes())
    await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    const season = await repo.getSeason('2026-27')
    expect(season?.name).toBe('2026/27')
    expect(season?.startYear).toBe(2026)
    expect(season?.status).toBe('active')
    expect(season?.imported).toBe(false)
    expect(season?.playerIds).toHaveLength(7)
    expect(season?.playerIds).toContain('mat')
    expect(season?.playerIds).not.toContain('taz')
  })

  it('records the latest round and a successful sync', async () => {
    const { client } = makeClient(fullSeasonRoutes())
    await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    const state = await repo.getSyncState()
    expect(state?.latestRoundId).toBe('2026-27:3')
    expect(state?.lastSuccessAt).toBe('2026-08-08T12:00:00.000Z')
    expect(state?.lastError).toBeNull()
  })
})

describe('syncSuper6 — idempotency', () => {
  it('creates no duplicates however many times it runs', async () => {
    const repo = new InMemoryRepository()
    const { client } = makeClient(fullSeasonRoutes())

    for (let i = 0; i < 5; i += 1) {
      await syncSuper6({ client, repo, now: NOW, logger: SILENT })
    }

    const rounds = repo.allRounds()
    expect(rounds).toHaveLength(3)
    expect(new Set(rounds.map((r) => r.id)).size).toBe(3)
    expect((await repo.listSeasons())).toHaveLength(1)
  })

  it('writes nothing on a second identical run', async () => {
    const repo = new InMemoryRepository()
    const { client } = makeClient(fullSeasonRoutes())

    await syncSuper6({ client, repo, now: NOW, logger: SILENT })
    const writesAfterFirst = repo.writeCount

    const second = await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    expect(second.roundsCreated).toBe(0)
    expect(second.roundsUpdated).toBe(0)
    expect(second.roundsSkipped).toBe(3)
    // Only the sync-state record is written.
    expect(repo.writeCount - writesAfterFirst).toBe(1)
  })

  it('preserves importedAt but advances lastSyncedAt when content changes', async () => {
    const repo = new InMemoryRepository()
    let status = 'open'
    let homeScore = 0

    const { client } = makeClient({
      '/round/active': () => ({
        body: round(1, { status }, (i) => (i === 0 ? { homeTeam: { id: 156, name: 'Everton', score: homeScore }, status: status === 'inplay' ? 'Second Half Started' : 'Pre Live' } : {})),
      }),
      '/round': () => ({ body: [{ id: 1, status }] }),
      '/round/1': () => ({
        body: round(1, { status }, (i) => (i === 0 ? { homeTeam: { id: 156, name: 'Everton', score: homeScore }, status: status === 'inplay' ? 'Second Half Started' : 'Pre Live' } : {})),
      }),
    })

    await syncSuper6({ client, repo, now: () => '2026-08-20T00:00:00.000Z', logger: SILENT })
    const first = await repo.getRound('2026-27:1')
    expect(first?.importedAt).toBe('2026-08-20T00:00:00.000Z')
    expect(first?.fixtures[0].homeScore).toBeNull()

    // The match kicks off and Everton score.
    status = 'inplay'
    homeScore = 1
    const result = await syncSuper6({
      client,
      repo,
      now: () => '2026-08-22T15:00:00.000Z',
      logger: SILENT,
    })

    expect(result.roundsUpdated).toBe(1)
    const updated = await repo.getRound('2026-27:1')
    expect(updated?.status).toBe('inplay')
    expect(updated?.fixtures[0].homeScore).toBe(1)
    // First-seen time is ours and must not move.
    expect(updated?.importedAt).toBe('2026-08-20T00:00:00.000Z')
    expect(updated?.lastSyncedAt).toBe('2026-08-22T15:00:00.000Z')
  })
})

describe('syncSuper6 — finished rounds are immutable', () => {
  it('stops rewriting a round once it is complete and settled', async () => {
    const repo = new InMemoryRepository()
    const finished = () => ({
      body: round(1, { status: 'complete' }, () => ({ status: 'Full Time' })),
    })

    const { client, calls } = makeClient({
      '/round/active': finished,
      '/round': () => ({ body: [{ id: 1, status: 'complete' }] }),
      '/round/1': finished,
    })

    await syncSuper6({ client, repo, now: NOW, logger: SILENT })
    const stored = await repo.getRound('2026-27:1')
    expect(stored?.status).toBe('complete')

    const writesBefore = repo.writeCount
    calls.length = 0

    const second = await syncSuper6({ client, repo, now: () => '2026-09-01T00:00:00.000Z', logger: SILENT })

    expect(second.roundsSkipped).toBe(1)
    expect(second.roundsUpdated).toBe(0)
    // Only the sync state is written; the round is untouched.
    expect(repo.writeCount - writesBefore).toBe(1)
    // And we did not even bother fetching the finished round again.
    expect(calls).not.toContain('/round/1')
  })
})

describe('syncSuper6 — resilience', () => {
  it('keeps stored fixtures when Super 6 returns a round with none', async () => {
    const repo = new InMemoryRepository()
    let withFixtures = true

    const payload = () => ({
      body: withFixtures ? round(1) : round(1, { scoreChallenges: [] }),
    })
    const { client } = makeClient({
      '/round/active': payload,
      '/round': () => ({ body: [{ id: 1, status: 'open' }] }),
      '/round/1': payload,
    })

    await syncSuper6({ client, repo, now: NOW, logger: SILENT })
    expect((await repo.getRound('2026-27:1'))?.fixtures).toHaveLength(6)

    withFixtures = false
    const result = await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    expect(result.ok).toBe(true)
    // Six fixtures must not vanish because of one thin response.
    expect((await repo.getRound('2026-27:1'))?.fixtures).toHaveLength(6)
  })

  it('reports failure without throwing or losing history when Sky is down', async () => {
    const repo = new InMemoryRepository()

    // Populate first.
    const good = makeClient(fullSeasonRoutes())
    await syncSuper6({ client: good.client, repo, now: NOW, logger: SILENT })
    expect(repo.allRounds()).toHaveLength(3)

    // Now everything fails.
    const down = makeClient({ '/round/active': () => ({ throws: true }) })
    const result = await syncSuper6({
      client: down.client,
      repo,
      now: () => '2026-08-09T12:00:00.000Z',
      logger: SILENT,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('unavailable')
    // History survives.
    expect(repo.allRounds()).toHaveLength(3)

    const state = await repo.getSyncState()
    expect(state?.lastError).toContain('unavailable')
    expect(state?.lastRunAt).toBe('2026-08-09T12:00:00.000Z')
    // The last good sync and known round are remembered, not blanked.
    expect(state?.lastSuccessAt).toBe('2026-08-08T12:00:00.000Z')
    expect(state?.latestRoundId).toBe('2026-27:3')
  })

  it('still syncs the active round when round discovery fails', async () => {
    const repo = new InMemoryRepository()
    const { client } = makeClient({
      '/round/active': () => ({ body: round(1) }),
      '/round': () => ({ throws: true }),
    })

    const result = await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    expect(result.ok).toBe(true)
    expect(result.roundsCreated).toBe(1)
    expect(result.warnings.join(' ')).toContain('Could not list rounds')
    expect(repo.allRounds().map((r) => r.id)).toEqual(['2026-27:1'])
  })

  it('leaves a stored round alone when Sky 404s it', async () => {
    const repo = new InMemoryRepository()

    const good = makeClient(fullSeasonRoutes())
    await syncSuper6({ client: good.client, repo, now: NOW, logger: SILENT })

    // Round 2 disappears from Sky, but stays in the list.
    const { client } = makeClient({
      '/round/active': () => ({ body: round(1) }),
      '/round': () => ({ body: THREE_ROUND_LIST }),
      '/round/1': () => ({ body: round(1) }),
      '/round/2': () => ({ status: 404, body: { message: 'not found' } }),
      '/round/3': () => ({ body: round(3, { status: 'future' }) }),
    })

    const result = await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    expect(result.ok).toBe(true)
    expect(result.warnings.join(' ')).toContain('no longer available')
    // We do not delete local history because Sky forgot about it.
    expect(repo.allRounds().map((r) => r.id)).toEqual([
      '2026-27:1',
      '2026-27:2',
      '2026-27:3',
    ])
  })

  it('carries on when a single round fails mid-run', async () => {
    const repo = new InMemoryRepository()
    const { client } = makeClient({
      '/round/active': () => ({ body: round(1) }),
      '/round': () => ({ body: THREE_ROUND_LIST }),
      '/round/1': () => ({ body: round(1) }),
      '/round/2': () => ({ throws: true }),
      '/round/3': () => ({ body: round(3, { status: 'future' }) }),
    })

    const result = await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    expect(result.ok).toBe(true)
    expect(result.roundsCreated).toBe(2)
    expect(result.warnings.join(' ')).toContain('Round 2 failed')
    expect(repo.allRounds().map((r) => r.id)).toEqual(['2026-27:1', '2026-27:3'])
  })

  it('does not touch imported CSV rounds that share an id space', async () => {
    const repo = new InMemoryRepository()
    // A historical round imported from CSV for an older season.
    await repo.putSeason({
      id: '2024-25',
      name: '2024/25',
      startYear: 2024,
      status: 'complete',
      playerIds: ['mat'],
      imported: true,
      createdAt: NOW(),
    })
    await repo.putRound({
      id: '2024-25:1',
      seasonId: '2024-25',
      externalRoundId: null,
      name: 'Round 1',
      roundNumber: 1,
      status: 'complete',
      startsAt: null,
      endsAt: null,
      fixtures: [],
      importedAt: NOW(),
      lastSyncedAt: NOW(),
      source: 'csv-import',
    })

    const { client } = makeClient(fullSeasonRoutes())
    await syncSuper6({ client, repo, now: NOW, logger: SILENT })

    // 2026-27 round 1 is a different record from 2024-25 round 1.
    const ids = repo.allRounds().map((r) => r.id)
    expect(ids).toContain('2024-25:1')
    expect(ids).toContain('2026-27:1')
    expect((await repo.getRound('2024-25:1'))?.source).toBe('csv-import')
  })
})
