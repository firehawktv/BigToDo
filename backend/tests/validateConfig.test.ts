import { describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { databaseConfig } from '../src/db/config.js'
import { aiConfig } from '../src/ai/config.js'
import { pushConfig } from '../src/push/config.js'
import { validateConfig } from '../src/validateConfig.js'

describe('config accessors', () => {
  it('memoizes config() so repeated calls return the same object reference', () => {
    expect(config()).toBe(config())
  })

  it('memoizes databaseConfig() so repeated calls return the same object reference', () => {
    expect(databaseConfig()).toBe(databaseConfig())
  })

  it('memoizes aiConfig() so repeated calls return the same object reference', () => {
    expect(aiConfig()).toBe(aiConfig())
  })

  it('memoizes pushConfig() so repeated calls return the same object reference', () => {
    expect(pushConfig()).toBe(pushConfig())
  })
})

describe('validateConfig', () => {
  it('runs without throwing given the test environment', () => {
    expect(() => validateConfig()).not.toThrow()
  })
})
