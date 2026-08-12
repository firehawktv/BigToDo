import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useCreateTask, useDeleteTask, useTasksQuery, useUpdateTask } from '../../src/tasks/useTasks.js'
import type { Task } from '../../src/api/types.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const SAMPLE_TASK: Task = {
  id: '1',
  title: 'Buy milk',
  notes: null,
  status: 'open',
  priority: 'medium',
  dueAt: null,
  estimatedMinutes: null,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: false,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('useTasksQuery', () => {
  it('fetches and returns the task list', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [SAMPLE_TASK] })))

    const { result } = renderHook(() => useTasksQuery(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([SAMPLE_TASK])
  })

  it('passes a status filter through as a query parameter', async () => {
    let receivedUrl = ''
    server.use(
      http.get('/api/tasks', ({ request }) => {
        receivedUrl = request.url
        return HttpResponse.json({ tasks: [] })
      }),
    )

    const { result } = renderHook(() => useTasksQuery({ status: 'done' }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(receivedUrl).toContain('status=done')
  })
})

describe('useCreateTask', () => {
  it('POSTs the input and returns the created task', async () => {
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ ...SAMPLE_TASK, title: (body as { title: string }).title }, { status: 201 })
      }),
    )

    const { result } = renderHook(() => useCreateTask(), { wrapper })
    result.current.mutate({ title: 'Call the dentist' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.title).toBe('Call the dentist')
  })
})

describe('useUpdateTask', () => {
  it('PATCHes only the given task', async () => {
    server.use(
      http.patch('/api/tasks/1', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ ...SAMPLE_TASK, ...(body as object) })
      }),
    )

    const { result } = renderHook(() => useUpdateTask(), { wrapper })
    result.current.mutate({ id: '1', patch: { status: 'done' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.status).toBe('done')
  })
})

describe('useDeleteTask', () => {
  it('DELETEs the task by id', async () => {
    let deletedId = ''
    server.use(
      http.delete('/api/tasks/:id', ({ params }) => {
        deletedId = params.id as string
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { result } = renderHook(() => useDeleteTask(), { wrapper })
    result.current.mutate('1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(deletedId).toBe('1')
  })
})
