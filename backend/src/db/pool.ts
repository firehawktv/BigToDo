import pg from 'pg'
import { databaseConfig } from './config.js'

export const pool = new pg.Pool({
  connectionString: databaseConfig.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
})

export async function closePool(): Promise<void> {
  await pool.end()
}
