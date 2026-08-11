export interface ZonedNow {
  /** Local calendar date as `YYYY-MM-DD`. */
  date: string
  /** Minutes since local midnight, 0-1439. */
  minutesOfDay: number
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Parses `HH:MM` into minutes since midnight. Throws rather than returning NaN. */
export function parseHhMm(value: string): number {
  const match = HH_MM.exec(value)
  if (match === null) {
    throw new Error(`Expected a time in HH:MM form, got: ${JSON.stringify(value)}`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Converts an instant into a wall-clock date and minute-of-day in the given
 * IANA zone. Node 22 ships full ICU, so no timezone library is needed.
 *
 * `hourCycle: 'h23'` matters: with `hour12: false` some locales render midnight
 * as "24", which would make midnight sort after every other time of day.
 */
export function zonedNow(instant: Date, timezone: string): ZonedNow {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value
  }

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  }
}
