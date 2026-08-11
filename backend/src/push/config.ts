import { required } from '../env.js'

export interface PushConfig {
  publicKey: string
  privateKey: string
  /** `mailto:` or `https:` URL identifying the sender, per the VAPID spec. */
  subject: string
  /** How far ahead of `due_at` a deadline alert fires. */
  deadlineLeadMinutes: number
  /** How often the scheduler ticks. Must divide 60. */
  tickMinutes: number
  /** Where a tapped notification opens. */
  appUrl: string
}

const DEFAULT_LEAD_MINUTES = 60
const DEFAULT_TICK_MINUTES = 15

// A cron expression of the form "every N minutes" only behaves that way
// when N divides an hour evenly — otherwise it restarts at the top of the hour.
const VALID_TICKS = new Set([1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30])

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`)
  }
  return value
}

export function loadPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const subject = required(env, 'VAPID_SUBJECT')
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
    throw new Error(`VAPID_SUBJECT must be a mailto: or https: URL, got: ${subject}`)
  }

  const deadlineLeadMinutes = positiveInteger(
    env.DEADLINE_LEAD_MINUTES ?? String(DEFAULT_LEAD_MINUTES),
    'DEADLINE_LEAD_MINUTES',
  )

  const rawTick = env.SCHEDULER_TICK_MINUTES ?? String(DEFAULT_TICK_MINUTES)
  const tickMinutes = Number(rawTick)
  if (!VALID_TICKS.has(tickMinutes)) {
    throw new Error(
      `SCHEDULER_TICK_MINUTES must divide 60 evenly (one of ${[...VALID_TICKS].join(', ')}), got: ${rawTick}`,
    )
  }

  return {
    publicKey: required(env, 'VAPID_PUBLIC_KEY'),
    privateKey: required(env, 'VAPID_PRIVATE_KEY'),
    subject,
    deadlineLeadMinutes,
    tickMinutes,
    appUrl: required(env, 'APP_URL'),
  }
}

export const pushConfig = loadPushConfig()
