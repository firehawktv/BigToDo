export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Derives a human-readable message from a mutation error for display in a
 * `role="alert"` element. Prefers the backend's own `{ error: string }` body
 * shape when present, otherwise falls back to a caller-supplied generic
 * message — used consistently across every mutation error state added in
 * this fix wave.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiError &&
    error.body !== null &&
    typeof error.body === 'object' &&
    'error' in error.body &&
    typeof (error.body as { error: unknown }).error === 'string'
  ) {
    return (error.body as { error: string }).error
  }
  return fallback
}
