import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, authHeaders } from './helpers/app.js'
import { config } from '../src/config.js'

describe('bearer token auth', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    // A throwaway protected route: this test is about the guard, not about tasks.
    app.get('/protected', { onRequest: app.requireAuth }, async () => ({ ok: true }))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects a request with no Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/protected' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('rejects a non-Bearer scheme', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a wrong token of the same length', async () => {
    const forgedToken = 'b'.repeat(config().apiToken.length)
    expect(forgedToken.length).toBe(config().apiToken.length)

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${forgedToken}` },
    })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a token that is a prefix of the real one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-token' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('accepts the configured token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it('leaves /health reachable without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })
})
