import { describe, expect, it } from 'vitest'
import { loadDatabaseConfig } from '../../src/db/config.js'

const validEnv = { DATABASE_URL: 'postgres://todo:todo@localhost:5433/todo' }

describe('loadDatabaseConfig', () => {
  it('returns databaseUrl from a valid environment', () => {
    const dbConfig = loadDatabaseConfig(validEnv)
    expect(dbConfig).toEqual({ databaseUrl: validEnv.DATABASE_URL })
  })

  it('succeeds when API_TOKEN is absent entirely', () => {
    const env = { DATABASE_URL: validEnv.DATABASE_URL }
    expect('API_TOKEN' in env).toBe(false)
    const dbConfig = loadDatabaseConfig(env)
    expect(dbConfig.databaseUrl).toBe(validEnv.DATABASE_URL)
  })

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadDatabaseConfig({})).toThrow(/DATABASE_URL/)
  })
})
