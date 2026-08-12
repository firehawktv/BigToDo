import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useCapture, useReparseCaptureBatch } from '../../src/capture/useCapture.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useCapture', () => {
  it('returns a shortlist response for a time-available query', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json({ type: 'shortlist', minutes: 20, tasks: [] }),
      ),
    )

    const { result } = renderHook(() => useCapture(), { wrapper })
    result.current.mutate('I have 20 minutes')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ type: 'shortlist', minutes: 20, tasks: [] })
  })

  it('returns a batch response for a normal capture', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: { id: 'b1', rawText: 'buy milk', parseStatus: 'parsed', parseError: null, createdAt: '2026-01-01T00:00:00.000Z' },
            tasks: [],
          },
          { status: 201 },
        ),
      ),
    )

    const { result } = renderHook(() => useCapture(), { wrapper })
    result.current.mutate('buy milk')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.type).toBe('batch')
  })

  it('surfaces a failed parse in the batch response rather than throwing', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: { id: 'b1', rawText: 'buy milk', parseStatus: 'failed', parseError: 'Claude request failed', createdAt: '2026-01-01T00:00:00.000Z' },
            tasks: [{ id: 't1', title: 'buy milk', source: 'manual' }],
          },
          { status: 201 },
        ),
      ),
    )

    const { result } = renderHook(() => useCapture(), { wrapper })
    result.current.mutate('buy milk')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // A failed parse is still a 201 success at the HTTP level — the
    // mutation must not treat parseStatus:'failed' as a rejected mutation.
    expect(result.current.data?.type === 'batch' && result.current.data.batch.parseStatus).toBe('failed')
  })
})

describe('useReparseCaptureBatch', () => {
  it('POSTs to the retry endpoint for the given batch id', async () => {
    let hitPath = ''
    server.use(
      http.post('/api/capture-batches/:id/parse', ({ params }) => {
        hitPath = params.id as string
        return HttpResponse.json({
          batch: { id: 'b1', rawText: 'x', parseStatus: 'parsed', parseError: null, createdAt: '2026-01-01T00:00:00.000Z' },
          tasks: [],
        })
      }),
    )

    const { result } = renderHook(() => useReparseCaptureBatch(), { wrapper })
    result.current.mutate('b1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(hitPath).toBe('b1')
  })
})
