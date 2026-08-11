import { pool } from '../db/pool.js'
import type { Pool, PoolClient } from 'pg'
import type { TaskPriorityValue, TaskSourceValue, TaskStatusValue } from '../schemas/task.js'

export interface Task {
  id: string
  title: string
  notes: string | null
  status: TaskStatusValue
  priority: TaskPriorityValue
  dueAt: Date | null
  estimatedMinutes: number | null
  parentTaskId: string | null
  captureBatchId: string | null
  source: TaskSourceValue
  suggestBreakdown: boolean
  alertedAt: Date | null
  createdAt: Date
  completedAt: Date | null
}

interface TaskRow {
  id: string
  title: string
  notes: string | null
  status: TaskStatusValue
  priority: TaskPriorityValue
  due_at: Date | null
  estimated_minutes: number | null
  parent_task_id: string | null
  capture_batch_id: string | null
  source: TaskSourceValue
  suggest_breakdown: boolean
  alerted_at: Date | null
  created_at: Date
  completed_at: Date | null
}

const COLUMNS = `
  id, title, notes, status, priority, due_at, estimated_minutes,
  parent_task_id, capture_batch_id, source, suggest_breakdown, alerted_at,
  created_at, completed_at
`

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    estimatedMinutes: row.estimated_minutes,
    parentTaskId: row.parent_task_id,
    captureBatchId: row.capture_batch_id,
    source: row.source,
    suggestBreakdown: row.suggest_breakdown,
    alertedAt: row.alerted_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export interface CreateTaskInput {
  title: string
  notes?: string | null
  priority?: TaskPriorityValue
  dueAt?: Date | string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
  captureBatchId?: string | null
  source?: TaskSourceValue
  suggestBreakdown?: boolean
}

/** Inserts one task row via whichever connection (pool or an in-transaction client) is given. */
async function insertOne(queryable: Pool | PoolClient, input: CreateTaskInput): Promise<Task> {
  const { rows } = await queryable.query<TaskRow>(
    `INSERT INTO tasks
       (title, notes, priority, due_at, estimated_minutes,
        parent_task_id, capture_batch_id, source, suggest_breakdown)
     VALUES
       ($1, $2, COALESCE($3::task_priority, 'medium'), $4, $5,
        $6, $7, COALESCE($8::task_source, 'manual'), COALESCE($9, false))
     RETURNING ${COLUMNS}`,
    [
      input.title,
      input.notes ?? null,
      input.priority ?? null,
      input.dueAt ?? null,
      input.estimatedMinutes ?? null,
      input.parentTaskId ?? null,
      input.captureBatchId ?? null,
      input.source ?? null,
      input.suggestBreakdown ?? null,
    ],
  )
  return mapRow(rows[0]!)
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return insertOne(pool, input)
}

/**
 * Creates several tasks in one transaction — used by the AI parsing flow, where
 * a batch of parsed tasks should land all-or-nothing.
 */
