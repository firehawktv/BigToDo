import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { closePool } from '../../src/db/pool.js'
import { truncateAll } from '../helpers/db.js'
import { authHeaders, buildTestApp } from '../helpers/app.js'

describe('/check-in-settings routes', () => {
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
    for (const method of ['GET', 'PATCH'] as const) {
      const response = await app.inject({ method, url: '/check-in-settings', payload: {} })
      expect(response.statusCode, method).toBe(401)
    }
  })

  it('returns the current settings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/check-in-settings',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      enabled: true,
      activeFrom: '09:00',
      activeTo: '18:00',
      checkInsPerDay: 3,
      timezone: 'UTC',
    })
  })

  it('patches a subset of fields', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { checkInsPerDay: 5, timezone: 'Europe/London' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().checkInsPerDay).toBe(5)
    expect(response.json().timezone).toBe('Europe/London')
    expect(response.json().activeFrom).toBe('09:00')
  })

  it('rejects a malformed time', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { activeFrom: '9am' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an out-of-range check-in count', async () => {
    for (const checkInsPerDay of [-1, 13]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/check-in-settings',
        headers: authHeaders(),
        payload: { checkInsPerDay },
      })
      expect(response.statusCode, String(checkInsPerDay)).toBe(400)
    }
  })

  it('rejects an unknown timezone rather than storing it', async () => {
    // A bad zone would make every later check-in sweep throw.
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { timezone: 'Mars/Olympus_Mons' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a window whose end is not after its start', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { activeFrom: '18:00', activeTo: '09:00' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an empty patch', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })
})
