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
  await pool.query(
    'TRUNCATE tasks, capture_batches, push_subscriptions, check_in_events RESTART IDENTITY CASCADE',
  )
  // check_in_settings is a seeded single-row table; reset it to defaults rather
  // than truncating it away, because every read assumes the row is there.
  await pool.query(`
    UPDATE check_in_settings
    SET enabled = true, active_from = '09:00', active_to = '18:00',
        check_ins_per_day = 3, timezone = 'UTC', updated_at = now()
  `)
}
