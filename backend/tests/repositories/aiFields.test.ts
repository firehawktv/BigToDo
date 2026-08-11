import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import { createTask, getTask, updateTask } from '../../src/repositories/tasks.js'
import {
  createCaptureBatch,
  setCaptureBatchParseStatus,
} from '../../src/repositories/captureBatches.js'

describe('AI capture fields', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('defaults suggestBreakdown to false', async () => {
    const task = await createTask({ title: 'Buy milk' })
    expect(task.suggestBreakdown).toBe(false)
  })

  it('round-trips suggestBreakdown on create', async () => {
    const task = await createTask({ title: 'Redesign the site', suggestBreakdown: true })
    expect(task.suggestBreakdown).toBe(true)
    expect((await getTask(task.id))?.suggestBreakdown).toBe(true)
  })

  it('clears suggestBreakdown via update', async () => {
    const task = await createTask({ title: 'Redesign the site', suggestBreakdown: true })

    const updated = await updateTask(task.id, { suggestBreakdown: false })

    expect(updated?.suggestBreakdown).toBe(false)
  })

  it('defaults a new capture batch to pending with no error', async () => {
    const batch = await createCaptureBatch('buy milk')
    expect(batch.parseStatus).toBe('pending')
    expect(batch.parseError).toBeNull()
  })

  it('marks a batch parsed and clears any previous error', async () => {
    const batch = await createCaptureBatch('buy milk')
    await setCaptureBatchParseStatus(batch.id, 'failed', 'timeout')

    const parsed = await setCaptureBatchParseStatus(batch.id, 'parsed')

    expect(parsed?.parseStatus).toBe('parsed')
    expect(parsed?.parseError).toBeNull()
  })

  it('records the error message when a batch fails to parse', async () => {
    const batch = await createCaptureBatch('buy milk')

    const failed = await setCaptureBatchParseStatus(batch.id, 'failed', 'Claude timed out')

    expect(failed?.parseStatus).toBe('failed')
    expect(failed?.parseError).toBe('Claude timed out')
  })

  it('returns null when setting status on a batch that does not exist', async () => {
    const result = await setCaptureBatchParseStatus(
      '00000000-0000-0000-0000-000000000000',
      'parsed',
    )
    expect(result).toBeNull()
  })
})
