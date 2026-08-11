import { describe, expect, it } from 'vitest'
import { detectTimeAvailable } from '../../src/ai/timeAvailable.js'

describe('detectTimeAvailable', () => {
  it.each([
    ['I have 20 minutes', 20],
    ['i have 20 minutes', 20],
    ['I have 20 minutes.', 20],
    ['I have 5 mins', 5],
    ['I have 45 min', 45],
    ['20 minutes', 20],
    ['20m', 20],
    ["I've got 15 minutes", 15],
    ['I got 15 minutes', 15],
    ['I have 2 hours', 120],
    ['1 hour', 60],
    ['90 mins free', 90],
    ['I have 30 minutes left', 30],
    ['half an hour', 30],
    ['I have half an hour', 30],
    ['I have 20 minutes, what can I do?', 20],
    ['I have 20 minutes - what can I get done?', 20],
  ])('detects %j as %i minutes', (input, expected) => {
    expect(detectTimeAvailable(input)).toBe(expected)
  })

  it.each([
    // The critical class: real captures that merely mention a duration.
    ['call the dentist in 20 minutes'],
    ['buy milk\ncall dentist ASAP'],
    ['set a 20 minute timer for the pasta'],
    ['book the 2 hour slot at the studio'],
    ['I have 20 minutes of footage to edit'],
    ['spend 30 minutes on the report'],
    // Not durations at all.
    [''],
    ['   '],
    ['what should I do?'],
    ['I have time'],
  ])('does not treat %j as a query', (input) => {
    expect(detectTimeAvailable(input)).toBeNull()
  })

  it('rejects an implausible duration rather than returning a huge shortlist', () => {
    expect(detectTimeAvailable('I have 5000 minutes')).toBeNull()
    expect(detectTimeAvailable('I have 0 minutes')).toBeNull()
  })

  it('caps at a full day', () => {
    expect(detectTimeAvailable('24 hours')).toBe(1440)
    expect(detectTimeAvailable('25 hours')).toBeNull()
  })
})
