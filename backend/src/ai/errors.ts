/**
 * Raised when a Claude call cannot produce a usable result — network failure,
 * timeout, rate limit, refusal, truncation, or a response that doesn't match
 * the schema we asked for. Routes catch this and fall back gracefully rather
 * than 500ing, because the user's raw input is already saved by that point.
 */
export class AiUnavailableError extends Error {
  readonly reason: string

  constructor(message: string, reason: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AiUnavailableError'
    this.reason = reason
  }
}
