import { parseHhMm, zonedNow } from './time.js'
import {
  countCheckInsOnLocalDate,
  getCheckInSettings,
  recordCheckIn,
  type CheckInSettings,
} from '../repositories/checkInSettings.js'
import { sendToAllSubscriptions } from '../push/send.js'
import { pushConfig } from '../push/config.js'
import type { Logger } from '../logger.js'

export interface ShouldSendCheckInInput {
  now: Date
  settings: CheckInSettings
  sentToday: number
  tickMinutes: number
  random: () => number
}

/**
 * Decides whether THIS tick should be one of today's randomized check-ins.
 *
 * Rather than picking times up front, each tick computes the probability that
 * it should fire: `owed / ticksRemaining`. That spreads the day's check-ins
 * uniformly at random across the window, needs no schedule table, survives a
 * restart, and converges — when ticks run out the probability reaches 1, so the
 * remaining check-ins fire rather than being lost.
 *
 * Pure: no clock, no database, no global RNG. That is what makes the whole
 * schedule testable.
 */
export function shouldSendCheckIn(input: ShouldSendCheckInInput): boolean {
  const { now, settings, sentToday, tickMinutes, random } = input

  if (!settings.enabled) return false

  const owed = settings.checkInsPerDay - sentToday
  if (owed <= 0) return false

  const { minutesOfDay } = zonedNow(now, settings.timezone)
  const from = parseHhMm(settings.activeFrom)
  const to = parseHhMm(settings.activeTo)

  if (minutesOfDay < from || minutesOfDay >= to) return false

  const ticksRemaining = Math.ceil((to - minutesOfDay) / tickMinutes)
  if (ticksRemaining <= 0) return false

  return random() < owed / ticksRemaining
}

export interface CheckInSweepOptions {
  logger?: Logger
  now?: Date
  random?: () => number
}

const CHECK_IN_BODY = "How's it going? Anything on your mind?"

/**
 * Runs one check-in decision and, if it fires, sends and records the check-in.
 *
 * The check-in is only recorded when delivery did not outright fail, so a
 * failed send does not consume the day's quota.
 *
 * Never throws; the caller is a cron tick.
 */
export async function runCheckInSweep(
  options: CheckInSweepOptions = {},
): Promise<{ sent: boolean }> {
  const now = options.now ?? new Date()
  const random = options.random ?? Math.random

  try {
    const settings = await getCheckInSettings()
    const { date } = zonedNow(now, settings.timezone)
    const sentToday = await countCheckInsOnLocalDate(date, settings.timezone)

    if (!shouldSendCheckIn({ now, settings, sentToday, tickMinutes: pushConfig.tickMinutes, random })) {
      return { sent: false }
    }

    const result = await sendToAllSubscriptions(
      { title: 'ToDo', body: CHECK_IN_BODY, url: pushConfig.appUrl },
      options.logger,
    )

    if (result.failed > 0 && result.sent === 0) {
      options.logger?.warn({}, 'check-in not delivered; quota not consumed')
      return { sent: false }
    }

    await recordCheckIn()
    options.logger?.info({ sentToday: sentToday + 1 }, 'check-in sent')
    return { sent: true }
  } catch (error) {
    options.logger?.warn({ err: error }, 'check-in sweep failed')
    return { sent: false }
  }
}
