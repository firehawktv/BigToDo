import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import {
  countCheckInsOnLocalDate,
  getCheckInSettings,
  recordCheckIn,
  updateCheckInSettings,
} from '../../src/repositories/checkInSettings.js'

describe('check-in settings repository', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('returns the seeded defaults', async () => {
    const settings = await getCheckInSettings()

    expect(settings.enabled).toBe(true)
    expect(settings.activeFrom).toBe('09:00')
    expect(settings.activeTo).toBe('18:00')
    expect(settings.checkInsPerDay).toBe(3)
    expect(settings.timezone).toBe('UTC')
  })

  it('always has exactly one row after truncation', async () => {
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM check_in_settings',
    )
    expect(rows[0]!.count).toBe(1)
  })

  it('updates only the fields present in the patch', async () => {
    const updated = await updateCheckInSettings({ checkInsPerDay: 5 })

    expect(updated.checkInsPerDay).toBe(5)
    expect(updated.activeFrom).toBe('09:00')
    expect(updated.enabled).toBe(true)
  })

  it('round-trips a timezone and a window', async () => {
    const updated = await updateCheckInSettings({
      timezone: 'Europe/London',
      activeFrom: '08:30',
      activeTo: '20:00',
      enabled: false,
    })

    expect(updated.timezone).toBe('Europe/London')
    expect(updated.activeFrom).toBe('08:30')
    expect(updated.activeTo).toBe('20:00')
    expect(updated.enabled).toBe(false)
  })

  it('returns current settings unchanged for an empty patch', async () => {
    const before = await getCheckInSettings()
    const after = await updateCheckInSettings({})

    expect(after.checkInsPerDay).toBe(before.checkInsPerDay)
  })

  it('counts check-ins recorded on a given local date', async () => {
    await recordCheckIn()
    await recordCheckIn()

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
    expect(await countCheckInsOnLocalDate(today, 'UTC')).toBe(2)
    expect(await countCheckInsOnLocalDate('1999-01-01', 'UTC')).toBe(0)
  })
})
