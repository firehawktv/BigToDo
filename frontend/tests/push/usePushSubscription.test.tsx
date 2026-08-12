import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { usePushSubscriptionStatus } from '../../src/push/usePushSubscription.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const FAKE_SUBSCRIPTION = {
  endpoint: 'https://push.example.com/abc',
  toJSON: () => ({
    endpoint: 'https://push.example.com/abc',
    keys: { p256dh: 'key', auth: 'secret' },
  }),
}

describe('usePushSubscriptionStatus', () => {
  let originalNotification: typeof Notification | undefined
  let originalServiceWorker: typeof navigator.serviceWorker | undefined

  beforeEach(() => {
    originalNotification = globalThis.Notification
    originalServiceWorker = navigator.serviceWorker
  })

  afterEach(() => {
    if (originalNotification !== undefined) globalThis.Notification = originalNotification
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it('reports "unsupported" when the Push API is unavailable', async () => {
    // @ts-expect-error deliberately removing browser support for the test
    delete globalThis.Notification
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('unsupported'))
  })

  it('reports "unsubscribed" when supported but no subscription exists yet', async () => {
    globalThis.Notification = { permission: 'default' } as unknown as typeof Notification
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => Promise.resolve(null) },
        }),
      },
      configurable: true,
    })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
  })

  it('subscribe() posts the browser subscription JSON to the backend', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: () => Promise.resolve('granted'),
    } as unknown as typeof Notification
    let receivedBody: unknown = null
    server.use(
      http.get('/api/push/vapid-public-key', () => HttpResponse.json({ publicKey: 'test-key' })),
      http.post('/api/push/subscriptions', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ id: '1', endpoint: FAKE_SUBSCRIPTION.endpoint, createdAt: '2026-01-01T00:00:00.000Z' }, { status: 201 })
      }),
    )
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: () => Promise.resolve(null),
            subscribe: () => Promise.resolve(FAKE_SUBSCRIPTION),
          },
        }),
      },
      configurable: true,
    })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
    await result.current.subscribe()

    await waitFor(() => expect(receivedBody).toEqual(FAKE_SUBSCRIPTION.toJSON()))
  })

  it('reports "permission-denied" without calling subscribe when the user declines', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: () => Promise.resolve('denied'),
    } as unknown as typeof Notification
    const subscribeSpy = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => Promise.resolve(null), subscribe: subscribeSpy },
        }),
      },
      configurable: true,
    })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
    await result.current.subscribe()

    expect(subscribeSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.status).toBe('permission-denied'))
  })
})
