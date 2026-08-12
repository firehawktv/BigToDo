import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { BreakdownModal } from '../../src/tasks/BreakdownModal.js'
import type { Task } from '../../src/api/types.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const TASK: Task = {
  id: 't1',
  title: 'Redesign the website',
  notes: null,
  status: 'open',
  priority: 'medium',
  dueAt: null,
  estimatedMinutes: null,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: true,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('BreakdownModal', () => {
  it('proposes subtasks on open and lets the user edit before saving', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({
          subtasks: [
            { title: 'Collect references', estimatedMinutes: 30 },
            { title: 'Sketch a layout', estimatedMinutes: 60 },
          ],
        }),
      ),
      http.post('/api/tasks/t1/subtasks', async ({ request }) => {
        const body = (await request.json()) as { subtasks: { title: string }[] }
        return HttpResponse.json(
          { tasks: body.subtasks.map((s, i) => ({ id: `s${i}`, title: s.title })) },
          { status: 201 },
        )
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<BreakdownModal task={TASK} onClose={() => {}} />)

    expect(await screen.findByDisplayValue('Collect references')).toBeInTheDocument()
    const firstTitle = screen.getByDisplayValue('Collect references')
    await user.clear(firstTitle)
    await user.type(firstTitle, 'Gather design references')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByDisplayValue('Gather design references')).not.toBeInTheDocument())
  })

  it('lets the user remove a proposed subtask before saving', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({
          subtasks: [
            { title: 'Keep me', estimatedMinutes: 10 },
            { title: 'Remove me', estimatedMinutes: 10 },
          ],
        }),
      ),
      http.post('/api/tasks/t1/subtasks', async ({ request }) => {
        const body = (await request.json()) as { subtasks: unknown[] }
        expect(body.subtasks).toHaveLength(1)
        return HttpResponse.json({ tasks: [] }, { status: 201 })
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<BreakdownModal task={TASK} onClose={() => {}} />)
    await screen.findByDisplayValue('Remove me')
    await user.click(screen.getByRole('button', { name: /remove.*remove me/i }))
    await user.click(screen.getByRole('button', { name: /^save/i }))
  })

  it('shows a retryable message on a 503 rather than a generic error', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({ error: 'Breakdown is unavailable right now' }, { status: 503 }),
      ),
    )

    renderWithClient(<BreakdownModal task={TASK} onClose={() => {}} />)

    expect(await screen.findByText(/try again/i)).toBeInTheDocument()
  })
})
