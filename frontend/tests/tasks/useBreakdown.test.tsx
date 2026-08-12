import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useProposeBreakdown, useSaveSubtasks } from '../../src/tasks/useBreakdown.js'
import { ApiError } from '../../src/api/errors.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useProposeBreakdown', () => {
  it('returns the proposed subtasks', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({ subtasks: [{ title: 'Collect references', estimatedMinutes: 30 }] }),
      ),
    )

    const { result } = renderHook(() => useProposeBreakdown(), { wrapper })
    result.current.mutate('t1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ title: 'Collect references', estimatedMinutes: 30 }])
  })

  it('surfaces a 503 as a rejected mutation with the ApiError status intact', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({ error: 'Breakdown is unavailable right now' }, { status: 503 }),
      ),
    )

    const { result } = renderHook(() => useProposeBreakdown(), { wrapper })
    result.current.mutate('t1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).status).toBe(503)
  })
})

describe('useSaveSubtasks', () => {
  it('POSTs the edited list and returns the created tasks', async () => {
    server.use(
      http.post('/api/tasks/t1/subtasks', async ({ request }) => {
        const body = (await request.json()) as { subtasks: unknown[] }
        return HttpResponse.json(
          { tasks: body.subtasks.map((_, i) => ({ id: `s${i}`, title: 'x' })) },
          { status: 201 },
        )
      }),
    )

    const { result } = renderHook(() => useSaveSubtasks(), { wrapper })
    result.current.mutate({
      taskId: 't1',
      subtasks: [{ title: 'Step one', estimatedMinutes: 15 }],
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })
})
