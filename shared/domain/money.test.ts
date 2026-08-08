import { describe, expect, it } from 'vitest'
import {
  MoneyParseError,
  STAKE_PENCE_PER_ROUND,
  formatPence,
  formatPenceWithSeparators,
  formatRoi,
  parsePoundsToPence,
  parseReturnToPence,
  roi,
  sumPence,
} from './money'

describe('parsePoundsToPence', () => {
  it('parses the example from the brief without rounding error', () => {
    // £18.40 return on a £5 stake is £13.40 profit, not £13.399999999999999.
    expect(parsePoundsToPence('18.40')).toBe(1840)
    expect(parsePoundsToPence('18.40') - STAKE_PENCE_PER_ROUND).toBe(1340)
  })

  it('accepts pounds signs, thousands separators, and loose spacing', () => {
    expect(parsePoundsToPence('£18.40')).toBe(1840)
    expect(parsePoundsToPence('  £1,154.38 ')).toBe(115438)
    expect(parsePoundsToPence('1,018.40')).toBe(101840)
  })

  it('accepts whole pounds and single decimal places', () => {
    expect(parsePoundsToPence('18')).toBe(1800)
    expect(parsePoundsToPence('18.4')).toBe(1840)
    expect(parsePoundsToPence('0')).toBe(0)
    expect(parsePoundsToPence('0.05')).toBe(5)
  })

  it('parses numbers without multiplying a float', () => {
    // parseFloat('19.99') * 100 is 1998.9999999999998 — we must not do that.
    expect(parsePoundsToPence(19.99)).toBe(1999)
    expect(parsePoundsToPence(0.29)).toBe(29)
    expect(parsePoundsToPence(128.35)).toBe(12835)
  })

  it('rejects junk rather than silently coercing it', () => {
    for (const bad of ['', '   ', 'abc', '1.234', '£', '1.2.3', '1,', '--5', '1e3']) {
      expect(() => parsePoundsToPence(bad), bad).toThrow(MoneyParseError)
    }
    expect(() => parsePoundsToPence(Number.NaN)).toThrow(MoneyParseError)
    expect(() => parsePoundsToPence(Number.POSITIVE_INFINITY)).toThrow(MoneyParseError)
  })

  it('handles negatives, which returns must not use', () => {
    expect(parsePoundsToPence('-5.00')).toBe(-500)
    expect(() => parseReturnToPence('-5.00')).toThrow(MoneyParseError)
    expect(parseReturnToPence('0')).toBe(0)
  })
})

describe('formatPence', () => {
  it('round-trips values from the real historical data', () => {
    for (const value of ['16.84', '128.35', '1154.38', '0.00', '7.04', '61.75']) {
      expect(formatPence(parsePoundsToPence(value))).toBe(`£${Number(value).toFixed(2)}`)
    }
  })

  it('always shows two decimal places', () => {
    expect(formatPence(0)).toBe('£0.00')
    expect(formatPence(5)).toBe('£0.05')
    expect(formatPence(50)).toBe('£0.50')
    expect(formatPence(100)).toBe('£1.00')
  })

  it('formats negative profit', () => {
    expect(formatPence(-2500)).toBe('-£25.00')
  })

  it('adds thousands separators when asked', () => {
    expect(formatPenceWithSeparators(115438)).toBe('£1,154.38')
    expect(formatPenceWithSeparators(210500)).toBe('£2,105.00')
    expect(formatPenceWithSeparators(-115438)).toBe('-£1,154.38')
  })
})

describe('sumPence', () => {
  it('sums exactly across a full season of two-decimal values', () => {
    // The real 2025-26 season: 49 winning entries totalling £1,019.19.
    const amounts = [
      '16.84', '7.04', '12.61', '61.75', '4.81', '34.51', '23.84', '14.68',
      '8.58', '15.19', '128.35', '12.63', '72.16', '9.51', '17.66', '10.73',
      '15.37', '14.73', '14.98', '8.50', '8.50', '45.76', '10.17', '6.28',
      '2.24', '4.85', '46.82', '18.18', '5.71', '34.64', '28.06', '17.99',
      '17.09', '24.57', '7.51', '6.66', '7.51', '5.24', '38.87', '6.64',
      '6.62', '10.94', '10.99', '18.37', '8.53', '44.42', '5.80', '4.93',
      '60.83',
    ].map(parsePoundsToPence)

    expect(amounts).toHaveLength(49)
    expect(sumPence(amounts)).toBe(101919)
    expect(formatPenceWithSeparators(sumPence(amounts))).toBe('£1,019.19')
  })

  it('rejects non-integer input, which would mean a float leaked in', () => {
    expect(() => sumPence([100, 12.5])).toThrow(MoneyParseError)
  })

  it('sums an empty list to zero', () => {
    expect(sumPence([])).toBe(0)
  })
})

describe('roi', () => {
  it('is undefined with no stake rather than zero', () => {
    expect(roi(0, 0)).toBeNull()
    expect(formatRoi(roi(0, 0))).toBe('—')
  })

  it('computes loss and profit correctly', () => {
    // Staked £250 (50 rounds), returned £220.93.
    expect(roi(22093, 25000)).toBeCloseTo(-0.11628, 5)
    expect(formatRoi(roi(22093, 25000))).toBe('-11.6%')

    // Staked £5, returned £18.40.
    expect(roi(1840, 500)).toBe(2.68)
    expect(formatRoi(roi(1840, 500))).toBe('+268.0%')
  })

  it('is exactly zero when returns match the stake', () => {
    expect(roi(500, 500)).toBe(0)
    expect(formatRoi(roi(500, 500))).toBe('0.0%')
  })
})
