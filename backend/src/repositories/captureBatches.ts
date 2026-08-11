import { pool } from '../db/pool.js'

export type CaptureParseStatus = 'pending' | 'parsed' | 'failed'

export interface CaptureBatch {
  id: string
  rawText: string
  parseStatus: CaptureParseStatus
  parseError: string | null
  createdAt: Date
}

interface CaptureBatchRow {
  id: string
  raw_text: string
  parse_status: CaptureParseStatus
  parse_error: string | null
  created_at: Date
}

const COLUMNS = 'id, raw_text, parse_status, parse_error, created_at'

function mapRow(row: CaptureBatchRow): CaptureBatch {
  return {
    id: row.id,
    rawText: row.raw_text,
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    createdAt: row.created_at,
  }
}

export async function createCaptureBatch(rawText: string): Promise<CaptureBatch> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `INSERT INTO capture_batches (raw_text)
     VALUES ($1)
     RETURNING ${COLUMNS}`,
    [rawText],
  )
  return mapRow(rows[0]!)
}

export async function getCaptureBatch(id: string): Promise<CaptureBatch | null> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `SELECT ${COLUMNS} FROM capture_batches WHERE id = $1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}

/**
 * Records the outcome of a parse attempt. Moving to any status other than
 * `failed` clears the stored error, so a successful retry doesn't leave a
 * stale explanation behind for the UI to show.
 */
export async function setCaptureBatchParseStatus(
  id: string,
  status: CaptureParseStatus,
  parseError?: string,
): Promise<CaptureBatch | null> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `UPDATE capture_batches
     SET parse_status = $1::capture_parse_status,
         parse_error = CASE WHEN $1::capture_parse_status = 'failed' THEN $2 ELSE NULL END
     WHERE id = $3
     RETURNING ${COLUMNS}`,
    [status, parseError ?? null, id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}
