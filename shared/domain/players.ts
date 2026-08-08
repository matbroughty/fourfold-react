/**
 * The FourFold players.
 *
 * There are seven of us and the list changes roughly once every few years, so
 * players are configuration rather than database rows with a registration flow.
 * Adding a player means editing this file and redeploying.
 *
 * Player ids are stable slugs. The display names match the column headers used
 * in the historical CSVs, which is how the migration maps old data onto these
 * ids — do not rename `name` without updating `CSV_HEADER_TO_PLAYER_ID`.
 */
import type { Player } from './types'

export const PLAYERS: readonly Player[] = [
  { id: 'dan', name: 'Dan' },
  { id: 'mat', name: 'Mat' },
  { id: 'paul-s', name: 'Paul S' },
  { id: 'paul-v', name: 'Paul V' },
  { id: 'frank', name: 'Frank' },
  { id: 'jase', name: 'Jase' },
  { id: 'ash', name: 'Ash' },
  // Played in 2020-21 only. Retained so that season's history still resolves.
  { id: 'taz', name: 'Taz' },
]

/** The roster for the current era (2022-23 onwards). */
export const CURRENT_PLAYER_IDS: readonly string[] = [
  'dan',
  'mat',
  'paul-s',
  'paul-v',
  'frank',
  'jase',
  'ash',
]

const BY_ID = new Map(PLAYERS.map((p) => [p.id, p]))

export function getPlayer(id: string): Player | undefined {
  return BY_ID.get(id)
}

export function playerName(id: string): string {
  return BY_ID.get(id)?.name ?? id
}

export function isKnownPlayer(id: string): boolean {
  return BY_ID.has(id)
}

/**
 * Maps a historical CSV column header to a player id.
 *
 * The 2020-21 file uses a different roster (including Taz, and no Frank, Jase
 * or Ash) and has stray leading spaces in its header row, so lookups are done
 * on a trimmed, lowercased key.
 */
export const CSV_HEADER_TO_PLAYER_ID: Readonly<Record<string, string>> = {
  dan: 'dan',
  mat: 'mat',
  'paul s': 'paul-s',
  'paul v': 'paul-v',
  frank: 'frank',
  jase: 'jase',
  ash: 'ash',
  taz: 'taz',
}

export function playerIdFromCsvHeader(header: string): string | undefined {
  return CSV_HEADER_TO_PLAYER_ID[header.trim().toLowerCase()]
}
