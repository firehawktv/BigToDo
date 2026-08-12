import { ApiError } from './errors.js'
import { clearAuthToken, getAuthToken, notifyTokenChanged } from '../auth/useAuthToken.js'

/**
 * All requests go through /api/... — same-origin in production (Caddy
 * proxies it to the backend) and proxied by Vite's dev server in
 * development (see vite.config.ts). Never hardcode a cross-origin URL here;
 * CORS configuration is deliberately out of scope for this plan.
 */
const API_BASE = '/api'

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(init.headers)
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    // A network failure (offline, DNS, connection refused) never reaches the
    // backend at all — there is no status code, so this is not an ApiError
    // in the usual "the server said no" sense, but callers should still be
    // able to catch one error type rather than branch on TypeError vs ApiError.
    throw new ApiError(0, null, 'Network request failed')
  }

  if (response.status === 401) {
    // A 401 anywhere means the stored token is wrong (never valid, or
    // rotated server-side). Clearing it here — rather than in every caller —
    // and notifying subscribers is what sends the whole app back to the
    // token-entry screen; see TokenGate's useAuthToken() subscription.
    clearAuthToken()
    notifyTokenChanged()
  }

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON error body (e.g. a proxy's own HTML error page) — body
      // stays null, status is still meaningful to the caller.
    }
    throw new ApiError(response.status, body)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
