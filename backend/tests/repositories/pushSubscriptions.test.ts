import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  savePushSubscription,
} from '../../src/repositories/pushSubscriptions.js'

const SUB = {
  endpoint: 'https://push.example.com/abc123',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
}

describe('push subscriptions repository', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('saves a subscription and lists it back', async () => {
    const saved = await savePushSubscription(SUB)

    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved.endpoint).toBe(SUB.endpoint)
    expect(saved.p256dh).toBe(SUB.p256dh)
    expect(saved.auth).toBe(SUB.auth)
    expect(saved.createdAt).toBeInstanceOf(Date)
    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('upserts on endpoint rather than creating a duplicate', async () => {
    const first = await savePushSubscription(SUB)
    const second = await savePushSubscription({ ...SUB, p256dh: 'rotated-key' })

    expect(await listPushSubscriptions()).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(second.p256dh).toBe('rotated-key')
  })

  it('keeps subscriptions for different endpoints separate', async () => {
    await savePushSubscription(SUB)
    await savePushSubscription({ ...SUB, endpoint: 'https://push.example.com/other' })

    expect(await listPushSubscriptions()).toHaveLength(2)
  })

  it('deletes by endpoint and reports whether anything was removed', async () => {
    await savePushSubscription(SUB)

    expect(await deletePushSubscriptionByEndpoint(SUB.endpoint)).toBe(true)
    expect(await deletePushSubscriptionByEndpoint(SUB.endpoint)).toBe(false)
    expect(await listPushSubscriptions()).toEqual([])
  })
})
