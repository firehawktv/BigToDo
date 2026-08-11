import type { Static } from '@sinclair/typebox'
import { TaskSchema } from '../schemas/task.js'
import { CaptureBatchSchema } from '../schemas/captureBatch.js'
import type { Task } from '../repositories/tasks.js'
import type { CaptureBatch } from '../repositories/captureBatches.js'

/**
 * Converts a repository `Task` (timestamps as `Date | null` / `Date`) into the
 * wire shape `TaskSchema` declares (timestamps as ISO strings). This is a real
 * conversion, not a cast — it is what actually produces the ISO strings the
 * response carries, independent of any serializer behavior.
 */
export type TaskResponse = Static<typeof TaskSchema>
export function toTaskResponse(task: Task): TaskResponse {
  return {
    ...task,
    dueAt: task.dueAt?.toISOString() ?? null,
    alertedAt: task.alertedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  }
}

export type CaptureBatchResponse = Static<typeof CaptureBatchSchema>
export function toCaptureBatchResponse(batch: CaptureBatch): CaptureBatchResponse {
  return {
    ...batch,
    createdAt: batch.createdAt.toISOString(),
  }
}
