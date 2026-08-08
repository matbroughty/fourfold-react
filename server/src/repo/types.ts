/**
 * Storage interface for FourFold.
 *
 * Two implementations exist: DynamoDB (production) and in-memory (tests). The
 * domain logic and HTTP handler only ever see this interface, so the tests run
 * with no AWS credentials and no network.
 */
import type {
  Participation,
  Return,
  Round,
  Season,
  SyncState,
} from '../../../shared/domain/types'

/** Everything needed to render one season, fetched in a single query. */
export interface SeasonBundle {
  season: Season
  rounds: Round[]
  returns: Return[]
  participation: Participation[]
}

export interface FourFoldRepository {
  listSeasons(): Promise<Season[]>
  getSeason(seasonId: string): Promise<Season | undefined>
  putSeason(season: Season): Promise<void>

  /**
   * All rounds, returns and participation for a season.
   *
   * A single partition holds all of these, so this is one DynamoDB query rather
   * than four — which matters because it is the hot path for every page.
   */
  getSeasonBundle(seasonId: string): Promise<SeasonBundle | undefined>

  getRound(roundId: string): Promise<Round | undefined>
  putRound(round: Round): Promise<void>

  getReturn(seasonId: string, returnId: string): Promise<Return | undefined>
  putReturn(value: Return): Promise<void>
  deleteReturn(seasonId: string, returnId: string): Promise<void>

  putParticipation(value: Participation): Promise<void>

  getSyncState(): Promise<SyncState | undefined>
  putSyncState(state: SyncState): Promise<void>
}
