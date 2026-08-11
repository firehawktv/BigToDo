import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, closePool } from './pool.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * Applies every .sql file in migrations/ that has not been applied yet, in
 * filename order. Each file runs inside its own transaction together with the
 * bookkeeping insert, so a failure leaves no half-applied migration behind.
 * Returns the filenames applied during this run.
 */
export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect()
  const applied: string[] = []

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `)

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    )
    const alreadyApplied = new Set(rows.map((row) => row.filename))

    const filenames = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort()

    for (const filename of filenames) {
      if (alreadyApplied.has(filename)) continue

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${filename} failed: ${(error as Error).message}`, {
          cause: error,
        })
      }
      applied.push(filename)
    }

    return applied
  } finally {
    client.release()
  }
}

// CLI entrypoint: `npm run migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const applied = await runMigrations()
    console.log(
      applied.length > 0
        ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
        : 'Database already up to date.',
    )
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await closePool()
  }
}
