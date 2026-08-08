import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseReturnToPence } from '../../shared/domain/money'
import type { Return, Round, Season } from '../../shared/domain/types'
import { LoginThrottle, hashPassword, issueToken } from './auth'
import { corsHeaders, handleRequest, type ApiDeps, type ApiRequest } from './api'
import type { AppConfig } from './config'
import { InMemoryRepository } from './repo/memory'

const PASSWORD = 'a-decent-admin-password'
const TOKEN_SECRET = 'z'.repeat(64)
const NOW = () => '2026-08-23T18:00:00.000Z'
const SILENT = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

let config: AppConfig
let repo: InMemoryRepository
let deps: ApiDeps
let adminToken: string

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: '2026-27',
    name: '2026/27',
    startYear: 2026,
    status: 'active',
    playerIds: ['dan', 'mat', 'paul-s', 'paul-v', 'frank', 'jase', 'ash'],
    imported: false,
    createdAt: NOW(),
    ...overrides,
  }
}

function round(seasonId: string, roundNumber: number, overrides: Partial<Round> = {}): Round {
  return {
    id: `${seasonId}:${roundNumber}`,
    seasonId,
    externalRoundId: roundNumber,
    name: `Round ${roundNumber}`,
    roundNumber,
    status: 'complete',
    startsAt: '2026-08-22T11:00:00.000Z',
    endsAt: '2026-08-23T17:00:00.000Z',
    fixtures: [
      {
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
        homeScore: 2,
        awayScore: 1,
        status: 'finished',
        rawStatus: 'Full Time',
        competition: 'Premier League',
        void: false,
      },
    ],
    importedAt: NOW(),
    lastSyncedAt: NOW(),
    source: 'super6',
    ...overrides,
  }
}

const request = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
  method: 'GET',
  path: '/api/health',
  query: {},
  headers: {},
  sourceIp: '1.2.3.4',
  ...overrides,
})

const authed = (overrides: Partial<ApiRequest> = {}): ApiRequest =>
  request({ ...overrides, headers: { authorization: `Bearer ${adminToken}`, ...overrides.headers } })

beforeEach(async () => {
  repo = new InMemoryRepository()
  config = {
    tableName: 'test',
    adminPasswordHash: await hashPassword(PASSWORD),
    tokenSecret: TOKEN_SECRET,
    allowedOrigins: ['https://new.fourfold.co.uk'],
    super6BaseUrl: undefined,
  }
  deps = { repo, config, now: NOW, throttle: new LoginThrottle(), logger: SILENT }
  adminToken = issueToken(TOKEN_SECRET)

  await repo.putSeason(season())
  await repo.putRound(round('2026-27', 1))
  await repo.putRound(round('2026-27', 2))
})

