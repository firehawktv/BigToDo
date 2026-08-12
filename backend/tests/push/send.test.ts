import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/webPush.js', () => ({
  getWebPush: () => ({ sendNotification }),
}))

const { closePool } = await import('../../src/db/pool.js')
const { setupTestDatabase, truncateAll } = await import('../helpers/db.js')
const {
  listPushSubscriptions,
  savePushSubscription,
} = await import('../../src/repositories/pushSubscriptions.js')
const { sendToAllSubscriptions } = await import('../../src/push/send.js')

/** web-push rejects with an error carrying the push service's status code. */
function pushError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`push failed with ${statusCode}`), { statusCode })
}

describe('sendToAllSubscriptions', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
    sendNotification.mockReset()
    sendNotification.mockResolvedValue(undefined)
  })

  afterAll(async () => {
    await closePool()
  })

  async function seed(...endpoints: string[]) {
    for (const endpoint of endpoints) {
      await savePushSubscription({ endpoint, p256dh: 'key', auth: 'secret' })
    }
  }

  it('sends to every subscription', async () => {
    await seed('https://push.example.com/a', 'https://push.example.com/b')

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 2, pruned: 0, failed: 0 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('sends the payload as JSON with the title, body and url', async () => {
    await seed('https://push.example.com/a')

    await sendToAllSubscriptions({ title: 'Due soon', body: 'Call the dentist', url: '/tasks/1' })

    const payload = JSON.parse(sendNotification.mock.calls[0]![1])
    expect(payload).toEqual({ title: 'Due soon', body: 'Call the dentist', url: '/tasks/1' })
  })

  it('passes the subscription in the shape web-push expects', async () => {
    await seed('https://push.example.com/a')

    await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(sendNotification.mock.calls[0]![0]).toEqual({
      endpoint: 'https://push.example.com/a',
      keys: { p256dh: 'key', auth: 'secret' },
    })
  })

  it('prunes a subscription the push service reports as gone (410)', async () => {
    await seed('https://push.example.com/dead')
    sendNotification.mockRejectedValue(pushError(410))

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 0, pruned: 1, failed: 0 })
    expect(await listPushSubscriptions()).toEqual([])
  })

  it('prunes on 404 as well', async () => {
    await seed('https://push.example.com/missing')
    sendNotification.mockRejectedValue(pushError(404))

    await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(await listPushSubscriptions()).toEqual([])
  })

  it('keeps a subscription when the failure is transient (500)', async () => {
    await seed('https://push.example.com/flaky')
    sendNotification.mockRejectedValue(pushError(500))

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 })
    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('keeps going after one subscription fails', async () => {
    await seed('https://push.example.com/dead', 'https://push.example.com/live')
    sendNotification
      .mockRejectedValueOnce(pushError(410))
      .mockResolvedValueOnce(undefined)

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 1, pruned: 1, failed: 0 })
    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('never throws, even when every send rejects', async () => {
    await seed('https://push.example.com/a')
    sendNotification.mockRejectedValue(new Error('network down'))

    await expect(sendToAllSubscriptions({ title: 'Hi', body: 'There' })).resolves.toEqual({
      sent: 0,
      pruned: 0,
      failed: 1,
    })
  })

  it('is a no-op when there are no subscriptions', async () => {
    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0 })
    expect(sendNotification).not.toHaveBeenCalled()
  })
})
