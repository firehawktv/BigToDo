import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAllSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/send.js', () => ({ sendToAllSubscriptions }))

const { closePool } = await import('../../src/db/pool.js')
const { setupTestDatabase, truncateAll } = await import('../helpers/db.js')
const { createTask, getTask, listTasks } = await import('../../src/repositories/tasks.js')
const { runDeadlineSweep } = await import('../../src/scheduler/deadlines.js')

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000)

describe('runDeadlineSweep', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
    sendToAllSubscriptions.mockReset()
    sendToAllSubscriptions.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 })
  })

  afterAll(async () => {
    await closePool()
  })

  it('sends one notification per due task and stamps alertedAt', async () => {
    const task = await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(1)
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
    expect((await getTask(task.id))?.alertedAt).toBeInstanceOf(Date)
  })

  it('puts the task title in the notification body', async () => {
    await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })

    await runDeadlineSweep()

    const payload = sendToAllSubscriptions.mock.calls[0]![0]
    expect(payload.body).toContain('Call the dentist')
    expect(typeof payload.title).toBe('string')
  })

  it('does not alert the same task twice across sweeps', async () => {
    await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })

    await runDeadlineSweep()
    const second = await runDeadlineSweep()

    expect(second.alerted).toBe(0)
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no task is due', async () => {
    await createTask({ title: 'Not due yet', dueAt: minutesFromNow(600) })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(0)
    expect(sendToAllSubscriptions).not.toHaveBeenCalled()
  })

  it('does not stamp alertedAt when the send fails outright', async () => {
    // If nothing was delivered, the alert should be retried next tick rather
    // than being silently swallowed.
    const task = await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })
    sendToAllSubscriptions.mockResolvedValue({ sent: 0, pruned: 0, failed: 1 })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(0)
    expect((await getTask(task.id))?.alertedAt).toBeNull()
  })

  it('does not stamp alertedAt when there are no subscriptions at all, so it can alert once one exists', async () => {
    // Nobody to notify means nobody was actually alerted — stamping here
    // would permanently consume the one alert this task ever gets. Leaving
    // it unstamped costs one indexed query per tick and self-corrects the
    // moment a device subscribes.
    const task = await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })
    sendToAllSubscriptions.mockResolvedValue({ sent: 0, pruned: 0, failed: 0 })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(0)
    expect((await getTask(task.id))?.alertedAt).toBeNull()
  })

  it('keeps going when one task send rejects', async () => {
    // listTasksDueForAlert orders by due_at ASC, so 'First' (sooner) is
    // processed before 'Second' — that ordering is what makes the rejection
    // land on 'First' and leaves 'Second' as the one that gets alerted.
    await createTask({ title: 'First', dueAt: minutesFromNow(10) })
    await createTask({ title: 'Second', dueAt: minutesFromNow(20) })
    sendToAllSubscriptions
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ sent: 1, pruned: 0, failed: 0 })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(1)
    const alerted = (await listTasks()).filter((task) => task.alertedAt !== null)
    expect(alerted.map((task) => task.title)).toEqual(['Second'])
  })

  it('never throws', async () => {
    await createTask({ title: 'Boom', dueAt: minutesFromNow(10) })
    sendToAllSubscriptions.mockRejectedValue(new Error('everything is broken'))

    await expect(runDeadlineSweep()).resolves.toEqual({ alerted: 0 })
  })
})
