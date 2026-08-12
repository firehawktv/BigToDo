import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { apiFetch } from '../../src/api/client.js'
import { ApiError } from '../../src/api/errors.js'
import { clearAuthToken, setAuthToken } from '../../src/auth/useAuthToken.js'

describe('apiFetch', () => {
  beforeEach(() => {
    setAuthToken('test-token-0123456789abcdef0123456789')
  })

  it('attaches the bearer token to every request', async () => {
    let receivedAuth: string | null = null
    server.use(
      http.get('/api/tasks', ({ request }) => {
        receivedAuth = request.headers.get('authorization')
        return HttpResponse.json({ tasks: [] })
      }),
    )

    await apiFetch('/tasks')

    expect(receivedAuth).toBe('Bearer test-token-0123456789abcdef0123456789')
  })

  it('returns the parsed JSON body on success', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [{ id: '1' }] })))

    const result = await apiFetch<{ tasks: unknown[] }>('/tasks')

    expect(result.tasks).toHaveLength(1)
  })

  it('throws ApiError with the status and parsed error body on a 4xx', async () => {
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json({ error: 'title must not be blank' }, { status: 400 }),
      ),
    )

    await expect(apiFetch('/tasks', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 400,
      body: { error: 'title must not be blank' },
    })
  })

  it('clears the stored token and rejects on a 401', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })))

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ status: 401 })

    expect(localStorage.getItem('todo:apiToken')).toBeNull()
  })

  it('throws ApiError on a network failure with no response, rather than an unhandled rejection type', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.error()))

    await expect(apiFetch('/tasks')).rejects.toBeInstanceOf(ApiError)
  })

  afterEach(() => {
    setAuthToken('test-token-0123456789abcdef0123456789') // restore for later tests
  })
})

describe('useAuthToken helpers', () => {
  afterEach(() => {
    setAuthToken('test-token-0123456789abcdef0123456789')
  })

  it('round-trips a token through localStorage', () => {
    setAuthToken('abc123')
    expect(localStorage.getItem('todo:apiToken')).toBe('abc123')
  })

  it('returns null when nothing is stored', () => {
    clearAuthToken()
    expect(localStorage.getItem('todo:apiToken')).toBeNull()
  })
})
