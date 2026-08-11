import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import {
  createTask,
  createTasks,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from '../../src/repositories/tasks.js'

describe('tasks repository', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('creates a task with spec defaults when only a title is given', async () => {
    const task = await createTask({ title: 'Buy milk' })

    expect(task.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(task.title).toBe('Buy milk')
    expect(task.status).toBe('open')
    expect(task.priority).toBe('medium')
    expect(task.source).toBe('manual')
    expect(task.notes).toBeNull()
    expect(task.dueAt).toBeNull()
    expect(task.estimatedMinutes).toBeNull()
    expect(task.parentTaskId).toBeNull()
    expect(task.completedAt).toBeNull()
    expect(task.createdAt).toBeInstanceOf(Date)
  })

  it('round-trips every optional field', async () => {
    const dueAt = new Date('2026-09-01T10:00:00.000Z')
    const task = await createTask({
      title: 'File taxes',
      notes: 'from the raw dump',
      priority: 'high',
      dueAt,
      estimatedMinutes: 90,
      source: 'ai_parsed',
    })

    expect(task.notes).toBe('from the raw dump')
    expect(task.priority).toBe('high')
    expect(task.dueAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z')
    expect(task.estimatedMinutes).toBe(90)
    expect(task.source).toBe('ai_parsed')
  })

  it('returns null from getTask for an id that does not exist', async () => {
    expect(await getTask('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('orders lists by priority (high first), then soonest due date, then oldest', async () => {
    await createTask({ title: 'low', priority: 'low' })
    await createTask({ title: 'high-later', priority: 'high', dueAt: new Date('2026-09-05T00:00:00Z') })
    await createTask({ title: 'high-sooner', priority: 'high', dueAt: new Date('2026-09-01T00:00:00Z') })
    await createTask({ title: 'medium', priority: 'medium' })

    const tasks = await listTasks()

    expect(tasks.map((task) => task.title)).toEqual(['high-sooner', 'high-later', 'medium', 'low'])
  })

  it('sorts tasks without a due date after tasks with one at the same priority', async () => {
    await createTask({ title: 'no-due', priority: 'high' })
    await createTask({ title: 'has-due', priority: 'high', dueAt: new Date('2026-12-31T00:00:00Z') })

    const tasks = await listTasks()

    expect(tasks.map((task) => task.title)).toEqual(['has-due', 'no-due'])
  })

  it('filters by status', async () => {
    const open = await createTask({ title: 'still open' })
    const done = await createTask({ title: 'finished' })
    await updateTask(done.id, { status: 'done' })

    const openTasks = await listTasks({ status: 'open' })
    const doneTasks = await listTasks({ status: 'done' })

    expect(openTasks.map((task) => task.id)).toEqual([open.id])
    expect(doneTasks.map((task) => task.id)).toEqual([done.id])
  })

  it('filters to top-level tasks with parentTaskId null, and to children by id', async () => {
    const parent = await createTask({ title: 'Redesign site' })
    const child = await createTask({ title: 'Sketch layout', parentTaskId: parent.id })

    const topLevel = await listTasks({ parentTaskId: null })
    const children = await listTasks({ parentTaskId: parent.id })

    expect(topLevel.map((task) => task.id)).toEqual([parent.id])
    expect(children.map((task) => task.id)).toEqual([child.id])
  })

  it('filters by maxEstimatedMinutes and excludes tasks with no estimate', async () => {
    await createTask({ title: 'quick', estimatedMinutes: 10 })
    await createTask({ title: 'exactly at limit', estimatedMinutes: 20 })
    await createTask({ title: 'too long', estimatedMinutes: 45 })
    await createTask({ title: 'unestimated' })

    const tasks = await listTasks({ maxEstimatedMinutes: 20 })

    expect(tasks.map((task) => task.title).sort()).toEqual(['exactly at limit', 'quick'])
  })

  it('respects limit', async () => {
    await createTask({ title: 'a' })
    await createTask({ title: 'b' })
    await createTask({ title: 'c' })

    expect(await listTasks({ limit: 2 })).toHaveLength(2)
  })

  it('updates only the fields present in the patch', async () => {
    const task = await createTask({ title: 'Original', notes: 'keep me', priority: 'low' })

    const updated = await updateTask(task.id, { title: 'Renamed' })

    expect(updated?.title).toBe('Renamed')
    expect(updated?.notes).toBe('keep me')
    expect(updated?.priority).toBe('low')
  })

  it('clears a nullable field when the patch sets it to null', async () => {
    const task = await createTask({ title: 'Has a due date', dueAt: new Date('2026-09-01T00:00:00Z') })

    const updated = await updateTask(task.id, { dueAt: null })

    expect(updated?.dueAt).toBeNull()
  })

  it('stamps completed_at when a task becomes done and clears it when reopened', async () => {
    const task = await createTask({ title: 'Finish plan' })

    const done = await updateTask(task.id, { status: 'done' })
    expect(done?.status).toBe('done')
    expect(done?.completedAt).toBeInstanceOf(Date)

    const reopened = await updateTask(task.id, { status: 'open' })
    expect(reopened?.status).toBe('open')
    expect(reopened?.completedAt).toBeNull()
  })

  it('does not move completed_at when a task is marked done twice', async () => {
    const task = await createTask({ title: 'Finish plan' })
    const first = await updateTask(task.id, { status: 'done' })
    const second = await updateTask(task.id, { status: 'done', title: 'Finish plan!' })

    expect(second?.completedAt?.toISOString()).toBe(first?.completedAt?.toISOString())
  })

  it('returns null when updating a task that does not exist', async () => {
    const result = await updateTask('00000000-0000-0000-0000-000000000000', { title: 'ghost' })
    expect(result).toBeNull()
  })

  it('deletes a task and reports whether anything was deleted', async () => {
    const task = await createTask({ title: 'Delete me' })

    expect(await deleteTask(task.id)).toBe(true)
    expect(await getTask(task.id)).toBeNull()
    expect(await deleteTask(task.id)).toBe(false)
  })

  it('deletes subtasks along with their parent', async () => {
    const parent = await createTask({ title: 'Project' })
    const child = await createTask({ title: 'Step one', parentTaskId: parent.id })

    await deleteTask(parent.id)

    expect(await getTask(child.id)).toBeNull()
  })

  it('creates several tasks in one call and persists all of them', async () => {
    const created = await createTasks([
      { title: 'Batch one', priority: 'high' },
      { title: 'Batch two', notes: 'from parsing', estimatedMinutes: 15 },
    ])

    expect(created).toHaveLength(2)
    expect(created.map((task) => task.title)).toEqual(['Batch one', 'Batch two'])
    expect(created[0]?.priority).toBe('high')
    expect(created[1]?.notes).toBe('from parsing')
    expect(created[1]?.estimatedMinutes).toBe(15)

    const persisted = await listTasks()
    expect(persisted.map((task) => task.title).sort()).toEqual(['Batch one', 'Batch two'])
  })

  it('returns an empty array and inserts nothing for an empty batch', async () => {
    const created = await createTasks([])

    expect(created).toEqual([])
    expect(await listTasks()).toEqual([])
  })

  it('rolls back the whole batch when one row is invalid', async () => {
    await expect(
      createTasks([
        { title: 'Valid row' },
        { title: 'Bad row', parentTaskId: '00000000-0000-0000-0000-000000000000' },
      ]),
    ).rejects.toThrow()

    expect(await listTasks()).toEqual([])
  })
})
