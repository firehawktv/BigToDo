import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAllSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/send.js', () => ({ sendToAllSubscriptions }))

const { closePool } = await import('../../src/db/pool.js')
const { setupTestDatabase, truncateAll } = await import('../helpers/db.js')
const {
  countCheckInsOnLocalDate,
  updateCheckInSettings,
} = await import('../../src/repositories/checkInSettings.js')
const { runCheckInSweep, shouldSendCheckIn } = await import('../../src/scheduler/checkIns.js')
const { zonedNow } = await import('../../src/scheduler/time.js')

const SETTINGS = {
  enabled: true,
  activeFrom: '09:00',
  activeTo: '18:00',
  checkInsPerDay: 3,
  timezone: 'UTC',
  updatedAt: new Date(),
}

/** 2026-08-11 is a Tuesday; the exact date does not matter, only the clock. */
const at = (hhmm: string): Date => new Date(`2026-08-11T${hhmm}:00.000Z`)

describe('shouldSendCheckIn', () => {
  const base = { settings: SETTINGS, sentToday: 0, tickMinutes: 15, random: () => 0 }

  it('never fires when check-ins are disabled', () => {
    expect(
      shouldSendCheckIn({ ...base, now: at('12:00'), settings: { ...SETTINGS, enabled: false } }),
    ).toBe(false)
  })

  it('never fires before the window opens', () => {
    expect(shouldSendCheckIn({ ...base, now: at('08:59') })).toBe(false)
  })

  it('fires at the moment the window opens', () => {
    expect(shouldSendCheckIn({ ...base, now: at('09:00') })).toBe(true)
  })

  it('never fires at or after the window closes', () => {
    expect(shouldSendCheckIn({ ...base, now: at('18:00') })).toBe(false)
    expect(shouldSendCheckIn({ ...base, now: at('19:00') })).toBe(false)
  })

  it('never fires once the daily quota is met', () => {
    expect(shouldSendCheckIn({ ...base, now: at('12:00'), sentToday: 3 })).toBe(false)
    expect(shouldSendCheckIn({ ...base, now: at('12:00'), sentToday: 4 })).toBe(false)
  })

  it('never fires when the quota is zero', () => {
    expect(
      shouldSendCheckIn({ ...base, now: at('12:00'), settings: { ...SETTINGS, checkInsPerDay: 0 } }),
    ).toBe(false)
  })

  it('is certain to fire when remaining check-ins equal remaining ticks', () => {
    // 17:45 with a 15-minute tick leaves exactly one tick before 18:00.
    expect(
      shouldSendCheckIn({ ...base, now: at('17:45'), sentToday: 2, random: () => 0.999 }),
    ).toBe(true)
  })

  it('respects the RNG in the middle of the window', () => {
    // 09:00-18:00 is 36 ticks; 3 owed => p = 3/36 ≈ 0.083.
    const now = at('09:00')
    expect(shouldSendCheckIn({ ...base, now, random: () => 0.01 })).toBe(true)
    expect(shouldSendCheckIn({ ...base, now, random: () => 0.5 })).toBe(false)
  })

  it('raises the probability as the window runs out', () => {
    const early = at('09:00')
    const late = at('17:00')
    // Same debt, fewer ticks left => a middling RNG draw fires late but not early.
    expect(shouldSendCheckIn({ ...base, now: early, random: () => 0.4 })).toBe(false)
    expect(shouldSendCheckIn({ ...base, now: late, random: () => 0.4 })).toBe(true)
  })

  it('interprets the window in the configured timezone', () => {
    // 12:00 UTC is 08:00 in New York — before a 09:00 local window opens.
    const settings = { ...SETTINGS, timezone: 'America/New_York' }
    expect(shouldSendCheckIn({ ...base, now: at('12:00'), settings })).toBe(false)
    // 14:00 UTC is 10:00 in New York — inside the window.
    expect(shouldSendCheckIn({ ...base, now: at('14:00'), settings, random: () => 0 })).toBe(true)
  })

  it('distributes roughly the requested number of check-ins over a day', () => {
    // A statistical sanity check on the whole schedule, not a single decision.
    let sent = 0
    let random = 12345
    const nextRandom = (): number => {
      // Deterministic LCG so the test never flakes.
      random = (random * 1103515245 + 12345) % 2147483648
      return random / 2147483648
    }

    for (let minutes = 540; minutes < 1080; minutes += 15) {
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
      const mm = String(minutes % 60).padStart(2, '0')
      if (shouldSendCheckIn({ ...base, now: at(`${hh}:${mm}`), sentToday: sent, random: nextRandom })) {
        sent += 1
      }
    }

    expect(sent).toBe(3)
  })
})

describe('runCheckInSweep', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
    sendToAllSubscriptions.mockReset()
    sendToAllSubscriptions.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 })
  })

  afterAll(async () => {
    await closePool()
  })

  it('sends and records a check-in when the decision says so', async () => {
    const now = at('09:00')
    const result = await runCheckInSweep({ now, random: () => 0 })

    expect(result.sent).toBe(true)
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
    expect(await countCheckInsOnLocalDate(zonedNow(now, 'UTC').date, 'UTC')).toBe(1)
  })

  it('records nothing when the decision says no', async () => {
    const now = at('03:00')
    const result = await runCheckInSweep({ now, random: () => 0 })

    expect(result.sent).toBe(false)
    expect(sendToAllSubscriptions).not.toHaveBeenCalled()
    expect(await countCheckInsOnLocalDate(zonedNow(now, 'UTC').date, 'UTC')).toBe(0)
  })

  it('records the check-in on the injected clock, not the real database clock', async () => {
    // A fixed historical date, guaranteed to differ from whatever day the
    // suite actually runs on. The point is that the sweep must read and
    // write on the SAME clock, whatever that clock says, rather than letting
    // recordCheckIn() fall back to Postgres's real now().
    const now = new Date('2019-03-15T09:00:00.000Z')
    const injectedDate = zonedNow(now, 'UTC').date
    const realDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
    expect(injectedDate).not.toBe(realDate)

    const result = await runCheckInSweep({ now, random: () => 0 })

    expect(result.sent).toBe(true)
    expect(await countCheckInsOnLocalDate(injectedDate, 'UTC')).toBe(1)
    expect(await countCheckInsOnLocalDate(realDate, 'UTC')).toBe(0)
  })

  it('honours settings changed at runtime', async () => {
    await updateCheckInSettings({ enabled: false })

    const result = await runCheckInSweep({ now: at('09:00'), random: () => 0 })

    expect(result.sent).toBe(false)
  })

  it('does not record a check-in when delivery outright failed', async () => {
    sendToAllSubscriptions.mockResolvedValue({ sent: 0, pruned: 0, failed: 1 })

    const now = at('09:00')
    const result = await runCheckInSweep({ now, random: () => 0 })

    expect(result.sent).toBe(false)
    expect(await countCheckInsOnLocalDate(zonedNow(now, 'UTC').date, 'UTC')).toBe(0)
  })

  it('never throws', async () => {
    sendToAllSubscriptions.mockRejectedValue(new Error('boom'))

    await expect(runCheckInSweep({ now: at('09:00'), random: () => 0 })).resolves.toEqual({
      sent: false,
    })
  })
})
