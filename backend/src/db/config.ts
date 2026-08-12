import { required } from '../env.js'

/**
 * Database-only config, deliberately separate from src/config.ts. Anything
 * that only needs a DB connection (the migration CLI, migration-only
 * tooling, tests that just need `pool`) must not be forced to also validate
 * the app-wide API_TOKEN — that's an unrelated secret used only by HTTP
 * request auth.
 */
export interface DatabaseConfig {
  databaseUrl: string
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return { databaseUrl: required(env, 'DATABASE_URL') }
}

let cached: DatabaseConfig | undefined
export function databaseConfig(): DatabaseConfig {
  return (cached ??= loadDatabaseConfig())
}
