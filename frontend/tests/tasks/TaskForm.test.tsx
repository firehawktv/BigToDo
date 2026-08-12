import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { TaskForm } from '../../src/tasks/TaskForm.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskForm', () => {
  it('submits a title and calls onCreated with the new task', async () => {
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json(
          { id: '1', title: 'Call the dentist', status: 'open' /* ...rest omitted, real component reads full Task */ },
          { status: 201 },
        ),
      ),
    )
    const onCreated = vi.fn()
    const user = userEvent.setup()

    renderWithClient(<TaskForm onCreated={onCreated} />)
    await user.type(screen.getByLabelText(/title/i), 'Call the dentist')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  })

  it('does not submit a blank title', async () => {
    const onCreated = vi.fn()
    const user = userEvent.setup()

    renderWithClient(<TaskForm onCreated={onCreated} />)
    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(onCreated).not.toHaveBeenCalled()
  })

  it('clears the input after a successful submission', async () => {
    server.use(http.post('/api/tasks', () => HttpResponse.json({ id: '1', title: 'x' }, { status: 201 })))
    const user = userEvent.setup()

    renderWithClient(<TaskForm onCreated={() => {}} />)
    const input = screen.getByLabelText(/title/i)
    await user.type(input, 'Buy milk')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await vi.waitFor(() => expect(input).toHaveValue(''))
  })
})