describe('public routes', () => {
  it('reports health', async () => {
    const response = await handleRequest(request({ path: '/api/health' }), deps)
    expect(response.status).toBe(200)
  })

  it('lists seasons newest first and identifies the current one', async () => {
    await repo.putSeason(season({ id: '2024-25', name: '2024/25', status: 'complete' }))

    const response = await handleRequest(request({ path: '/api/seasons' }), deps)
    const body = response.body as { seasons: Season[]; currentSeasonId: string }

    expect(body.seasons.map((s) => s.id)).toEqual(['2026-27', '2024-25'])
    expect(body.currentSeasonId).toBe('2026-27')
  })

  it('returns a season with standings, summary and rounds newest first', async () => {
    await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'mat', amount: '18.40' },
      }),
      deps,
    )

    const response = await handleRequest(request({ path: '/api/seasons/2026-27' }), deps)
    const body = response.body as {
      standings: { playerId: string; totalReturnPence: number; profitPence: number }[]
      summary: { roundCount: number; totalReturnPence: number }
      rounds: { id: string; returns: unknown[]; fixtures: unknown[] }[]
    }

    expect(body.summary.roundCount).toBe(2)
    expect(body.summary.totalReturnPence).toBe(1840)
    expect(body.standings[0]).toMatchObject({ playerId: 'mat', totalReturnPence: 1840 })
    // 2 rounds x £5 staked, £18.40 back.
    expect(body.standings[0].profitPence).toBe(1840 - 1000)
    expect(body.rounds.map((r) => r.id)).toEqual(['2026-27:2', '2026-27:1'])
    expect(body.rounds[1].returns).toHaveLength(1)
    expect(body.rounds[0].fixtures).toHaveLength(1)
  })

  it('identifies the round in play, not the highest-numbered one', async () => {
    // Round 1 open, rounds 2 and 3 announced for later — the real shape of a
    // season that has not started. Leading with round 3 was the original bug.
    await repo.putRound(round('2026-27', 1, { status: 'open' }))
    await repo.putRound(round('2026-27', 2, { status: 'future' }))
    await repo.putRound(round('2026-27', 3, { status: 'future' }))

    const response = await handleRequest(request({ path: '/api/current' }), deps)
    const body = response.body as { currentRoundId: string; currentRoundKind: string }

    expect(body.currentRoundId).toBe('2026-27:1')
    expect(body.currentRoundKind).toBe('open')
  })

  it('points at the most recent result once rounds are done', async () => {
    const response = await handleRequest(request({ path: '/api/seasons/2026-27' }), deps)
    const body = response.body as { currentRoundId: string; currentRoundKind: string }

    // Both seeded rounds are complete.
    expect(body.currentRoundId).toBe('2026-27:2')
    expect(body.currentRoundKind).toBe('latest-result')
  })

  it('lists each season with its winner and totals', async () => {
    await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'jase', amount: '42.50' },
      }),
      deps,
    )

    const response = await handleRequest(request({ path: '/api/seasons' }), deps)
    const [current] = (
      response.body as {
        seasons: {
          id: string
          winner: { playerName: string; totalReturnPence: number } | null
          summary: { playedRoundCount: number; totalReturnPence: number } | null
        }[]
      }
    ).seasons

    expect(current.id).toBe('2026-27')
    expect(current.winner).toEqual({
      playerId: 'jase',
      playerName: 'Jase',
      totalReturnPence: 4250,
    })
    expect(current.summary?.playedRoundCount).toBe(2)
    expect(current.summary?.totalReturnPence).toBe(4250)
  })

  it('reports no winner for a season where nobody has returned anything', async () => {
    const response = await handleRequest(request({ path: '/api/seasons' }), deps)
    const [current] = (response.body as { seasons: { winner: unknown }[] }).seasons

    // Everyone level on nothing; naming a winner would be meaningless.
    expect(current.winner).toBeNull()
  })

  it('names the winner of each historical season', async () => {
    await repo.putSeason(
      season({ id: '2024-25', name: '2024/25', status: 'complete', imported: true }),
    )
    await repo.putRound(round('2024-25', 1, { source: 'csv-import', fixtures: [] }))
    await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2024-25', roundId: '2024-25:1', playerId: 'paul-v', amount: '267.91' },
      }),
      deps,
    )

    const response = await handleRequest(request({ path: '/api/seasons' }), deps)
    const seasons = (
      response.body as { seasons: { id: string; winner: { playerName: string } | null }[] }
    ).seasons

    expect(seasons.find((s) => s.id === '2024-25')?.winner?.playerName).toBe('Paul V')
  })

  it('404s an unknown season', async () => {
    const response = await handleRequest(request({ path: '/api/seasons/1999-00' }), deps)
    expect(response.status).toBe(404)
  })

  it('serves the whole home page in one request', async () => {
    const response = await handleRequest(request({ path: '/api/current' }), deps)
    const body = response.body as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.season).toMatchObject({ id: '2026-27' })
    expect(body.standings).toHaveLength(7)
    expect(body.rounds).toHaveLength(2)
    expect(body.seasons).toHaveLength(1)
  })

  it('copes with a database that has no seasons yet', async () => {
    const empty = { ...deps, repo: new InMemoryRepository() }
    const response = await handleRequest(request({ path: '/api/current' }), empty)

    expect(response.status).toBe(200)
    expect((response.body as { season: unknown }).season).toBeNull()
  })

  it('does not expose sync errors publicly', async () => {
    await repo.putSyncState({
      lastRunAt: NOW(),
      lastSuccessAt: NOW(),
      lastError: 'Super 6 is unavailable: secret internal detail',
      latestRoundId: '2026-27:2',
      roundsCreated: 0,
      roundsUpdated: 0,
    })

    const response = await handleRequest(request({ path: '/api/current' }), deps)
    expect(JSON.stringify(response.body)).not.toContain('secret internal detail')
    expect((response.body as { sync: Record<string, unknown> }).sync).toEqual({
      lastSuccessAt: NOW(),
      latestRoundId: '2026-27:2',
    })
  })

  it('404s an unknown route', async () => {
    const response = await handleRequest(request({ path: '/api/nonsense' }), deps)
    expect(response.status).toBe(404)
  })
})

