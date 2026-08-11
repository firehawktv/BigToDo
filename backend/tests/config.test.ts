import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const validEnv = {
  DATABASE_URL: 'postgres://todo:todo@localhost:5433/todo',
  API_TOKEN: 'a'.repeat(32),
}

describe('loadConfig', () => {
  it('returns a typed config from a valid environment', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000', HOST: '127.0.0.1' })
    expect(config).toEqual({
      databaseUrl: 'postgres://todo:todo@localhost:5433/todo',
      apiToken: 'a'.repeat(32),
      port: 4000,
      host: '127.0.0.1',
      logLevel: 'info',
    })
  })

  it('applies defaults for optional values', () => {
    const config = loadConfig(validEnv)
    expect(config.port).toBe(3000)
    expect(config.host).toBe('0.0.0.0')
    expect(config.logLevel).toBe('info')
  })

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ API_TOKEN: 'a'.repeat(32) })).toThrow(/DATABASE_URL/)
  })

  it('throws when API_TOKEN is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow(/API_TOKEN/)
  })

  it('rejects a short API_TOKEN so a guessable token cannot ship', () => {
    expect(() => loadConfig({ ...validEnv, API_TOKEN: 'short' })).toThrow(/at least 32/)
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/)
  })
})
