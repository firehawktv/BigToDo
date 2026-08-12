import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { PushSettings } from '../../src/push/PushSettings.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PushSettings', () => {
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
  })

  it('shows a visible error when subscribing fails', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: () => Promise.resolve('granted'),
    } as unknown as typeof Notification
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => Promise.resolve(null) },
        }),
      },
      configurable: true,
    })
    server.use(http.get('/api/push/vapid-public-key', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const user = userEvent.setup()

    renderWithClient(<PushSettings />)
    const subscribeButton = await screen.findByRole('button', { name: /subscribe/i })
    await user.click(subscribeButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to subscribe/i)
  })

  it('shows a visible error when unsubscribing fails', async () => {
    globalThis.Notification = { permission: 'granted' } as unknown as typeof Notification
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: () =>
              Promise.resolve({
                endpoint: 'https://push.example.com/abc',
                unsubscribe: () => Promise.reject(new Error('nope')),
              }),
          },
        }),
      },
      configurable: true,
    })
    const user = userEvent.setup()

    renderWithClient(<PushSettings />)
    const unsubscribeButton = await screen.findByRole('button', { name: /unsubscribe/i })
    await user.click(unsubscribeButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to unsubscribe/i)
  })
})
