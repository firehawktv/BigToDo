import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool, closePool } from '../src/db/pool.js'
import { runMigrations } from '../src/db/migrate.js'

describe('runMigrations', () => {
  beforeAll(async () => {
    // Start from a genuinely empty database so the test proves migrations
    // build the schema from nothing, not just that they already ran.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  })

  afterAll(async () => {
    await closePool()
  })

  it('applies every pending migration and reports which ones ran', async () => {
    const applied = await runMigrations()
    expect(applied).toContain('001_init.sql')
  })

  it('creates the tasks and capture_batches tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    )
    const names = rows.map((row) => row.table_name)
    expect(names).toContain('tasks')
    expect(names).toContain('capture_batches')
    expect(names).toContain('schema_migrations')
  })

  it('orders the priority enum low < medium < high so ORDER BY priority DESC ranks high first', async () => {
    const { rows } = await pool.query<{ priority: string }>(
      `SELECT unnest(enum_range(NULL::task_priority))::text AS priority`,
    )
    expect(rows.map((row) => row.priority)).toEqual(['low', 'medium', 'high'])
  })

  it('cascades deletes from a parent task to its subtasks', async () => {
    const { rows: parents } = await pool.query<{ id: string }>(
      `INSERT INTO tasks (title) VALUES ('parent') RETURNING id`,
    )
    const parentId = parents[0]!.id
    await pool.query(`INSERT INTO tasks (title, parent_task_id) VALUES ('child', $1)`, [parentId])

    await pool.query(`DELETE FROM tasks WHERE id = $1`, [parentId])

    const { rows: remaining } = await pool.query(`SELECT id FROM tasks`)
    expect(remaining).toHaveLength(0)
  })

  it('is a no-op when run a second time', async () => {
    const applied = await runMigrations()
    expect(applied).toEqual([])
  })
})
