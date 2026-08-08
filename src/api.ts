/**
 * FourFold API client.
 *
 * The admin token is kept in localStorage. That is a deliberate, proportionate
 * choice: this is a private hobby site, the token expires in 12 hours, and it
 * grants nothing beyond editing football winnings.
 */
import type { CurrentRoundKind } from '../shared/domain/rounds'
import type {
  Return,
  Round,
  Season,
  SeasonSummary,
  StandingRow,
  SyncState,
} from '../shared/domain/types'

/**
 * Where the API lives.
 *
 * Resolved at build time, in order:
 *
 *  1. `VITE_API_BASE_URL`, if set — an explicit override always wins.
 *  2. `amplify_outputs.json`, which Amplify's backend phase writes (including
 *     our `custom.apiBaseUrl`) *before* the frontend build runs. This is why no
 *     environment variable needs setting by hand: the Function URL is not known
 *     until the backend deploys, and this closes that loop automatically.
 *  3. Empty — meaning same-origin `/api`, which is what the Vite dev proxy serves.
 *
 * `import.meta.glob` is used rather than a plain import because
 * `amplify_outputs.json` is gitignored and absent locally; a static import would
 * fail the build. With no match, glob returns `{}`.
 */
const amplifyOutputs = Object.values(
  import.meta.glob<{ custom?: { apiBaseUrl?: string } }>('../amplify_outputs.json', {
    eager: true,
  }),
)[0]

const BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ??
  amplifyOutputs?.custom?.apiBaseUrl ??
  ''
).replace(/\/$/, '')

const TOKEN_KEY = 'fourfold.admin.token'

export interface RoundView extends Round {
  returns: { playerId: string; playerName: string; amountPence: number }[]
  returnRecords: Return[]
}

export interface SeasonView {
  season: Season
  summary: SeasonSummary
  standings: StandingRow[]
  /** The round the competition is on — not necessarily the highest-numbered. */
  currentRoundId: string | null
  currentRoundKind: CurrentRoundKind | null
  /** Newest round first. */
  rounds: RoundView[]
}

export interface SeasonWinner {
  playerId: string
  playerName: string
  totalReturnPence: number
}

/** A season in the list, with its result. */
export interface SeasonListEntry extends Season {
  summary: SeasonSummary | null
  /** Null when the season has produced no returns yet. */
  winner: SeasonWinner | null
}

export interface CurrentView extends SeasonView {
  seasons: Season[]
  sync: { lastSuccessAt: string | null; latestRoundId: string | null } | null
}

export interface SeasonListView {
  seasons: SeasonListEntry[]
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
