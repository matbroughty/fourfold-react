/**
 * In-memory repository.
 *
 * Used by the tests and by `npm run dev` when no table is configured. Behaves
 * like the DynamoDB implementation for everything the application relies on,
 * including returning copies so callers cannot mutate stored state by accident.
 */
import type {
  Participation,
  Return,
  Round,
  Season,
  SyncState,
} from '../../../shared/domain/types'
import type { FourFoldRepository, SeasonBundle } from './types'

const clone = <T>(value: T): T => structuredClone(value)

export class InMemoryRepository implements FourFoldRepository {
  private seasons = new Map<string, Season>()
  private rounds = new Map<string, Round>()
  private returns = new Map<string, Return>()
  private participation = new Map<string, Participation>()
  private syncState: SyncState | undefined

  /** Counts every write, so tests can assert that a no-op sync writes nothing. */
  writeCount = 0

  async listSeasons(): Promise<Season[]> {
    // Newest first, matching the DynamoDB read order.
    return [...this.seasons.values()]
      .map(clone)
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  async getSeason(seasonId: string): Promise<Season | undefined> {
    const season = this.seasons.get(seasonId)
    return season ? clone(season) : undefined
  }

  async putSeason(season: Season): Promise<void> {
    this.writeCount += 1
    this.seasons.set(season.id, clone(season))
  }

  async getSeasonBundle(seasonId: string): Promise<SeasonBundle | undefined> {
    const season = this.seasons.get(seasonId)
    if (!season) return undefined

    return {
      season: clone(season),
      rounds: [...this.rounds.values()]
        .filter((r) => r.seasonId === seasonId)
        .map(clone)
        .sort((a, b) => a.roundNumber - b.roundNumber),
      returns: [...this.returns.values()]
        .filter((r) => r.seasonId === seasonId)
        .map(clone),
      participation: [...this.participation.values()]
        .filter((p) => p.seasonId === seasonId)
        .map(clone),
    }
  }

  async getRound(roundId: string): Promise<Round | undefined> {
    const round = this.rounds.get(roundId)
    return round ? clone(round) : undefined
  }

  async putRound(round: Round): Promise<void> {
    this.writeCount += 1
    this.rounds.set(round.id, clone(round))
  }

  async getReturn(seasonId: string, returnId: string): Promise<Return | undefined> {
    const value = this.returns.get(returnId)
    if (!value || value.seasonId !== seasonId) return undefined
    return clone(value)
  }

  async putReturn(value: Return): Promise<void> {
    this.writeCount += 1
    this.returns.set(value.id, clone(value))
  }

  async deleteReturn(seasonId: string, returnId: string): Promise<void> {
    const existing = this.returns.get(returnId)
    if (existing && existing.seasonId === seasonId) {
      this.writeCount += 1
      this.returns.delete(returnId)
    }
  }

  async putParticipation(value: Participation): Promise<void> {
    this.writeCount += 1
    this.participation.set(`${value.roundId}#${value.playerId}`, clone(value))
  }

  async getSyncState(): Promise<SyncState | undefined> {
    return this.syncState ? clone(this.syncState) : undefined
  }

  async putSyncState(state: SyncState): Promise<void> {
    this.writeCount += 1
    this.syncState = clone(state)
  }

  /** Test helper: every round currently stored, in season then round order. */
  allRounds(): Round[] {
    return [...this.rounds.values()]
      .map(clone)
      .sort((a, b) => a.seasonId.localeCompare(b.seasonId) || a.roundNumber - b.roundNumber)
  }

  /** Test helper: every return currently stored. */
  allReturns(): Return[] {
    return [...this.returns.values()].map(clone)
  }
}
