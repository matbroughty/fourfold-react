/**
 * Money handling for FourFold.
 *
 * Every monetary value in this application is an integer number of pence.
 * Floating point is never used for arithmetic, because `0.1 + 0.2 !== 0.3`
 * and a season total is the sum of ~50 rounds of two-decimal values.
 *
 * Currency is always GBP.
 */

/** The stake for one player in one FourFold round: 5 x £1 fourfolds = £5. */
export const STAKE_PENCE_PER_ROUND = 500

/** Number of fourfold combinations produced by five selections (ABCD..BCDE). */
export const FOURFOLDS_PER_ENTRY = 5

export class MoneyParseError extends Error {
  constructor(input: unknown) {
    super(`Not a valid GBP amount: ${JSON.stringify(input)}`)
    this.name = 'MoneyParseError'
  }
}

/**
 * Parse a human-entered pounds amount into integer pence.
 *
 * Accepts `"18.40"`, `"£18.40"`, `"1,018.40"`, `"18"`, `"18.4"`, `18.4`.
 * Deliberately strict: more than two decimal places, empty strings, and
 * anything non-numeric are rejected rather than silently rounded.
 *
 * Parsing is done on the decimal string rather than via `parseFloat(x) * 100`,
 * which would reintroduce binary rounding error (e.g. `19.99 * 100` is
 * `1998.9999999999998`).
 */
export function parsePoundsToPence(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError(input)
    // Round-trip through a fixed 2dp string so we never multiply a float.
    return parsePoundsToPence(input.toFixed(2))
  }
  if (typeof input !== 'string') throw new MoneyParseError(input)

  const cleaned = input.trim().replace(/^£\s*/, '').trim()
  if (!cleaned) throw new MoneyParseError(input)

  // Thousands separators must be well formed if present: "1,154.38" is fine,
  // "1," and "1,00" are not. Stripping every comma first would accept both.
  const match = /^(-?)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(cleaned)
  if (!match) throw new MoneyParseError(input)

  const [, sign, groupedWhole, frac = ''] = match
  const whole = groupedWhole.replace(/,/g, '')
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(pence)) throw new MoneyParseError(input)
  return sign === '-' ? -pence : pence
}

/**
 * Parse an amount that must be a valid, non-negative return.
 *
 * A "return" is what the bookmaker paid back. It can be zero (recorded
 * explicitly) but never negative — a losing round is simply the absence of a
 * return, and the £5 stake is accounted for separately.
 */
export function parseReturnToPence(input: string | number): number {
  const pence = parsePoundsToPence(input)
  if (pence < 0) throw new MoneyParseError(input)
  return pence
}

/** Format integer pence as a GBP string, e.g. `1840` -> `"£18.40"`. */
export function formatPence(pence: number): string {
  const negative = pence < 0
  const abs = Math.abs(pence)
  const body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return `${negative ? '-' : ''}£${body}`
}

/** Format integer pence with thousands separators, e.g. `115438` -> `"£1,154.38"`. */
export function formatPenceWithSeparators(pence: number): string {
  const negative = pence < 0
  const abs = Math.abs(pence)
  const pounds = Math.floor(abs / 100).toLocaleString('en-GB')
  return `${negative ? '-' : ''}£${pounds}.${String(abs % 100).padStart(2, '0')}`
}

/** Sum integer pence. Present so callers never hand-roll float accumulation. */
export function sumPence(values: readonly number[]): number {
  let total = 0
  for (const v of values) {
    if (!Number.isInteger(v)) throw new MoneyParseError(v)
    total += v
  }
  return total
}

/**
 * Return on investment as a ratio (0.25 means +25%).
 *
 * Returns `null` when no stake has been placed, because ROI is undefined
 * rather than zero — the UI shows a dash instead of "0%".
 */
export function roi(totalReturnPence: number, totalStakePence: number): number | null {
  if (totalStakePence <= 0) return null
  return (totalReturnPence - totalStakePence) / totalStakePence
}

/** Format an ROI ratio as a signed percentage, e.g. `-0.0413` -> `"-4.1%"`. */
export function formatRoi(value: number | null, dp = 1): string {
  if (value === null) return '—'
  const pct = value * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(dp)}%`
}
