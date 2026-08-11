import cron, { type ScheduledTask } from 'node-cron'
import { pushConfig } from '../push/config.js'
import { runDeadlineSweep } from './deadlines.js'
import { runCheckInSweep } from './checkIns.js'
import type { Logger } from '../logger.js'

let task: ScheduledTask | undefined

/**
 * Starts the in-process scheduler.
 *
 * Called from server.ts, NOT from buildApp() — a cron tick firing inside the
 * test suite would make tests non-deterministic and could send real pushes.
 *
 * Each tick runs both sweeps. Neither throws by contract, but the whole tick is
 * wrapped anyway: an exception escaping here would kill the cron job for the
 * life of the process.
 */
export function startScheduler(logger: Logger): void {
  if (task !== undefined) return

  const expression = `*/${pushConfig.tickMinutes} * * * *`
  logger.info({ expression }, 'starting scheduler')

  task = cron.schedule(expression, () => {
    void (async () => {
      try {
        await runDeadlineSweep({ logger })
        await runCheckInSweep({ logger })
      } catch (error) {
        logger.warn({ err: error }, 'scheduler tick failed')
      }
    })()
  })
}

export function stopScheduler(): void {
  task?.stop()
  task = undefined
}
