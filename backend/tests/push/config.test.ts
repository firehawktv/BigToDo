import { describe, expect, it } from 'vitest'
import { loadPushConfig } from '../../src/push/config.js'

const validEnv = {
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:someone@example.com',
  APP_URL: 'https://todo.example.com',
}

describe('loadPushConfig', () => {
  it('returns a typed config from a valid environment', () => {
    const config = loadPushConfig(validEnv)

    expect(config.publicKey).toBe('test-public-key')
    expect(config.privateKey).toBe('test-private-key')
    expect(config.subject).toBe('mailto:someone@example.com')
    expect(config.appUrl).toBe('https://todo.example.com')
  })

  it('defaults the deadline lead time to one hour', () => {
    expect(loadPushConfig(validEnv).deadlineLeadMinutes).toBe(60)
  })

  it('defaults the tick to 15 minutes', () => {
    expect(loadPushConfig(validEnv).tickMinutes).toBe(15)
  })

  it('allows overriding the lead time and tick', () => {
    const config = loadPushConfig({
      ...validEnv,
      DEADLINE_LEAD_MINUTES: '120',
      SCHEDULER_TICK_MINUTES: '5',
    })
    expect(config.deadlineLeadMinutes).toBe(120)
    expect(config.tickMinutes).toBe(5)
  })

  it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'APP_URL'])(
    'throws when %s is missing',
    (key) => {
      const env: Record<string, string> = { ...validEnv }
      delete env[key]
      expect(() => loadPushConfig(env)).toThrow(new RegExp(key))
    },
  )

  it('rejects a VAPID subject that is not a mailto: or https: URL', () => {
    expect(() => loadPushConfig({ ...validEnv, VAPID_SUBJECT: 'someone@example.com' })).toThrow(
      /VAPID_SUBJECT/,
    )
  })

  it('rejects a non-numeric or non-positive lead time', () => {
    for (const value of ['soon', '0', '-5']) {
      expect(() => loadPushConfig({ ...validEnv, DEADLINE_LEAD_MINUTES: value })).toThrow(
        /DEADLINE_LEAD_MINUTES/,
      )
    }
  })

  it('rejects a tick that does not divide an hour evenly', () => {
    // The cron expression is `*/N * * * *`, which only behaves as "every N
    // minutes" when N divides 60 — otherwise it restarts at the top of the hour.
    for (const value of ['7', '45', '0']) {
      expect(() => loadPushConfig({ ...validEnv, SCHEDULER_TICK_MINUTES: value })).toThrow(
        /SCHEDULER_TICK_MINUTES/,
      )
    }
  })
})
