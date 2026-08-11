import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// vi.hoisted, because vi.mock is hoisted above every const in the file.
const { proposeBreakdown } = vi.hoisted(() => ({ proposeBreakdown: vi.fn() }))

vi.mock('../../src/ai/breakdown.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/breakdown.js')>(
    '../../src/ai/breakdown.js',
  )
  return { ...actual, proposeBreakdown }
})

const { closePool } = await import('../../src/db/pool.js')
const { truncateAll } = await import('../helpers/db.js')
const { authHeaders, buildTestApp } = await import('../helpers/app.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')
const { createTask, listTasks } = await import('../../src/repositories/tasks.js')

const MISSING_ID = '00000000-0000-0000-0000-000000000000'

describe('breakdown routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    proposeBreakdown.mockReset()
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  it('requires auth on both routes', async () => {
    for (const url of [`/tasks/${MISSING_ID}/breakdown`, `/tasks/${MISSING_ID}/subtasks`]) {
      const response = await app.inject({ method: 'POST', url, payload: { subtasks: [] } })
      expect(response.statusCode, url).toBe(401)
    }
  })

  it('proposes subtasks without saving anything', async () => {
    const task = await createTask({ title: 'Redesign the site', suggestBreakdown: true })
    proposeBreakdown.mockResolvedValue([
      { title: 'Collect references', estimatedMinutes: 30 },
      { title: 'Sketch a layout', estimatedMinutes: 60 },
    ])

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/breakdown`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().subtasks).toHaveLength(2)
    // Nothing persisted: still just the parent.
    expect(await listTasks()).toHaveLength(1)
  })

  it('404s when proposing a breakdown for a task that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${MISSING_ID}/breakdown`,
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(404)
    expect(proposeBreakdown).not.toHaveBeenCalled()
  })

  it('503s when Claude is unavailable', async () => {
    const task = await createTask({ title: 'Redesign the site' })
    proposeBreakdown.mockRejectedValue(new AiUnavailableError('down', 'request_failed'))

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/breakdown`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatch(/unavailable/i)
  })

  it('saves edited subtasks under the parent and clears the flag', async () => {
    const parent = await createTask({ title: 'Redesign the site', suggestBreakdown: true })

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${parent.id}/subtasks`,
      headers: authHeaders(),
      payload: {
        subtasks: [
          { title: 'Collect references', estimatedMinutes: 30 },
          { title: 'Sketch a layout', estimatedMinutes: null },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    const created = response.json().tasks
    expect(created).toHaveLength(2)
    expect(created.every((t: { parentTaskId: string }) => t.parentTaskId === parent.id)).toBe(true)
    expect(created.every((t: { source: string }) => t.source === 'ai_breakdown')).toBe(true)

    const children = await listTasks({ parentTaskId: parent.id })
    expect(children).toHaveLength(2)

    // The "Break this down?" affordance should be gone now.
    const refreshed = await listTasks({ parentTaskId: null })
    expect(refreshed[0]?.suggestBreakdown).toBe(false)
  })

  it('404s when saving subtasks under a task that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${MISSING_ID}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [{ title: 'Step one', estimatedMinutes: null }] },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects an empty subtask list', async () => {
    const parent = await createTask({ title: 'Redesign the site' })

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${parent.id}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [] },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a blank subtask title', async () => {
    const parent = await createTask({ title: 'Redesign the site' })

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${parent.id}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [{ title: '   ', estimatedMinutes: null }] },
    })

    expect(response.statusCode).toBe(400)
  })
})
