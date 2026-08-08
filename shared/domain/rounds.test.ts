import { describe, expect, it } from 'vitest'
import { currentRoundBadge, currentRoundHeading, pickCurrentRound } from './rounds'
import type { Round } from './types'

const round = (roundNumber: number, status: Round['status']) => ({ roundNumber, status })

describe('pickCurrentRound', () => {
  it('leads with the open round, not the highest-numbered one', () => {
    // The real 2026/27 situation on 8 August: Round 1 open, 2 and 3 announced.
    // Leading with Round 3 put a fixture list three weeks away on the home page.
    const result = pickCurrentRound([
      round(1, 'open'),
      round(2, 'future'),
      round(3, 'future'),
    ])

    expect(result?.round.roundNumber).toBe(1)
    expect(result?.kind).toBe('open')
  })

  it('prefers a round in play over one merely open', () => {
    const result = pickCurrentRound([
      round(1, 'complete'),
      round(2, 'inplay'),
      round(3, 'open'),
    ])

    expect(result?.round.roundNumber).toBe(2)
    expect(result?.kind).toBe('inplay')
  })

  it('shows the most recent result when nothing is live or open', () => {
    const result = pickCurrentRound([
      round(1, 'complete'),
      round(2, 'complete'),
      round(3, 'future'),
    ])

    expect(result?.round.roundNumber).toBe(2)
    expect(result?.kind).toBe('latest-result')
  })

  it('shows the next round up when the season has not started', () => {
    const result = pickCurrentRound([round(2, 'future'), round(3, 'future')])

    expect(result?.round.roundNumber).toBe(2)
    expect(result?.kind).toBe('next')
  })

  it('is order-independent', () => {
    const shuffled = pickCurrentRound([
      round(3, 'future'),
      round(1, 'open'),
      round(2, 'future'),
    ])
    expect(shuffled?.round.roundNumber).toBe(1)
  })

  it('picks the latest of several in-play rounds', () => {
    const result = pickCurrentRound([round(1, 'inplay'), round(2, 'inplay')])
    expect(result?.round.roundNumber).toBe(2)
  })

  it('picks the earliest of several open rounds, which closes first', () => {
    const result = pickCurrentRound([round(4, 'open'), round(3, 'open')])
    expect(result?.round.roundNumber).toBe(3)
  })

  it('treats an unknown status as a played round', () => {
    const result = pickCurrentRound([round(1, 'unknown'), round(2, 'future')])
    expect(result?.round.roundNumber).toBe(1)
    expect(result?.kind).toBe('latest-result')
  })

  it('handles a completed historical season', () => {
    // Imported seasons are all complete; the last round is the final one.
    const result = pickCurrentRound(
      Array.from({ length: 51 }, (_, i) => round(i + 1, 'complete')),
    )
    expect(result?.round.roundNumber).toBe(51)
    expect(result?.kind).toBe('latest-result')
  })

  it('returns undefined with no rounds', () => {
    expect(pickCurrentRound([])).toBeUndefined()
  })
})

describe('labels', () => {
  it('describes each case distinctly', () => {
    const headings = (['inplay', 'open', 'latest-result', 'next'] as const).map(
      currentRoundHeading,
    )
    expect(new Set(headings).size).toBe(4)
    expect(currentRoundHeading('open')).toBe('This round')
    expect(currentRoundHeading('latest-result')).toBe('Latest round')
  })

  it('badges only where it adds something', () => {
    expect(currentRoundBadge('inplay')).toBe('In play')
    expect(currentRoundBadge('open')).toBe('Current round')
    expect(currentRoundBadge('next')).toBe('Next up')
    // "Latest round" is already the heading; a badge repeating it is noise.
    expect(currentRoundBadge('latest-result')).toBeNull()
  })
})
