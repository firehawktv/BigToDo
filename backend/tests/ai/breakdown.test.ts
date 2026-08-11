import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAnthropicResponse } from '../helpers/mockAnthropic.js'

// vi.mock is hoisted above every const in the file, so the spy has to be
// created with vi.hoisted or the factory closes over a variable in its
// temporal dead zone.
const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/ai/anthropic.js', () => ({
  anthropic: { messages: { create } },
}))

const { proposeBreakdown } = await import('../../src/ai/breakdown.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')

describe('proposeBreakdown', () => {
  beforeEach(() => {
    create.mockReset()
  })

  it('maps a well-formed response into proposed subtasks', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        subtasks: [
          { title: 'Collect design references', estimatedMinutes: 30 },
          { title: 'Sketch the new layout', estimatedMinutes: 60 },
        ],
      }),
    )

    const subtasks = await proposeBreakdown({ title: 'Redesign the website', notes: null })

    expect(subtasks).toEqual([
      { title: 'Collect design references', estimatedMinutes: 30 },
      { title: 'Sketch the new layout', estimatedMinutes: 60 },
    ])
  })

  it('sends the configured breakdown model with the task title and notes', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ subtasks: [] }))

    await proposeBreakdown({ title: 'Plan the trip', notes: 'two weeks in June' })

    const request = create.mock.calls[0]![0]
    expect(request.model).toBe('claude-sonnet-5')
    const sent = JSON.stringify(request.messages)
    expect(sent).toContain('Plan the trip')
    expect(sent).toContain('two weeks in June')
  })

  it('requests structured output and never sets rejected sampling parameters', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ subtasks: [] }))

    await proposeBreakdown({ title: 'Plan the trip', notes: null })

    const request = create.mock.calls[0]![0]
    expect(request.output_config.format.type).toBe('json_schema')
    // Sonnet 5 returns 400 for any of these.
    expect(request.temperature).toBeUndefined()
    expect(request.top_p).toBeUndefined()
    expect(request.top_k).toBeUndefined()
  })

  it('drops blank titles and normalizes bad estimates', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        subtasks: [
          { title: '  ', estimatedMinutes: 10 },
          { title: '  Book flights  ', estimatedMinutes: -5 },
        ],
      }),
    )

    const subtasks = await proposeBreakdown({ title: 'Plan the trip', notes: null })

    expect(subtasks).toEqual([{ title: 'Book flights', estimatedMinutes: null }])
  })

  it('caps an unreasonably long proposal', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        subtasks: Array.from({ length: 40 }, (_, index) => ({
          title: `Step ${index + 1}`,
          estimatedMinutes: 15,
        })),
      }),
    )

    const subtasks = await proposeBreakdown({ title: 'Plan the trip', notes: null })

    expect(subtasks).toHaveLength(20)
    expect(subtasks[0]?.title).toBe('Step 1')
  })

  it('throws AiUnavailableError when the model refuses', async () => {
    create.mockResolvedValue(mockAnthropicResponse(null, { stopReason: 'refusal', blocks: [] }))

    await expect(proposeBreakdown({ title: 'x', notes: null })).rejects.toThrow(AiUnavailableError)
  })

  it('throws AiUnavailableError when the JSON has no subtasks array', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ steps: [] }))

    await expect(proposeBreakdown({ title: 'x', notes: null })).rejects.toMatchObject({
      reason: 'invalid_shape',
    })
  })

  it('wraps a transport failure', async () => {
    create.mockRejectedValue(new Error('ETIMEDOUT'))

    await expect(proposeBreakdown({ title: 'x', notes: null })).rejects.toMatchObject({
      reason: 'request_failed',
    })
  })
})
