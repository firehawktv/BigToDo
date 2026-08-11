import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { closePool } from '../../src/db/pool.js'
import { truncateAll } from '../helpers/db.js'
import { authHeaders, buildTestApp } from '../helpers/app.js'

describe('/tasks routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  async function createTaskViaApi(payload: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload,
    })
    expect(response.statusCode).toBe(201)
    return response.json()
  }

  it('requires auth on every task route', async () => {
    for (const [method, url] of [
      ['POST', '/tasks'],
      ['GET', '/tasks'],
      ['GET', '/tasks/00000000-0000-0000-0000-000000000000'],
      ['PATCH', '/tasks/00000000-0000-0000-0000-000000000000'],
      ['DELETE', '/tasks/00000000-0000-0000-0000-000000000000'],
    ] as const) {
      const response = await app.inject({ method, url, payload: { title: 'x' } })
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it('creates a task and returns 201 with ISO timestamps', async () => {
    const body = await createTaskViaApi({
      title: 'Call the dentist',
      priority: 'high',
      dueAt: '2026-09-01T10:00:00.000Z',
      estimatedMinutes: 15,
    })

    expect(body).toMatchObject({
      title: 'Call the dentist',
      status: 'open',
      priority: 'high',
      estimatedMinutes: 15,
      source: 'manual',
      completedAt: null,
    })
    expect(body.dueAt).toBe('2026-09-01T10:00:00.000Z')
    expect(typeof body.createdAt).toBe('string')
    expect(new Date(body.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('rejects an empty title with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: '' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects unknown body properties with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: 'Fine', completedAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects a malformed uuid path param with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tasks/not-a-uuid',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects an invalid priority with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: 'Fine', priority: 'urgent' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('lists tasks in priority order', async () => {
    await createTaskViaApi({ title: 'low one', priority: 'low' })
    await createTaskViaApi({ title: 'high one', priority: 'high' })

    const response = await app.inject({ method: 'GET', url: '/tasks', headers: authHeaders() })

    expect(response.statusCode).toBe(200)
    expect(response.json().tasks.map((task: { title: string }) => task.title)).toEqual([
      'high one',
      'low one',
    ])
  })

  it('filters the list by status and by maxEstimatedMinutes', async () => {
    const quick = await createTaskViaApi({ title: 'quick', estimatedMinutes: 10 })
    await createTaskViaApi({ title: 'slow', estimatedMinutes: 120 })

    const byMinutes = await app.inject({
      method: 'GET',
      url: '/tasks?maxEstimatedMinutes=20',
      headers: authHeaders(),
    })
    expect(byMinutes.json().tasks.map((task: { id: string }) => task.id)).toEqual([quick.id])

    const byStatus = await app.inject({
      method: 'GET',
      url: '/tasks?status=done',
      headers: authHeaders(),
    })
    expect(byStatus.json().tasks).toEqual([])
  })

  it('returns only top-level tasks for parentTaskId=none', async () => {
    const parent = await createTaskViaApi({ title: 'Project' })
    await createTaskViaApi({ title: 'Subtask', parentTaskId: parent.id })

    const response = await app.inject({
      method: 'GET',
      url: '/tasks?parentTaskId=none',
      headers: authHeaders(),
    })

    expect(response.json().tasks.map((task: { id: string }) => task.id)).toEqual([parent.id])
  })

  it('gets a single task, and 404s for an unknown id', async () => {
    const task = await createTaskViaApi({ title: 'Find me' })

    const found = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
    })
    expect(found.statusCode).toBe(200)
    expect(found.json().title).toBe('Find me')

    const missing = await app.inject({
      method: 'GET',
      url: '/tasks/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: 'Task not found' })
  })

  it('patches a task and stamps completedAt when marked done', async () => {
    const task = await createTaskViaApi({ title: 'Do the thing' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
      payload: { status: 'done' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('done')
    expect(response.json().completedAt).not.toBeNull()
  })

  it('serializes every timestamp field as a real ISO string, not just via the wire serializer', async () => {
    const task = await createTaskViaApi({
      title: 'Has real timestamps',
      dueAt: '2026-09-01T10:00:00.000Z',
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
      payload: { status: 'done' },
    })
    const body = response.json()

    // dueAt and completedAt are both non-null here, so this pins toResponse()'s
    // own conversion of Date -> string, not merely what the serializer would do.
    expect(typeof body.dueAt).toBe('string')
    expect(typeof body.completedAt).toBe('string')
    expect(typeof body.createdAt).toBe('string')
    expect(body.dueAt).toBe('2026-09-01T10:00:00.000Z')
    expect(new Date(body.completedAt).toString()).not.toBe('Invalid Date')
  })

  it('rejects an empty patch body with 400', async () => {
    const task = await createTaskViaApi({ title: 'Do the thing' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns 404 when patching a task that does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/tasks/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
      payload: { title: 'ghost' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('deletes a task with 204, then 404s on a second delete', async () => {
    const task = await createTaskViaApi({ title: 'Delete me' })

    const first = await app.inject({
      method: 'DELETE',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
    })
    expect(first.statusCode).toBe(204)

    const second = await app.inject({
      method: 'DELETE',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
    })
    expect(second.statusCode).toBe(404)
  })

  it('returns 400 when parentTaskId points at a task that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: 'Orphan', parentTaskId: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'parentTaskId does not exist' })
  })
})
