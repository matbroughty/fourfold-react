/**
 * FourFold API client.
 *
 * The admin token is kept in localStorage. That is a deliberate, proportionate
 * choice: this is a private hobby site, the token expires in 12 hours, and it
 * grants nothing beyond editing football winnings.
 */
import type {
  Return,
  Round,
  Season,
  SeasonSummary,
  StandingRow,
  SyncState,
} from '../shared/domain/types'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const TOKEN_KEY = 'fourfold.admin.token'

export interface RoundView extends Round {
  returns: { playerId: string; playerName: string; amountPence: number }[]
  returnRecords: Return[]
}

export interface SeasonView {
  season: Season
  summary: SeasonSummary
  standings: StandingRow[]
  /** Newest round first. */
  rounds: RoundView[]
}

export interface CurrentView extends SeasonView {
  seasons: Season[]
  sync: { lastSuccessAt: string | null; latestRoundId: string | null } | null
}

export interface SeasonListView {
  seasons: Season[]
  currentSeasonId: string | null
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const adminToken = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
}

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  if (options.auth) {
    const token = adminToken.get()
    if (!token) throw new ApiError(401, 'Sign in again')
    headers.authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the FourFold API')
  }

  if (response.status === 401 && options.auth) {
    // The token has expired or been invalidated; make the UI ask again.
    adminToken.clear()
  }

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}

  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ?? `Request failed (${response.status})`
    throw new ApiError(response.status, message)
  }

  return payload as T
}

export const api = {
  getCurrent: () => call<CurrentView>('/current'),
  getSeasons: () => call<SeasonListView>('/seasons'),
  getSeason: (seasonId: string) => call<SeasonView>(`/seasons/${encodeURIComponent(seasonId)}`),

  login: (password: string) => call<{ token: string }>('/admin/login', {
    method: 'POST',
    body: { password },
  }),

  getSyncState: () => call<{ sync: SyncState | null }>('/admin/sync', { auth: true }),

  runSync: () =>
    call<{ result: { ok: boolean; error: string | null; roundsCreated: number; roundsUpdated: number; warnings: string[] }; sync: SyncState | null }>(
      '/admin/sync',
      { method: 'POST', auth: true },
    ),

  createReturn: (input: {
    seasonId: string
    roundId: string
    playerId: string
    amount: string
    note?: string
  }) => call<{ return: Return }>('/admin/returns', { method: 'POST', body: input, auth: true }),

  updateReturn: (returnId: string, input: { seasonId: string; amount: string; note?: string }) =>
    call<{ return: Return }>(`/admin/returns/${encodeURIComponent(returnId)}`, {
      method: 'PUT',
      body: input,
      auth: true,
    }),

  deleteReturn: (returnId: string, seasonId: string) =>
    call<{ deleted: string }>(
      `/admin/returns/${encodeURIComponent(returnId)}?seasonId=${encodeURIComponent(seasonId)}`,
      { method: 'DELETE', auth: true },
    ),
}
