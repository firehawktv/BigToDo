import { pool } from '../../src/db/pool.js'
import { runMigrations } from '../../src/db/migrate.js'

let migrated: Promise<unknown> | undefined

/** Migrates the test database once per process; safe to await in every beforeAll. */
export async function setupTestDatabase(): Promise<void> {
  migrated ??= runMigrations()
  await migrated
}

/** Wipes all data (but keeps the schema) so each test starts from a clean slate. */
export async function truncateAll(): Promise<void> {
  await pool.query('TRUNCATE tasks, capture_batches RESTART IDENTITY CASCADE')
}
