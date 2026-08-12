import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { CheckInSettingsForm } from '../../src/settings/CheckInSettingsForm.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const SETTINGS = {
  enabled: true,
  activeFrom: '09:00',
  activeTo: '18:00',
  checkInsPerDay: 3,
  timezone: 'UTC',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('CheckInSettingsForm', () => {
  it('loads and displays the current settings', async () => {
    server.use(http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)))

    renderWithClient(<CheckInSettingsForm />)

    expect(await screen.findByDisplayValue('09:00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
  })

  it('rejects saving when the entered window is invalid client-side, before hitting the API', async () => {
    server.use(http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)))
    let saveWasCalled = false
    server.use(
      http.patch('/api/check-in-settings', () => {
        saveWasCalled = true
        return HttpResponse.json(SETTINGS)
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<CheckInSettingsForm />)
    const activeTo = await screen.findByLabelText(/until|to/i)
    await user.clear(activeTo)
    await user.type(activeTo, '08:00') // before activeFrom's 09:00
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.getByText(/before|after|invalid/i)).toBeInTheDocument()
    expect(saveWasCalled).toBe(false)
  })

  it('saves a valid change', async () => {
    server.use(
      http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)),
      http.patch('/api/check-in-settings', () => HttpResponse.json({ ...SETTINGS, checkInsPerDay: 5 })),
    )
    const user = userEvent.setup()

    renderWithClient(<CheckInSettingsForm />)
    const countInput = await screen.findByLabelText(/how many|times per day/i)
    await user.clear(countInput)
    await user.type(countInput, '5')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument())
  })
})
