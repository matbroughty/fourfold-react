/**
 * Season standings.
 *
 * The competition is ranked on TOTAL RETURNS, highest first. This is the rule
 * the competition has always used (the previous static site and the React
 * staging app both ordered by total winnings descending), so it is preserved
 * deliberately. Profit, stake and ROI are shown alongside but do not affect
 * the ordering.
 */
import { STAKE_PENCE_PER_ROUND, roi, sumPence } from './money'
import { playerName } from './players'
import type {
  Participation,
  Return,
  Round,
  SeasonSummary,
  StandingRow,
} from './types'

export interface StandingsInput {
  seasonId: string
  seasonName: string
  /** Players in the season's roster. */
  playerIds: readonly string[]
  /** All rounds in the season. Determines how many stakes each player has laid. */
  rounds: readonly Pick<Round, 'id'>[]
  /** Every return record in the season. Multiple per player/round is allowed. */
  returns: readonly Return[]
  /**
   * Exceptions to "everyone plays every round". Absent entries mean the player
   * played. Only records with `participated: false` reduce a player's stake.
   */
  participation?: readonly Participation[]
}

/**
 * Aggregate returns to a single total per player/round.
 *
 * Several return records may exist for one player in one round (a correction,
 * or two separate payouts). They sum.
 */
export function aggregateReturns(
  returns: readonly Return[],
): Map<string, Map<string, number>> {
  const byPlayer = new Map<string, Map<string, number>>()
  for (const r of returns) {
    let byRound = byPlayer.get(r.playerId)
    if (!byRound) {
      byRound = new Map<string, number>()
      byPlayer.set(r.playerId, byRound)
    }
    byRound.set(r.roundId, (byRound.get(r.roundId) ?? 0) + r.amountPence)
  }
  return byPlayer
}

function skippedRoundsByPlayer(
  participation: readonly Participation[],
): Map<string, Set<string>> {
  const skipped = new Map<string, Set<string>>()
  for (const p of participation) {
    if (p.participated) continue
    let set = skipped.get(p.playerId)
    if (!set) {
      set = new Set<string>()
      skipped.set(p.playerId, set)
    }
    set.add(p.roundId)
  }
  return skipped
}

/**
 * Build the season table.
 *
 * Every player in the roster appears, even with no returns at all — a player on
 * zero is still £5 a round down and should be visible in the table.
 */
export function calculateStandings(input: StandingsInput): StandingRow[] {
  const aggregated = aggregateReturns(input.returns)
  const skipped = skippedRoundsByPlayer(input.participation ?? [])
  const roundIds = input.rounds.map((r) => r.id)

  const rows: Omit<StandingRow, 'position'>[] = input.playerIds.map((playerId) => {
    const byRound = aggregated.get(playerId) ?? new Map<string, number>()
    const playerSkipped = skipped.get(playerId) ?? new Set<string>()

    const roundsPlayed = roundIds.filter((id) => !playerSkipped.has(id)).length

    // Only count returns against rounds that exist in this season.
    const amounts: number[] = []
    let winningRounds = 0
    for (const id of roundIds) {
      const amount = byRound.get(id)
      if (amount === undefined) continue
      amounts.push(amount)
      if (amount > 0) winningRounds += 1
    }

    const totalReturnPence = sumPence(amounts)
    const totalStakePence = roundsPlayed * STAKE_PENCE_PER_ROUND

    return {
      playerId,
      playerName: playerName(playerId),
      totalReturnPence,
      totalStakePence,
      profitPence: totalReturnPence - totalStakePence,
      roi: roi(totalReturnPence, totalStakePence),
      winningRounds,
      roundsPlayed,
    }
  })

  // Rank on total returns. Ties break on fewer stakes laid (better value), then
  // name, so the order is stable rather than dependent on roster order.
  rows.sort((a, b) => {
    if (b.totalReturnPence !== a.totalReturnPence) {
      return b.totalReturnPence - a.totalReturnPence
    }
    if (a.totalStakePence !== b.totalStakePence) {
      return a.totalStakePence - b.totalStakePence
    }
    return a.playerName.localeCompare(b.playerName)
  })

  // Equal returns share a position (1, 2, 2, 4).
  let lastReturn: number | null = null
  let lastPosition = 0
  return rows.map((row, index) => {
    const position =
      lastReturn !== null && row.totalReturnPence === lastReturn
        ? lastPosition
        : index + 1
    lastReturn = row.totalReturnPence
    lastPosition = position
    return { position, ...row }
  })
}

/** Season-level totals for the header strip. */
export function calculateSeasonSummary(input: StandingsInput): SeasonSummary {
  const standings = calculateStandings(input)
  const roundIds = new Set(input.rounds.map((r) => r.id))

  // Count player-rounds that produced a return, matching the "Total Wins"
  // figure the old site displayed.
  const aggregated = aggregateReturns(input.returns)
  let winningEntries = 0
  for (const byRound of aggregated.values()) {
    for (const [roundId, amount] of byRound) {
      if (roundIds.has(roundId) && amount > 0) winningEntries += 1
    }
  }

  return {
    seasonId: input.seasonId,
    seasonName: input.seasonName,
    roundCount: input.rounds.length,
    totalReturnPence: sumPence(standings.map((r) => r.totalReturnPence)),
    totalStakePence: sumPence(standings.map((r) => r.totalStakePence)),
    profitPence: sumPence(standings.map((r) => r.profitPence)),
    winningEntries,
  }
}

/** Returns for one round, aggregated per player and ordered highest first. */
export function returnsForRound(
  returns: readonly Return[],
  roundId: string,
): { playerId: string; playerName: string; amountPence: number }[] {
  const totals = new Map<string, number>()
  for (const r of returns) {
    if (r.roundId !== roundId) continue
    totals.set(r.playerId, (totals.get(r.playerId) ?? 0) + r.amountPence)
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([playerId, amountPence]) => ({
      playerId,
      playerName: playerName(playerId),
      amountPence,
    }))
    .sort((a, b) => b.amountPence - a.amountPence || a.playerName.localeCompare(b.playerName))
}
