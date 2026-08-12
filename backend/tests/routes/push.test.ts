import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const sendToAllSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/send.js', () => ({ sendToAllSubscriptions }))

const { closePool } = await import('../../src/db/pool.js')
const { truncateAll } = await import('../helpers/db.js')
const { authHeaders, buildTestApp } = await import('../helpers/app.js')
const { listPushSubscriptions } = await import('../../src/repositories/pushSubscriptions.js')

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
}

describe('push routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    sendToAllSubscriptions.mockReset()
    sendToAllSubscriptions.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 })
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  it('requires auth on every push route', async () => {
    for (const [method, url] of [
      ['GET', '/push/vapid-public-key'],
      ['POST', '/push/subscriptions'],
      ['DELETE', '/push/subscriptions'],
      ['POST', '/push/test'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} })
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it('serves the VAPID public key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/push/vapid-public-key',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    // Asserts on pushConfig().publicKey — the literal is the throwaway test
    // fixture keypair set in tests/setup.ts, not load-bearing on its own.
    expect(response.json().publicKey).toBe(
      'BB-wMT2JNeA0jv5KRzQt4y6TRuCpf6PmXinm5H28bl2kVEbwnzS67aO3PAAuA4w-ZUv2Bm-IjI8wD1aSGbV0DJ8',
    )
  })

  it('stores a subscription in the browser PushSubscription shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().endpoint).toBe(SUBSCRIPTION.endpoint)

    const stored = await listPushSubscriptions()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.p256dh).toBe('p256dh-key')
    expect(stored[0]!.auth).toBe('auth-secret')
  })

  it('is idempotent when the same device resubscribes', async () => {
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })

    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('rejects a malformed subscription', async () => {
    for (const payload of [{}, { endpoint: 'https://x' }, { endpoint: 'https://x', keys: {} }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/push/subscriptions',
        headers: authHeaders(),
        payload,
      })
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })

  it('deletes a subscription by endpoint, and 404s when it is not there', async () => {
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })

    const first = await app.inject({
      method: 'DELETE',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: { endpoint: SUBSCRIPTION.endpoint },
    })
    expect(first.statusCode).toBe(204)

    const second = await app.inject({
      method: 'DELETE',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: { endpoint: SUBSCRIPTION.endpoint },
    })
    expect(second.statusCode).toBe(404)
  })

  it('sends a test notification and reports the outcome', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/push/test',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ sent: 1, pruned: 0, failed: 0 })
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
  })
})
