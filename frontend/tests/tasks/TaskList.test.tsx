import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { TaskList } from '../../src/tasks/TaskList.js'
import type { Task } from '../../src/api/types.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const TASK: Task = {
  id: '1',
  title: 'Buy milk',
  notes: null,
  status: 'open',
  priority: 'high',
  dueAt: null,
  estimatedMinutes: 10,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: false,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('TaskList', () => {
  it('renders each task title', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [TASK] })))

    renderWithClient(<TaskList />)

    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
  })

  it('shows an empty state with no open tasks', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [] })))

    renderWithClient(<TaskList />)

    expect(await screen.findByText(/nothing (open|to do)/i)).toBeInTheDocument()
  })

  it('marks a task done and it leaves the open list', async () => {
    let currentStatus = 'open'
    server.use(
      http.get('/api/tasks', () =>
        HttpResponse.json({ tasks: currentStatus === 'open' ? [TASK] : [] }),
      ),
      http.patch('/api/tasks/1', () => {
        currentStatus = 'done'
        return HttpResponse.json({ ...TASK, status: 'done' })
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<TaskList />)
    await screen.findByText('Buy milk')
    await user.click(screen.getByRole('checkbox', { name: /buy milk/i }))

    await waitFor(() => expect(screen.queryByText('Buy milk')).not.toBeInTheDocument())
  })

  it('shows a "Break this down?" affordance only when suggestBreakdown is true', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [{ ...TASK, suggestBreakdown: true }] })))

    renderWithClient(<TaskList />)

    expect(await screen.findByRole('button', { name: /break.*down/i })).toBeInTheDocument()
  })

  it('surfaces an error state when the fetch fails', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))

    renderWithClient(<TaskList />)

    expect(await screen.findByText(/something went wrong|couldn't load/i)).toBeInTheDocument()
  })
})
