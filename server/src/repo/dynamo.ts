/**
 * DynamoDB repository — single table, on-demand billing.
 *
 * Key design
 * ----------
 *   Season         PK = "SEASON"            SK = "SEASON#2026-27"
 *   Round          PK = "SEASON#2026-27"    SK = "ROUND#0001"
 *   Return         PK = "SEASON#2026-27"    SK = "RETURN#<returnId>"
 *   Participation  PK = "SEASON#2026-27"    SK = "PART#0001#mat"
 *   Sync state     PK = "SYNC"              SK = "STATE"
 *
 * Everything belonging to a season lives in one partition, so rendering a
 * season is a single Query rather than several. All seasons share the "SEASON"
 * partition so the season list is also one Query. At this size (five seasons,
 * ~250 rounds, a few hundred returns) the whole dataset is a few hundred KB and
 * comfortably inside the free tier.
 *
 * Returns are keyed on their own id rather than on round+player, because there
 * may legitimately be several for one player in one round and each must be
 * editable and deletable on its own.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import type {
  Participation,
  Return,
  Round,
  Season,
  SyncState,
} from '../../../shared/domain/types'
import type { FourFoldRepository, SeasonBundle } from './types'

const SEASON_INDEX_PK = 'SEASON'
const SYNC_PK = 'SYNC'
const SYNC_SK = 'STATE'

type ItemType = 'season' | 'round' | 'return' | 'participation' | 'sync'

interface StoredItem extends Record<string, unknown> {
  PK: string
  SK: string
  type: ItemType
}

const seasonPk = (seasonId: string) => `SEASON#${seasonId}`
const seasonSk = (seasonId: string) => `SEASON#${seasonId}`
/** Zero-padded so that lexical sort order equals numeric round order. */
const roundSk = (roundNumber: number) => `ROUND#${String(roundNumber).padStart(4, '0')}`
const returnSk = (returnId: string) => `RETURN#${returnId}`
const participationSk = (roundNumber: number, playerId: string) =>
  `PART#${String(roundNumber).padStart(4, '0')}#${playerId}`

/**
 * Split our composite round id back into its parts.
 * `"2026-27:12"` -> `{ seasonId: "2026-27", roundNumber: 12 }`
 */
export function parseRoundId(roundId: string): { seasonId: string; roundNumber: number } {
  const index = roundId.lastIndexOf(':')
  if (index <= 0) throw new Error(`Malformed round id: ${roundId}`)
  const seasonId = roundId.slice(0, index)
  const roundNumber = Number.parseInt(roundId.slice(index + 1), 10)
  if (!Number.isInteger(roundNumber)) throw new Error(`Malformed round id: ${roundId}`)
  return { seasonId, roundNumber }
}

/** Strip the storage keys, leaving the domain object. */
function unwrap<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, type: _type, ...rest } = item
  return rest as T
}

export interface DynamoRepositoryOptions {
  tableName: string
  client?: DynamoDBDocumentClient
}

export class DynamoRepository implements FourFoldRepository {
  private readonly doc: DynamoDBDocumentClient
  private readonly tableName: string

  constructor(options: DynamoRepositoryOptions) {
    this.tableName = options.tableName
    this.doc =
      options.client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      })
  }

  private async put(item: StoredItem): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }))
  }

  private async queryPartition(pk: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = []
    let exclusiveStartKey: Record<string, unknown> | undefined

    // Paginate: a long season plus its returns could exceed DynamoDB's 1MB page.
    do {
      const response = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'PK' },
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      )
      items.push(...(response.Items ?? []))
      exclusiveStartKey = response.LastEvaluatedKey
    } while (exclusiveStartKey)

    return items
  }

  async listSeasons(): Promise<Season[]> {
    const items = await this.queryPartition(SEASON_INDEX_PK)
    return items
      .map((item) => unwrap<Season>(item))
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  async getSeason(seasonId: string): Promise<Season | undefined> {
    const response = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: SEASON_INDEX_PK, SK: seasonSk(seasonId) },
      }),
    )
    return response.Item ? unwrap<Season>(response.Item) : undefined
  }

  async putSeason(season: Season): Promise<void> {
    await this.put({
      PK: SEASON_INDEX_PK,
      SK: seasonSk(season.id),
      type: 'season',
      ...season,
    })
  }

  async getSeasonBundle(seasonId: string): Promise<SeasonBundle | undefined> {
    const season = await this.getSeason(seasonId)
    if (!season) return undefined

    const items = await this.queryPartition(seasonPk(seasonId))
    const rounds: Round[] = []
    const returns: Return[] = []
    const participation: Participation[] = []

    for (const item of items) {
      switch (item.type) {
        case 'round':
          rounds.push(unwrap<Round>(item))
          break
        case 'return':
          returns.push(unwrap<Return>(item))
          break
        case 'participation':
          participation.push(unwrap<Participation>(item))
          break
        default:
          // Unknown item types are ignored rather than fatal, so a future
          // record type cannot break the public site.
          break
      }
    }

    rounds.sort((a, b) => a.roundNumber - b.roundNumber)
    return { season, rounds, returns, participation }
  }

  async getRound(roundId: string): Promise<Round | undefined> {
    const { seasonId, roundNumber } = parseRoundId(roundId)
    const response = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: seasonPk(seasonId), SK: roundSk(roundNumber) },
      }),
    )
    return response.Item ? unwrap<Round>(response.Item) : undefined
  }

  async putRound(round: Round): Promise<void> {
    await this.put({
      PK: seasonPk(round.seasonId),
      SK: roundSk(round.roundNumber),
      type: 'round',
      ...round,
    })
  }

  async getReturn(seasonId: string, returnId: string): Promise<Return | undefined> {
    const response = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: seasonPk(seasonId), SK: returnSk(returnId) },
      }),
    )
    return response.Item ? unwrap<Return>(response.Item) : undefined
  }

  async putReturn(value: Return): Promise<void> {
    await this.put({
      PK: seasonPk(value.seasonId),
      SK: returnSk(value.id),
      type: 'return',
      ...value,
    })
  }

  async deleteReturn(seasonId: string, returnId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: seasonPk(seasonId), SK: returnSk(returnId) },
      }),
    )
  }

  async putParticipation(value: Participation): Promise<void> {
    const { roundNumber } = parseRoundId(value.roundId)
    await this.put({
      PK: seasonPk(value.seasonId),
      SK: participationSk(roundNumber, value.playerId),
      type: 'participation',
      ...value,
    })
  }

  async getSyncState(): Promise<SyncState | undefined> {
    const response = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: SYNC_PK, SK: SYNC_SK } }),
    )
    return response.Item ? unwrap<SyncState>(response.Item) : undefined
  }

  async putSyncState(state: SyncState): Promise<void> {
    await this.put({ PK: SYNC_PK, SK: SYNC_SK, type: 'sync', ...state })
  }
}
