import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { TaskDetail } from '../../src/tasks/TaskDetail.js'
import type { Task } from '../../src/api/types.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// Mirrors the component's own ISO -> "YYYY-MM-DDTHH:mm" conversion so the
// assertion holds regardless of which timezone the test runs in.
function isoToLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const DUE_AT_ISO = '2026-06-15T14:30:00.000Z'

const TASK: Task = {
  id: '1',
  title: 'Renew passport',
  notes: null,
  status: 'open',
  priority: 'medium',
  dueAt: DUE_AT_ISO,
  estimatedMinutes: null,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: false,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('TaskDetail', () => {
  it('seeds the datetime-local input from a UTC dueAt using local time', async () => {
    renderWithClient(<TaskDetail task={TASK} />)

    const input = screen.getByLabelText(/due/i) as HTMLInputElement
    expect(input.value).toBe(isoToLocalInputValue(DUE_AT_ISO))
  })

  it('round-trips a changed local due date back to UTC ISO-8601 in the PATCH body', async () => {
    let receivedBody: unknown = null
    server.use(
      http.patch('/api/tasks/1', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ...TASK, dueAt: (receivedBody as { dueAt: string }).dueAt })
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<TaskDetail task={TASK} />)

    // Round-trip the seeded value unchanged and confirm it comes back as the
    // exact same UTC instant it started as.
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect((receivedBody as { dueAt: string }).dueAt).toBe(DUE_AT_ISO)
  })

  it('sends a null dueAt when the field is cleared', async () => {
    let receivedBody: unknown = null
    server.use(
      http.patch('/api/tasks/1', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ...TASK, dueAt: null })
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<TaskDetail task={TASK} />)
    const input = screen.getByLabelText(/due/i)
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(receivedBody).not.toBeNull())
    expect((receivedBody as { dueAt: string | null }).dueAt).toBeNull()
  })

  it('shows a visible error when saving fails', async () => {
    server.use(http.patch('/api/tasks/1', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const user = userEvent.setup()

    renderWithClient(<TaskDetail task={TASK} />)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i)
  })
})
