import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { closePool } from '../../src/db/pool.js'
import { truncateAll } from '../helpers/db.js'
import { authHeaders, buildTestApp } from '../helpers/app.js'
import { createTask } from '../../src/repositories/tasks.js'

describe('/capture-batches routes', () => {
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

  it('requires auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      payload: { rawText: 'buy milk' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('stores the raw dump verbatim, including newlines', async () => {
    const rawText = 'buy milk\ncall dentist ASAP\nplan the trip'

    const response = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().rawText).toBe(rawText)
    expect(response.json().id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects an empty or whitespace-only dump with 400', async () => {
    for (const rawText of ['', '   \n  ']) {
      const response = await app.inject({
        method: 'POST',
        url: '/capture-batches',
        headers: authHeaders(),
        payload: { rawText },
      })
      expect(response.statusCode, JSON.stringify(rawText)).toBe(400)
    }
  })

  it('returns a batch with the tasks linked to it, in priority order', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText: 'two things' },
    })
    const batchId = created.json().id

    await createTask({ title: 'later', priority: 'low', captureBatchId: batchId })
    await createTask({ title: 'first', priority: 'high', captureBatchId: batchId })
    await createTask({ title: 'unrelated', priority: 'high' })

    const response = await app.inject({
      method: 'GET',
      url: `/capture-batches/${batchId}`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().rawText).toBe('two things')
    expect(response.json().tasks.map((task: { title: string }) => task.title)).toEqual([
      'first',
      'later',
    ])
  })

  it('404s for a batch that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/capture-batches/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(404)
  })

  it('keeps the batch when a linked task is deleted', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText: 'keep me' },
    })
    const batchId = created.json().id
    const task = await createTask({ title: 'temporary', captureBatchId: batchId })

    await app.inject({ method: 'DELETE', url: `/tasks/${task.id}`, headers: authHeaders() })

    const response = await app.inject({
      method: 'GET',
      url: `/capture-batches/${batchId}`,
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().tasks).toEqual([])
  })
})
