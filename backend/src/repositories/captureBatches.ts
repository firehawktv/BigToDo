import { pool } from '../db/pool.js'

export interface CaptureBatch {
  id: string
  rawText: string
  createdAt: Date
}

interface CaptureBatchRow {
  id: string
  raw_text: string
  created_at: Date
}

function mapRow(row: CaptureBatchRow): CaptureBatch {
  return { id: row.id, rawText: row.raw_text, createdAt: row.created_at }
}

export async function createCaptureBatch(rawText: string): Promise<CaptureBatch> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `INSERT INTO capture_batches (raw_text)
     VALUES ($1)
     RETURNING id, raw_text, created_at`,
    [rawText],
  )
  return mapRow(rows[0]!)
}

export async function getCaptureBatch(id: string): Promise<CaptureBatch | null> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `SELECT id, raw_text, created_at FROM capture_batches WHERE id = $1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}
