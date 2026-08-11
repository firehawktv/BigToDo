import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import { createTask, listTasksDueForAlert, updateTask } from '../../src/repositories/tasks.js'

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000)

describe('listTasksDueForAlert', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('returns an open task due inside the lead window', async () => {
    await createTask({ title: 'Due soon', dueAt: minutesFromNow(30) })

    const due = await listTasksDueForAlert(60, 50)

    expect(due.map((task) => task.title)).toEqual(['Due soon'])
  })

  it('excludes a task due beyond the lead window', async () => {
    await createTask({ title: 'Due later', dueAt: minutesFromNow(120) })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('includes an overdue task that was never alerted', async () => {
    await createTask({ title: 'Overdue', dueAt: minutesFromNow(-120) })

    expect((await listTasksDueForAlert(60, 50)).map((t) => t.title)).toEqual(['Overdue'])
  })

  it('excludes a task that was already alerted', async () => {
    const task = await createTask({ title: 'Already alerted', dueAt: minutesFromNow(30) })
    await updateTask(task.id, { alertedAt: new Date() })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('excludes a completed task', async () => {
    const task = await createTask({ title: 'Done already', dueAt: minutesFromNow(30) })
    await updateTask(task.id, { status: 'done' })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('excludes a task with no due date', async () => {
    await createTask({ title: 'No deadline' })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('returns the soonest-due first and respects the limit', async () => {
    await createTask({ title: 'Later', dueAt: minutesFromNow(50) })
    await createTask({ title: 'Sooner', dueAt: minutesFromNow(10) })

    const due = await listTasksDueForAlert(60, 1)

    expect(due.map((task) => task.title)).toEqual(['Sooner'])
  })

  it('re-arms the alert when dueAt is rescheduled after an alert was sent', async () => {
    const task = await createTask({ title: 'Reschedule me', dueAt: minutesFromNow(30) })
    await updateTask(task.id, { alertedAt: new Date() })
    expect(await listTasksDueForAlert(60, 50)).toEqual([])

    await updateTask(task.id, { dueAt: minutesFromNow(20) })

    expect((await listTasksDueForAlert(60, 50)).map((t) => t.title)).toEqual(['Reschedule me'])
  })

  it('keeps an explicit alertedAt when dueAt is patched in the same call', async () => {
    const task = await createTask({ title: 'Sweep stamp', dueAt: minutesFromNow(30) })
    const stamp = new Date()

    const updated = await updateTask(task.id, { dueAt: minutesFromNow(45), alertedAt: stamp })

    expect(updated?.alertedAt?.getTime()).toBe(stamp.getTime())
    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('leaves alertedAt intact when an unrelated field is patched', async () => {
    const task = await createTask({ title: 'Original title', dueAt: minutesFromNow(30) })
    await updateTask(task.id, { alertedAt: new Date() })

    const updated = await updateTask(task.id, { title: 'New title' })

    expect(updated?.title).toBe('New title')
    expect(updated?.alertedAt).toBeInstanceOf(Date)
    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('does not write NULL when a patch field is explicitly undefined', async () => {
    // The scheduler is the first non-HTTP caller of updateTask, and it can
    // plausibly pass `{ alertedAt: maybeUndefined }`. Before this fix that
    // wrote NULL over the existing value instead of leaving it alone.
    const task = await createTask({ title: 'Keeps its title' })
    await updateTask(task.id, { alertedAt: new Date() })

    const updated = await updateTask(task.id, { title: undefined, alertedAt: undefined })

    expect(updated?.title).toBe('Keeps its title')
    expect(updated?.alertedAt).toBeInstanceOf(Date)
  })
})
