import { http, HttpResponse } from 'msw'

/**
 * Default handlers for the happy path of every endpoint this app calls.
 * Individual tests override one handler at a time with `server.use(...)`
 * for the case they're actually testing — this file is the baseline, not
 * an attempt to model every response shape.
 */
export const handlers = [
  http.get('/api/health', () => HttpResponse.json({ status: 'ok' })),
]