describe('admin authentication', () => {
  it('issues a token for the right password', async () => {
    const response = await handleRequest(
      request({ method: 'POST', path: '/api/admin/login', body: { password: PASSWORD } }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(typeof (response.body as { token: string }).token).toBe('string')
  })

  it('rejects the wrong password without saying why', async () => {
    const response = await handleRequest(
      request({ method: 'POST', path: '/api/admin/login', body: { password: 'wrong' } }),
      deps,
    )

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: 'Incorrect password' })
  })

  it('rejects a missing or non-string password', async () => {
    for (const body of [{}, { password: 123 }, { password: null }]) {
      const response = await handleRequest(
        request({ method: 'POST', path: '/api/admin/login', body }),
        deps,
      )
      expect(response.status).toBe(401)
    }
  })

  it('throttles repeated failures', async () => {
    const throttle = new LoginThrottle(3, 60_000)
    const throttled = { ...deps, throttle }

    for (let i = 0; i < 3; i += 1) {
      await handleRequest(
        request({ method: 'POST', path: '/api/admin/login', body: { password: 'wrong' } }),
        throttled,
      )
    }

    const blocked = await handleRequest(
      request({ method: 'POST', path: '/api/admin/login', body: { password: PASSWORD } }),
      throttled,
    )
    expect(blocked.status).toBe(429)
  })

  it('reports unavailable rather than granting access when unconfigured', async () => {
    const unconfigured = {
      ...deps,
      config: { ...config, adminPasswordHash: '', tokenSecret: '' },
    }

    const response = await handleRequest(
      request({ method: 'POST', path: '/api/admin/login', body: { password: PASSWORD } }),
      unconfigured,
    )
    expect(response.status).toBe(503)
  })

  it('refuses every mutation without a valid token', async () => {
    const mutations: ApiRequest[] = [
      request({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'mat', amount: '5.00' },
      }),
      request({ method: 'PUT', path: '/api/admin/returns/abc', body: { seasonId: '2026-27', amount: '5.00' } }),
      request({ method: 'DELETE', path: '/api/admin/returns/abc', query: { seasonId: '2026-27' } }),
      request({ method: 'POST', path: '/api/admin/sync' }),
      request({ method: 'GET', path: '/api/admin/sync' }),
    ]

    for (const mutation of mutations) {
      const response = await handleRequest(mutation, deps)
      expect(response.status, mutation.path).toBe(401)
    }
    expect(repo.allReturns()).toHaveLength(0)
  })

  it('rejects a token signed with the wrong secret', async () => {
    const response = await handleRequest(
      request({
        method: 'POST',
        path: '/api/admin/sync',
        headers: { authorization: `Bearer ${issueToken('different-secret-value')}` },
      }),
      deps,
    )
    expect(response.status).toBe(401)
  })

  it('rejects an expired token', async () => {
    const expired = issueToken(TOKEN_SECRET, 1_000_000, 60)
    const response = await handleRequest(
      request({ method: 'GET', path: '/api/admin/sync', headers: { authorization: `Bearer ${expired}` } }),
      deps,
    )
    expect(response.status).toBe(401)
  })
})

