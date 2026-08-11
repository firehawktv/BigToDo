import { required } from '../env.js'

export interface AiConfig {
  apiKey: string
  parseModel: string
  breakdownModel: string
  requestTimeoutMs: number
}

/**
 * Model choices come from the product spec: the cheap model runs on every
 * capture, the stronger one only when the user opts into a breakdown.
 */
const DEFAULT_PARSE_MODEL = 'claude-haiku-4-5'
const DEFAULT_BREAKDOWN_MODEL = 'claude-sonnet-5'
const DEFAULT_TIMEOUT_MS = 30_000

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const rawTimeout = env.AI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS)
  const requestTimeoutMs = Number(rawTimeout)
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(`AI_TIMEOUT_MS must be a positive integer, got: ${rawTimeout}`)
  }

  return {
    apiKey: required(env, 'ANTHROPIC_API_KEY'),
    parseModel: env.PARSE_MODEL ?? DEFAULT_PARSE_MODEL,
    breakdownModel: env.BREAKDOWN_MODEL ?? DEFAULT_BREAKDOWN_MODEL,
    requestTimeoutMs,
  }
}

export const aiConfig = loadAiConfig()
