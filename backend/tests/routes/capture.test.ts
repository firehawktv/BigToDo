import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// vi.hoisted, because vi.mock is hoisted above every const in the file.
const { parseCapture } = vi.hoisted(() => ({ parseCapture: vi.fn() }))

vi.mock('../../src/ai/parseCapture.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/parseCapture.js')>(
    '../../src/ai/parseCapture.js',
  )
  return { ...actual, parseCapture }
})

const { pool, closePool } = await import('../../src/db/pool.js')
const { truncateAll } = await import('../helpers/db.js')
const { authHeaders, buildTestApp } = await import('../helpers/app.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')
const { createTask } = await import('../../src/repositories/tasks.js')

describe('POST /capture', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    parseCapture.mockReset()
  })

  afterAll(async () => {
    await app.close()
  })

  function capture(rawText: string) {
    return app.inject({
      method: 'POST',
      url: '/capture',
      headers: authHeaders(),
      payload: { rawText },
    })
  }

  it('requires auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture',
      payload: { rawText: 'buy milk' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('parses a dump into tasks linked to a saved batch', async () => {
    parseCapture.mockResolvedValue([
      {
        title: 'Call the dentist',
        notes: null,
        priority: 'high',
        dueAt: null,
        estimatedMinutes: 10,
        suggestBreakdown: false,
      },
      {
        title: 'Redesign the website',
        notes: null,
        priority: 'medium',
        dueAt: null,
        estimatedMinutes: null,
        suggestBreakdown: true,
      },
    ])

    const response = await capture('call dentist ASAP\nredesign the website')

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.type).toBe('batch')
    expect(body.batch.parseStatus).toBe('parsed')
    expect(body.batch.rawText).toBe('call dentist ASAP\nredesign the website')
    expect(body.tasks).toHaveLength(2)
    expect(body.tasks.every((task: { source: string }) => task.source === 'ai_parsed')).toBe(true)
    expect(body.tasks.every((task: { captureBatchId: string }) => task.captureBatchId === body.batch.id)).toBe(true)
    const project = body.tasks.find((task: { title: string }) => task.title === 'Redesign the website')
    expect(project.suggestBreakdown).toBe(true)
  })

  it('saves the raw text and one fallback task when Claude is unavailable', async () => {
    parseCapture.mockRejectedValue(new AiUnavailableError('down', 'request_failed'))

    const response = await capture('buy milk\ncall dentist')

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.batch.parseStatus).toBe('failed')
    expect(body.batch.rawText).toBe('buy milk\ncall dentist')
    expect(body.batch.parseError).toBeTruthy()
    // Input is never lost: one task carrying the dump, editable by hand.
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].source).toBe('manual')
    expect(body.tasks[0].notes).toBe('buy milk\ncall dentist')
  })

  it('rejects a blank dump before calling Claude', async () => {
    const response = await capture('   ')

    expect(response.statusCode).toBe(400)
    expect(parseCapture).not.toHaveBeenCalled()
  })

  it('answers a time-available query without creating a batch or calling Claude', async () => {
    await createTask({ title: 'Quick win', estimatedMinutes: 10, priority: 'high' })
    await createTask({ title: 'Long haul', estimatedMinutes: 120 })

    const response = await capture('I have 20 minutes')

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.type).toBe('shortlist')
    expect(body.minutes).toBe(20)
    expect(body.tasks.map((task: { title: string }) => task.title)).toEqual(['Quick win'])
    expect(parseCapture).not.toHaveBeenCalled()

    // A query must not litter the capture history — asking twice should leave
    // no trace. Checked directly, because there is no list-batches endpoint.
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM capture_batches',
    )
    expect(rows[0]!.count).toBe(0)
  })

  it('returns at most five shortlist items', async () => {
    for (let index = 0; index < 8; index += 1) {
      await createTask({ title: `Task ${index}`, estimatedMinutes: 5 })
    }

    const response = await capture('I have 20 minutes')

    expect(response.json().tasks).toHaveLength(5)
  })

  it('excludes completed tasks from the shortlist', async () => {
    const done = await createTask({ title: 'Already done', estimatedMinutes: 5 })
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${done.id}`,
      headers: authHeaders(),
      payload: { status: 'done' },
    })

    const response = await capture('I have 20 minutes')

    expect(response.json().tasks).toEqual([])
  })
})

describe('POST /capture-batches/:id/parse', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    parseCapture.mockReset()
  })

  afterAll(async () => {
    await app.close()
  })

  async function failedCapture(rawText: string) {
    parseCapture.mockRejectedValueOnce(new AiUnavailableError('down', 'request_failed'))
    const created = await app.inject({
      method: 'POST',
      url: '/capture',
      headers: authHeaders(),
      payload: { rawText },
    })
    return created.json().batch.id as string
  }

  it('retries a failed batch and replaces the fallback task', async () => {
    const batchId = await failedCapture('buy milk')

    parseCapture.mockResolvedValueOnce([
      {
        title: 'Buy milk',
        notes: null,
        priority: 'low',
        dueAt: null,
        estimatedMinutes: 5,
        suggestBreakdown: false,
      },
    ])

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.batch.parseStatus).toBe('parsed')
    expect(body.batch.parseError).toBeNull()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].title).toBe('Buy milk')
    expect(body.tasks[0].source).toBe('ai_parsed')
  })

  it('leaves the batch failed when the retry also fails', async () => {
    const batchId = await failedCapture('buy milk')
    parseCapture.mockRejectedValueOnce(new AiUnavailableError('still down', 'request_failed'))

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().batch.parseStatus).toBe('failed')
    expect(response.json().tasks).toHaveLength(1)
  })

  it('404s for a batch that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture-batches/00000000-0000-0000-0000-000000000000/parse',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(404)
  })

  it('409s when the batch already parsed successfully', async () => {
    parseCapture.mockResolvedValueOnce([])
    const created = await app.inject({
      method: 'POST',
      url: '/capture',
      headers: authHeaders(),
      payload: { rawText: 'buy milk' },
    })
    const batchId = created.json().batch.id

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(409)
  })

  // The plan-1/plan-2 seam: a batch created via the plan-1 endpoint (which
  // only stores raw text and never parses) must be reachable by /parse, or
  // it is stuck `pending` forever.
  it('parses a pending batch created via POST /capture-batches', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText: 'buy milk' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().parseStatus).toBe('pending')
    const batchId = created.json().id

    parseCapture.mockResolvedValueOnce([
      {
        title: 'Buy milk',
        notes: null,
        priority: 'low',
        dueAt: null,
        estimatedMinutes: 5,
        suggestBreakdown: false,
      },
    ])

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.batch.parseStatus).toBe('parsed')
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].title).toBe('Buy milk')
  })

  it('does not delete subtasks the user created under the fallback task', async () => {
    const batchId = await failedCapture('buy milk')
    const fallback = (
      await app.inject({
        method: 'GET',
        url: `/capture-batches/${batchId}`,
        headers: authHeaders(),
      })
    ).json().tasks[0]

    const subtaskResponse = await app.inject({
      method: 'POST',
      url: `/tasks/${fallback.id}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [{ title: 'Buy 2%', estimatedMinutes: 5 }] },
    })
    expect(subtaskResponse.statusCode).toBe(201)
    const childId = subtaskResponse.json().tasks[0].id

    parseCapture.mockResolvedValueOnce([
      {
        title: 'Buy milk',
        notes: null,
        priority: 'low',
        dueAt: null,
        estimatedMinutes: 5,
        suggestBreakdown: false,
      },
    ])

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const child = await app.inject({
      method: 'GET',
      url: `/tasks/${childId}`,
      headers: authHeaders(),
    })
    expect(child.statusCode).toBe(200)
  })
})

describe('GET /tasks/available', () => {
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

  it('returns the shortlist for an explicit minutes value', async () => {
    await createTask({ title: 'Quick', estimatedMinutes: 10 })
    await createTask({ title: 'Slow', estimatedMinutes: 90 })

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/available?minutes=20',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().minutes).toBe(20)
    expect(response.json().tasks.map((t: { title: string }) => t.title)).toEqual(['Quick'])
  })

  it('is routed ahead of GET /tasks/:id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tasks/available?minutes=20',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
  })

  it('rejects a missing or out-of-range minutes value', async () => {
    for (const url of ['/tasks/available', '/tasks/available?minutes=0', '/tasks/available?minutes=5000']) {
      const response = await app.inject({ method: 'GET', url, headers: authHeaders() })
      expect(response.statusCode, url).toBe(400)
    }
  })
})