describe('entering winnings', () => {
  it('records a return and updates the standings', async () => {
    const response = await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'jase', amount: '18.40' },
      }),
      deps,
    )

    expect(response.status).toBe(201)
    expect((response.body as { return: Return }).return.amountPence).toBe(1840)

    const view = await handleRequest(request({ path: '/api/seasons/2026-27' }), deps)
    const standings = (view.body as { standings: { playerId: string; profitPence: number }[] }).standings
    expect(standings[0].playerId).toBe('jase')
    // £18.40 back against 2 rounds x £5 staked.
    expect(standings[0].profitPence).toBe(840)
  })

  it('treats the entered figure as the return, not the profit', async () => {
    await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'mat', amount: '18.40' },
      }),
      deps,
    )

    const stored = repo.allReturns()[0]
    expect(stored.amountPence).toBe(parseReturnToPence('18.40'))
    expect(stored.amountPence).not.toBe(parseReturnToPence('13.40'))
  })

  it('accepts several winners in one round', async () => {
    for (const [playerId, amount] of [['dan', '10.73'], ['mat', '15.37'], ['paul-s', '14.73']]) {
      const response = await handleRequest(
        authed({
          method: 'POST',
          path: '/api/admin/returns',
          body: { seasonId: '2026-27', roundId: '2026-27:1', playerId, amount },
        }),
        deps,
      )
      expect(response.status).toBe(201)
    }

    const view = await handleRequest(request({ path: '/api/seasons/2026-27' }), deps)
    const rounds = (view.body as { rounds: { id: string; returns: unknown[] }[] }).rounds
    expect(rounds.find((r) => r.id === '2026-27:1')?.returns).toHaveLength(3)
  })

  it('accepts two separate returns for one player in one round', async () => {
    for (const amount of ['8.50', '4.10']) {
      await handleRequest(
        authed({
          method: 'POST',
          path: '/api/admin/returns',
          body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'ash', amount },
        }),
        deps,
      )
    }

    expect(repo.allReturns()).toHaveLength(2)
    const view = await handleRequest(request({ path: '/api/seasons/2026-27' }), deps)
    const standings = (view.body as { standings: { playerId: string; totalReturnPence: number; winningRounds: number }[] }).standings
    const ash = standings.find((r) => r.playerId === 'ash')
    expect(ash?.totalReturnPence).toBe(1260)
    // Still one winning round, not two.
    expect(ash?.winningRounds).toBe(1)
  })

  it('validates the amount server-side', async () => {
    for (const amount of ['', 'twelve', '-5.00', '1.234', '£', null]) {
      const response = await handleRequest(
        authed({
          method: 'POST',
          path: '/api/admin/returns',
          body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'mat', amount },
        }),
        deps,
      )
      expect(response.status, String(amount)).toBe(400)
    }
    expect(repo.allReturns()).toHaveLength(0)
  })

  it('rejects a missing field', async () => {
    const response = await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', playerId: 'mat', amount: '5.00' },
      }),
      deps,
    )
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toContain('roundId')
  })

  it('rejects a body that is not an object', async () => {
    for (const body of ['a string', 42, [1, 2], null]) {
      const response = await handleRequest(
        authed({ method: 'POST', path: '/api/admin/returns', body }),
        deps,
      )
      expect(response.status).toBe(400)
    }
  })

  it('rejects a round that is not in that season', async () => {
    const response = await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:99', playerId: 'mat', amount: '5.00' },
      }),
      deps,
    )
    expect(response.status).toBe(404)
  })

  it('rejects a player who did not play that season', async () => {
    await repo.putSeason(
      season({ id: '2020-21', name: '2020/21', status: 'complete', playerIds: ['dan', 'taz'] }),
    )
    await repo.putRound(round('2020-21', 1, { source: 'csv-import', fixtures: [] }))

    const response = await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2020-21', roundId: '2020-21:1', playerId: 'jase', amount: '5.00' },
      }),
      deps,
    )
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toContain('did not play')
  })
})

