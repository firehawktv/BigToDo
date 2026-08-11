import { describe, expect, it } from 'vitest'
import { loadAiConfig } from '../../src/ai/config.js'
import { AiUnavailableError } from '../../src/ai/errors.js'

const validEnv = { ANTHROPIC_API_KEY: 'sk-ant-test-key' }

describe('loadAiConfig', () => {
  it('defaults to the models the product spec chose', () => {
    const config = loadAiConfig(validEnv)
    expect(config.parseModel).toBe('claude-haiku-4-5')
    expect(config.breakdownModel).toBe('claude-sonnet-5')
  })

  it('defaults the request timeout to 30 seconds', () => {
    expect(loadAiConfig(validEnv).requestTimeoutMs).toBe(30_000)
  })

  it('allows overriding the models and timeout', () => {
    const config = loadAiConfig({
      ...validEnv,
      PARSE_MODEL: 'claude-sonnet-5',
      BREAKDOWN_MODEL: 'claude-opus-5',
      AI_TIMEOUT_MS: '5000',
    })
    expect(config.parseModel).toBe('claude-sonnet-5')
    expect(config.breakdownModel).toBe('claude-opus-5')
    expect(config.requestTimeoutMs).toBe(5000)
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadAiConfig({})).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('rejects a non-numeric timeout', () => {
    expect(() => loadAiConfig({ ...validEnv, AI_TIMEOUT_MS: 'soon' })).toThrow(/AI_TIMEOUT_MS/)
  })

  it('rejects a zero or negative timeout', () => {
    expect(() => loadAiConfig({ ...validEnv, AI_TIMEOUT_MS: '0' })).toThrow(/AI_TIMEOUT_MS/)
  })
})

describe('AiUnavailableError', () => {
  it('carries a machine-readable reason and preserves the cause', () => {
    const cause = new Error('socket hang up')
    const error = new AiUnavailableError('parse failed', 'network', { cause })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AiUnavailableError')
    expect(error.reason).toBe('network')
    expect(error.cause).toBe(cause)
  })
})
