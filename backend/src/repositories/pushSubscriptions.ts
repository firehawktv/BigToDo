import { pool } from '../db/pool.js'

export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: Date
}

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: Date
}

const COLUMNS = 'id, endpoint, p256dh, auth, created_at'

function mapRow(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
  }
}

export interface SavePushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Upserts on endpoint. A browser that resubscribes the same device reports the
 * same endpoint with possibly rotated keys, so inserting blindly would
 * accumulate duplicates and send the same notification several times.
 */
export async function savePushSubscription(
  input: SavePushSubscriptionInput,
): Promise<PushSubscriptionRecord> {
  const { rows } = await pool.query<PushSubscriptionRow>(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
     RETURNING ${COLUMNS}`,
    [input.endpoint, input.p256dh, input.auth],
  )
  return mapRow(rows[0]!)
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const { rows } = await pool.query<PushSubscriptionRow>(
    `SELECT ${COLUMNS} FROM push_subscriptions ORDER BY created_at ASC`,
  )
  return rows.map(mapRow)
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
  return (result.rowCount ?? 0) > 0
}
