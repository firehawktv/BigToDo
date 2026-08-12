import Anthropic from '@anthropic-ai/sdk'
import { aiConfig } from './config.js'

/**
 * Shared SDK client. `timeout` is in MILLISECONDS in the TypeScript SDK
 * (the Python SDK uses seconds — don't copy a number across from a Python
 * example). maxRetries covers 429s and 5xx with the SDK's own backoff.
 */
let cached: Anthropic | undefined

/**
 * Returns the shared SDK client, constructing it (and reading aiConfig) on
 * first call rather than at import time. Without this, importing this
 * module — which happens transitively via app.ts's route registration —
 * would force ANTHROPIC_API_KEY validation as a side effect of import,
 * exactly the failure mode this whole refactor exists to eliminate.
 */
export function getAnthropic(): Anthropic {
  if (!cached) {
    cached = new Anthropic({
      apiKey: aiConfig().apiKey,
      timeout: aiConfig().requestTimeoutMs,
      maxRetries: 2,
    })
  }
  return cached
}
