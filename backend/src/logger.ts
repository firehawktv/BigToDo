/**
 * The slice of a logger the scheduler and push layers actually use.
 *
 * Structural, so Fastify's `app.log` and `request.log` satisfy it without those
 * modules importing Fastify — a push sender has no business knowing what web
 * framework is in front of it.
 */
export interface Logger {
  info: (obj: unknown, message: string) => void
  warn: (obj: unknown, message: string) => void
}
