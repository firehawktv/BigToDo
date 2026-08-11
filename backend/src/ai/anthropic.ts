import Anthropic from '@anthropic-ai/sdk'
import { aiConfig } from './config.js'

/**
 * Shared SDK client. `timeout` is in MILLISECONDS in the TypeScript SDK
 * (the Python SDK uses seconds — don't copy a number across from a Python
 * example). maxRetries covers 429s and 5xx with the SDK's own backoff.
 */
export const anthropic = new Anthropic({
  apiKey: aiConfig.apiKey,
  timeout: aiConfig.requestTimeoutMs,
  maxRetries: 2,
})