describe('correcting and deleting returns', () => {
  async function create(amount: string) {
    const response = await handleRequest(
      authed({
        method: 'POST',
        path: '/api/admin/returns',
        body: { seasonId: '2026-27', roundId: '2026-27:1', playerId: 'mat', amount },
      }),
      deps,
    )
    return (response.body as { return: Return }).return
  }

  it('corrects an amount in place', async () => {
    const created = await create('18.40')

    const response = await handleRequest(
      authed({
        method: 'PUT',
        path: `/api/admin/returns/${created.id}`,
        body: { seasonId: '2026-27', amount: '13.40', note: 'entered profit by mistake' },
      }),
      deps,
    )

    expect(response.status).toBe(200)
    const updated = (response.body as { return: Return }).return
    expect(updated.amountPence).toBe(1340)
    expect(updated.id).toBe(created.id)
    expect(updated.note).toBe('entered profit by mistake')
    // Still one record, not two.
    expect(repo.allReturns()).toHaveLength(1)
  })

  it('validates a correction', async () => {
    const created = await create('18.40')

    const response = await handleRequest(
      authed({
        method: 'PUT',
        path: `/api/admin/returns/${created.id}`,
        body: { seasonId: '2026-27', amount: 'oops' },
      }),
      deps,
    )
    expect(response.status).toBe(400)
    expect(repo.allReturns()[0].amountPence).toBe(1840)
  })

  it('deletes a mistaken entry', async () => {
    const created = await create('18.40')

    const response = await handleRequest(
      authed({
        method: 'DELETE',
        path: `/api/admin/returns/${created.id}`,
        query: { seasonId: '2026-27' },
      }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(repo.allReturns()).toHaveLength(0)

    const view = await handleRequest(request({ path: '/api/seasons/2026-27' }), deps)
    expect((view.body as { summary: { totalReturnPence: number } }).summary.totalReturnPence).toBe(0)
  })

  it('404s an unknown return', async () => {
    const missing = await handleRequest(
      authed({ method: 'PUT', path: '/api/admin/returns/nope', body: { seasonId: '2026-27', amount: '1.00' } }),
      deps,
    )
    expect(missing.status).toBe(404)

    const deleted = await handleRequest(
      authed({ method: 'DELETE', path: '/api/admin/returns/nope', query: { seasonId: '2026-27' } }),
      deps,
    )
    expect(deleted.status).toBe(404)
  })

  it('requires the season when deleting', async () => {
    const created = await create('18.40')
    const response = await handleRequest(
      authed({ method: 'DELETE', path: `/api/admin/returns/${created.id}` }),
      deps,
    )
    expect(response.status).toBe(400)
    expect(repo.allReturns()).toHaveLength(1)
  })

  it('will not let one season delete another season\'s return', async () => {
    const created = await create('18.40')
    await repo.putSeason(season({ id: '2024-25', name: '2024/25', status: 'complete' }))

    const response = await handleRequest(
      authed({ method: 'DELETE', path: `/api/admin/returns/${created.id}`, query: { seasonId: '2024-25' } }),
      deps,
    )
    expect(response.status).toBe(404)
    expect(repo.allReturns()).toHaveLength(1)
  })
})

describe('CORS', () => {
  it('reflects only configured origins', () => {
    expect(corsHeaders('https://new.fourfold.co.uk', config)).toMatchObject({
      'access-control-allow-origin': 'https://new.fourfold.co.uk',
    })
  })

  it('sends nothing for an unknown origin', () => {
    expect(corsHeaders('https://evil.example', config)).toEqual({})
    expect(corsHeaders(undefined, config)).toEqual({})
  })

  it('never sends a wildcard', () => {
    const headers = corsHeaders('https://new.fourfold.co.uk', config)
    expect(Object.values(headers)).not.toContain('*')
  })
})