export async function createTasks(inputs: CreateTaskInput[]): Promise<Task[]> {
  if (inputs.length === 0) return []

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const created: Task[] = []
    for (const input of inputs) {
      created.push(await insertOne(client, input))
    }
    await client.query('COMMIT')
    return created
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export interface ListTasksFilter {
  status?: TaskStatusValue
  /** `null` means top-level tasks only; a uuid means children of that task. */
  parentTaskId?: string | null
  captureBatchId?: string
  /** Only tasks with an estimate at or under this many minutes. */
  maxEstimatedMinutes?: number
  limit?: number
}

export async function listTasks(filter: ListTasksFilter = {}): Promise<Task[]> {
  const conditions: string[] = []
  const values: unknown[] = []

  if (filter.status !== undefined) {
    values.push(filter.status)
    conditions.push(`status = $${values.length}::task_status`)
  }
  if ('parentTaskId' in filter) {
    if (filter.parentTaskId === null) {
      conditions.push('parent_task_id IS NULL')
    } else if (filter.parentTaskId !== undefined) {
      values.push(filter.parentTaskId)
      conditions.push(`parent_task_id = $${values.length}`)
    }
  }
  if (filter.captureBatchId !== undefined) {
    values.push(filter.captureBatchId)
    conditions.push(`capture_batch_id = $${values.length}`)
  }
  if (filter.maxEstimatedMinutes !== undefined) {
    values.push(filter.maxEstimatedMinutes)
    conditions.push(`estimated_minutes IS NOT NULL AND estimated_minutes <= $${values.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  let limitClause = ''
  if (filter.limit !== undefined) {
    values.push(filter.limit)
    limitClause = `LIMIT $${values.length}`
  }

  // priority is an enum declared low < medium < high, so DESC puts high first.
  const { rows } = await pool.query<TaskRow>(
    `SELECT ${COLUMNS} FROM tasks
     ${where}
     ORDER BY priority DESC, due_at ASC NULLS LAST, created_at ASC
     ${limitClause}`,
    values,
  )
  return rows.map(mapRow)
}

/**
 * Open tasks whose deadline falls inside the lead window and that have not been
 * alerted yet. Overdue tasks are included: a deadline that passed while the
 * service was down still deserves exactly one alert. `alerted_at` is what makes
 * this idempotent, so the sweep can run as often as it likes.
 */
export async function listTasksDueForAlert(
  leadMinutes: number,
  limit: number,
): Promise<Task[]> {
  const { rows } = await pool.query<TaskRow>(
    `SELECT ${COLUMNS} FROM tasks
     WHERE status = 'open'
       AND due_at IS NOT NULL
       AND alerted_at IS NULL
       AND due_at <= now() + make_interval(mins => $1)
     ORDER BY due_at ASC
     LIMIT $2`,
    [leadMinutes, limit],
  )
  return rows.map(mapRow)
}

export async function getTask(id: string): Promise<Task | null> {
  const { rows } = await pool.query<TaskRow>(`SELECT ${COLUMNS} FROM tasks WHERE id = $1`, [id])
  return rows[0] ? mapRow(rows[0]) : null
}

export interface UpdateTaskInput {
  title?: string
  notes?: string | null
  status?: TaskStatusValue
  priority?: TaskPriorityValue
  dueAt?: Date | string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
  suggestBreakdown?: boolean
  alertedAt?: Date | null
}

const UPDATABLE_COLUMNS: Record<keyof UpdateTaskInput, string> = {
  title: 'title',
  notes: 'notes',
  status: 'status',
  priority: 'priority',
  dueAt: 'due_at',
  estimatedMinutes: 'estimated_minutes',
  parentTaskId: 'parent_task_id',
  suggestBreakdown: 'suggest_breakdown',
  alertedAt: 'alerted_at',
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task | null> {
  const assignments: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    // An explicit `null` clears the column; an explicit `undefined` means
    // "leave it alone". Testing the value rather than key presence is what
    // keeps those apart — `key in patch` is true for both.
    const value = patch[key as keyof UpdateTaskInput]
    if (value === undefined) continue
    values.push(value)
    assignments.push(`${column} = $${values.length}`)
  }

  // completed_at is derived from status, never set directly by a client.
  // COALESCE keeps the original completion time if a done task is patched again.
  if (patch.status !== undefined) {
    assignments.push(
      patch.status === 'done' ? 'completed_at = COALESCE(completed_at, now())' : 'completed_at = NULL',
    )
  }

  // Rescheduling a task must re-arm its deadline alert: alerted_at is what
  // listTasksDueForAlert uses to decide a task has already been notified
  // about, and a stale stamp from before the reschedule would suppress the
  // alert for the new due date forever. An explicit alertedAt in the same
  // patch (how the sweep stamps it) wins over this.
  if (patch.dueAt !== undefined && patch.alertedAt === undefined) {
    assignments.push('alerted_at = NULL')
  }

  if (assignments.length === 0) return getTask(id)

  values.push(id)
  const { rows } = await pool.query<TaskRow>(
    `UPDATE tasks SET ${assignments.join(', ')}
     WHERE id = $${values.length}
     RETURNING ${COLUMNS}`,
    values,
  )
  return rows[0] ? mapRow(rows[0]) : null
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
