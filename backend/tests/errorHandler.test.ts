import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, authHeaders } from './helpers/app.js'

describe('error envelope', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    // A throwaway route that always throws: this test is about the error
    // handler's shape, not about any real route.
    app.get('/boom', { preHandler: app.requireAuth }, async () => {
      throw new Error('raw internal detail that must not leak')
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('shapes an unhandled error as a 500 with a generic { error } body', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom', headers: authHeaders() })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'Internal Server Error' })
    expect(response.body).not.toContain('raw internal detail')
  })
})
