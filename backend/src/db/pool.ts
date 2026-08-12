import pg from 'pg'
import { databaseConfig } from './config.js'

export const pool = new pg.Pool({
  connectionString: databaseConfig().databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
})

// pg's Pool emits 'error' on an *idle* client when the backend drops it out from
// under us (e.g. a Postgres restart, pg_terminate_backend, a proxy reaping an idle
// connection). EventEmitter throws if an 'error' event has no listener, which would
// crash this unattended, VPS-hosted process on a mere DB blip. Do not delete this —
// an "empty" handler here is load-bearing, not dead code.
pool.on('error', (error) => {
  console.error('Unexpected error on idle Postgres client', error)
})

export async function closePool(): Promise<void> {
  await pool.end()
}
