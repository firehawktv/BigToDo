import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { CaptureBox } from '../../src/capture/CaptureBox.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CaptureBox', () => {
  it('shows a shortlist result for a time-available query', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json({
          type: 'shortlist',
          minutes: 20,
          tasks: [{ id: '1', title: 'Quick win', priority: 'high', status: 'open' }],
        }),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'I have 20 minutes')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByText('Quick win')).toBeInTheDocument()
    expect(screen.getByText(/20 minutes/)).toBeInTheDocument()
  })

  it('shows parsed tasks for a normal capture', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: { id: 'b1', rawText: 'buy milk', parseStatus: 'parsed', parseError: null, createdAt: '2026-01-01T00:00:00.000Z' },
            tasks: [{ id: 't1', title: 'Buy milk', priority: 'medium', status: 'open' }],
          },
          { status: 201 },
        ),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
  })

  it('shows a retry affordance and the preserved input when parsing fails', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: {
              id: 'b1',
              rawText: 'buy milk\ncall dentist',
              parseStatus: 'failed',
              parseError: 'Claude request failed',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            tasks: [{ id: 't1', title: 'buy milk', priority: 'medium', status: 'open', notes: 'buy milk\ncall dentist' }],
          },
          { status: 201 },
        ),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk\ncall dentist')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
    // Input is never lost: the fallback task carrying the dump is visible.
    expect(screen.getByText('buy milk')).toBeInTheDocument()
  })

  it('shows a visible error when capture fails', async () => {
    server.use(http.post('/api/capture', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i)
  })

  it('replaces the failure banner with newly parsed tasks after a successful retry', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: {
              id: 'b1',
              rawText: 'buy milk',
              parseStatus: 'failed',
              parseError: 'Claude request failed',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            tasks: [{ id: 't1', title: 'buy milk', priority: 'medium', status: 'open', notes: 'buy milk' }],
          },
          { status: 201 },
        ),
      ),
      http.post('/api/capture-batches/b1/parse', () =>
        HttpResponse.json({
          batch: {
            id: 'b1',
            rawText: 'buy milk',
            parseStatus: 'parsed',
            parseError: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          tasks: [{ id: 't2', title: 'Buy milk', priority: 'medium', status: 'open' }],
        }),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    const retryButton = await screen.findByRole('button', { name: /retry/i })
    await user.click(retryButton)

    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
    expect(screen.queryByText(/couldn't parse/i)).not.toBeInTheDocument()
  })

  it('shows a visible error when a retry itself fails', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: {
              id: 'b1',
              rawText: 'buy milk',
              parseStatus: 'failed',
              parseError: 'Claude request failed',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            tasks: [{ id: 't1', title: 'buy milk', priority: 'medium', status: 'open', notes: 'buy milk' }],
          },
          { status: 201 },
        ),
      ),
      http.post('/api/capture-batches/b1/parse', () => HttpResponse.json({ error: 'still broken' }, { status: 500 })),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    const retryButton = await screen.findByRole('button', { name: /retry/i })
    await user.click(retryButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(/still broken/i)
  })

  it('clears the input after a successful submission', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json({ type: 'shortlist', minutes: 5, tasks: [] }),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    const input = screen.getByRole('textbox')
    await user.type(input, 'I have 5 minutes')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    await screen.findByText(/5 minutes/)
    expect(input).toHaveValue('')
  })
})
