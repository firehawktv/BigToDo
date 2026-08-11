import { listTasksDueForAlert, updateTask, type Task } from '../repositories/tasks.js'
import { sendToAllSubscriptions } from '../push/send.js'
import { pushConfig } from '../push/config.js'
import type { Logger } from '../logger.js'

/** A sweep sends at most this many alerts per tick, so a backlog can't stampede. */
const MAX_ALERTS_PER_SWEEP = 20

export interface DeadlineSweepOptions {
  logger?: Logger
  now?: Date
}

function alertBody(task: Task, now: Date): string {
  if (task.dueAt === null) return task.title
  const overdue = task.dueAt.getTime() < now.getTime()
  return overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`
}

/**
 * Finds open tasks approaching their deadline, sends one notification each, and
 * stamps `alerted_at` so they never fire again.
 *
 * `alerted_at` is only stamped once the notification was actually delivered to
 * at least one device (`result.sent > 0`). A task left un-alerted because
 * nobody was subscribed yet is left for the next tick too — re-checking is one
 * indexed query per tick against the existing partial index, and it stops the
 * moment a device subscribes. Stamping on a device-less send would otherwise
 * permanently consume the one alert this task will ever get.
 *
 * Never throws; the caller is a cron tick.
 */
export async function runDeadlineSweep(
  options: DeadlineSweepOptions = {},
): Promise<{ alerted: number }> {
  const now = options.now ?? new Date()
  let alerted = 0

  try {
    const due = await listTasksDueForAlert(pushConfig.deadlineLeadMinutes, MAX_ALERTS_PER_SWEEP)

    for (const task of due) {
      try {
        const result = await sendToAllSubscriptions(
          {
            title: 'ToDo',
            body: alertBody(task, now),
            url: pushConfig.appUrl,
          },
          options.logger,
        )

        if (result.sent === 0) {
          options.logger?.warn({ taskId: task.id }, 'deadline alert not delivered; will retry')
          continue
        }

        await updateTask(task.id, { alertedAt: now })
        alerted += 1
      } catch (error) {
        options.logger?.warn({ err: error, taskId: task.id }, 'deadline alert failed')
      }
    }

    if (alerted > 0) {
      options.logger?.info({ alerted }, 'deadline alerts sent')
    }
  } catch (error) {
    options.logger?.warn({ err: error }, 'deadline sweep failed')
  }

  return { alerted }
}
