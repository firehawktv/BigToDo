import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useCheckInSettingsQuery, useUpdateCheckInSettings } from '../../src/settings/useCheckInSettings.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const SETTINGS = {
  enabled: true,
  activeFrom: '09:00',
  activeTo: '18:00',
  checkInsPerDay: 3,
  timezone: 'UTC',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('useCheckInSettingsQuery', () => {
  it('fetches the current settings', async () => {
    server.use(http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)))

    const { result } = renderHook(() => useCheckInSettingsQuery(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(SETTINGS)
  })
})

describe('useUpdateCheckInSettings', () => {
  it('PATCHes only the changed fields', async () => {
    let receivedBody: unknown = null
    server.use(
      http.patch('/api/check-in-settings', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ...SETTINGS, checkInsPerDay: 5 })
      }),
    )

    const { result } = renderHook(() => useUpdateCheckInSettings(), { wrapper })
    result.current.mutate({ checkInsPerDay: 5 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(receivedBody).toEqual({ checkInsPerDay: 5 })
  })
})
