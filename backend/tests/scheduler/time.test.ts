import { describe, expect, it } from 'vitest'
import { parseHhMm, zonedNow } from '../../src/scheduler/time.js'

describe('parseHhMm', () => {
  it.each([
    ['00:00', 0],
    ['09:00', 540],
    ['09:30', 570],
    ['18:00', 1080],
    ['23:59', 1439],
  ])('parses %s as %i minutes', (value, expected) => {
    expect(parseHhMm(value)).toBe(expected)
  })

  it('throws on a malformed value rather than returning NaN', () => {
    for (const value of ['9:00', 'noon', '25:00', '12:60', '']) {
      expect(() => parseHhMm(value), value).toThrow(/HH:MM/)
    }
  })
})

describe('zonedNow', () => {
  it('reports UTC unchanged', () => {
    const result = zonedNow(new Date('2026-08-11T14:30:00.000Z'), 'UTC')

    expect(result.date).toBe('2026-08-11')
    expect(result.minutesOfDay).toBe(14 * 60 + 30)
  })

  it('shifts into a zone ahead of UTC', () => {
    // 22:30 UTC is 07:30 the NEXT day in Tokyo (UTC+9).
    const result = zonedNow(new Date('2026-08-11T22:30:00.000Z'), 'Asia/Tokyo')

    expect(result.date).toBe('2026-08-12')
    expect(result.minutesOfDay).toBe(7 * 60 + 30)
  })

  it('shifts into a zone behind UTC', () => {
    // 02:30 UTC is 22:30 the PREVIOUS day in New York (UTC-4 in August).
    const result = zonedNow(new Date('2026-08-11T02:30:00.000Z'), 'America/New_York')

    expect(result.date).toBe('2026-08-10')
    expect(result.minutesOfDay).toBe(22 * 60 + 30)
  })

  it('honours daylight saving', () => {
    // London is UTC+1 in August, UTC+0 in January.
    expect(zonedNow(new Date('2026-08-11T12:00:00.000Z'), 'Europe/London').minutesOfDay).toBe(13 * 60)
    expect(zonedNow(new Date('2026-01-11T12:00:00.000Z'), 'Europe/London').minutesOfDay).toBe(12 * 60)
  })

  it('reports midnight as 0, not 1440', () => {
    // A naive hour12:false formatter renders midnight as "24" in some locales.
    expect(zonedNow(new Date('2026-08-11T00:00:00.000Z'), 'UTC').minutesOfDay).toBe(0)
  })

  it('throws on an unknown timezone rather than silently using UTC', () => {
    expect(() => zonedNow(new Date(), 'Mars/Olympus_Mons')).toThrow()
  })
})
