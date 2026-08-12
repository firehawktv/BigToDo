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

  const expression = `*/${pushConfig().tickMinutes} * * * *`
  logger.info({ expression }, 'starting scheduler')

  // The callback must RETURN the promise it awaits — node-cron's `noOverlap`
  // tracks in-flight executions via the returned promise, so an
  // async-but-detached callback (`void (async () => {...})()`, which returns
  // `undefined` synchronously) would make `noOverlap` a no-op and let ticks
  // that overrun `tickMinutes` stack up, double-sending alerts and check-ins.
  task = cron.schedule(
    expression,
    async () => {
      try {
        await runDeadlineSweep({ logger })
        await runCheckInSweep({ logger })
      } catch (error) {
        logger.warn({ err: error }, 'scheduler tick failed')
      }
    },
    { noOverlap: true },
  )
}

export async function stopScheduler(): Promise<void> {
  await task?.stop()
  task = undefined
}
