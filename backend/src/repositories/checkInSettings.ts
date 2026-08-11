import { pool } from '../db/pool.js'

export interface CheckInSettings {
  enabled: boolean
  /** Local wall-clock time in `timezone`, `HH:MM`. */
  activeFrom: string
  activeTo: string
  checkInsPerDay: number
  /** IANA zone name, e.g. `Europe/London`. */
  timezone: string
  updatedAt: Date
}

interface CheckInSettingsRow {
  enabled: boolean
  active_from: string
  active_to: string
  check_ins_per_day: number
  timezone: string
  updated_at: Date
}

// Postgres renders `time` as HH:MM:SS; the wire contract and the scheduler both
// want HH:MM, and trimming here keeps that conversion in the repository layer.
const COLUMNS = `
  enabled,
  to_char(active_from, 'HH24:MI') AS active_from,
  to_char(active_to, 'HH24:MI') AS active_to,
  check_ins_per_day, timezone, updated_at
`

function mapRow(row: CheckInSettingsRow): CheckInSettings {
  return {
    enabled: row.enabled,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    checkInsPerDay: row.check_ins_per_day,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  }
}

export async function getCheckInSettings(): Promise<CheckInSettings> {
  const { rows } = await pool.query<CheckInSettingsRow>(
    `SELECT ${COLUMNS} FROM check_in_settings WHERE id = true`,
  )
  if (rows[0] === undefined) {
    // Seeded by migration 003 and re-seeded by the test helper; a missing row
    // means someone deleted it, which no code path should ever do.
    throw new Error('check_in_settings row is missing')
  }
  return mapRow(rows[0])
}

export interface UpdateCheckInSettingsInput {
  enabled?: boolean
  activeFrom?: string
  activeTo?: string
  checkInsPerDay?: number
  timezone?: string
}

const UPDATABLE_COLUMNS: Record<keyof UpdateCheckInSettingsInput, string> = {
  enabled: 'enabled',
  activeFrom: 'active_from',
  activeTo: 'active_to',
  checkInsPerDay: 'check_ins_per_day',
  timezone: 'timezone',
}

export async function updateCheckInSettings(
  patch: UpdateCheckInSettingsInput,
): Promise<CheckInSettings> {
  const assignments: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = patch[key as keyof UpdateCheckInSettingsInput]
    if (value === undefined) continue
    values.push(value)
    assignments.push(`${column} = $${values.length}`)
  }

  if (assignments.length === 0) return getCheckInSettings()

  assignments.push('updated_at = now()')
  const { rows } = await pool.query<CheckInSettingsRow>(
    `UPDATE check_in_settings SET ${assignments.join(', ')}
     WHERE id = true
     RETURNING ${COLUMNS.replace(/\s+/g, ' ')}`,
    values,
  )
  return mapRow(rows[0]!)
}

export async function recordCheckIn(): Promise<void> {
  await pool.query('INSERT INTO check_in_events DEFAULT VALUES')
}

/**
 * Counts check-ins sent on a given local calendar date. The comparison happens
 * in Postgres so the zone conversion is done once, by the database, rather than
 * by pulling every row into Node.
 */
export async function countCheckInsOnLocalDate(
  localDate: string,
  timezone: string,
): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM check_in_events
     WHERE (sent_at AT TIME ZONE $2)::date = $1::date`,
    [localDate, timezone],
  )
  return rows[0]?.count ?? 0
}
