import { AiUnavailableError } from './errors.js'

/** The subset of a Messages API response this module reads. */
export interface ClaudeResponseLike {
  stop_reason?: string
  content?: unknown[]
}

/**
 * Pulls the structured-output JSON out of a Messages API response.
 *
 * Every failure mode becomes an AiUnavailableError with a machine-readable
 * reason, so callers can fall back gracefully instead of 500ing. `what`
 * describes the attempted action for the refusal message, e.g. "parse this
 * input". Returns `unknown` — validating the payload's shape is the caller's
 * job, because each call site expects a different one.
 */
export function readStructuredJson(response: ClaudeResponseLike, what: string): unknown {
  if (response.stop_reason === 'refusal') {
    throw new AiUnavailableError(`Claude declined to ${what}`, 'refusal')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiUnavailableError('Claude response was truncated', 'max_tokens')
  }

  const blocks = Array.isArray(response.content) ? response.content : []
  const textBlock = blocks.find(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text',
  )
  if (textBlock === undefined) {
    throw new AiUnavailableError('Claude response contained no text block', 'no_text_block')
  }

  try {
    return JSON.parse(textBlock.text)
  } catch (error) {
    throw new AiUnavailableError('Claude response was not valid JSON', 'invalid_json', {
      cause: error,
    })
  }
}
