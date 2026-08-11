import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAnthropicResponse } from '../helpers/mockAnthropic.js'

// vi.mock is hoisted above every const in the file, so the spy has to be
// created with vi.hoisted or the factory closes over a variable in its
// temporal dead zone.
const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/ai/anthropic.js', () => ({
  anthropic: { messages: { create } },
}))

const { parseCapture } = await import('../../src/ai/parseCapture.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')

describe('parseCapture', () => {
  beforeEach(() => {
    create.mockReset()
  })

  it('maps a well-formed response into task drafts', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          {
            title: 'Call the dentist',
            notes: null,
            priority: 'high',
            dueAt: '2026-09-01T10:00:00.000Z',
            estimatedMinutes: 10,
            suggestBreakdown: false,
          },
          {
            title: 'Redesign the website',
            notes: 'from the dump',
            priority: 'medium',
            dueAt: null,
            estimatedMinutes: null,
            suggestBreakdown: true,
          },
        ],
      }),
    )

    const drafts = await parseCapture('call dentist ASAP\nredesign the website')

    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      title: 'Call the dentist',
      notes: null,
      priority: 'high',
      dueAt: new Date('2026-09-01T10:00:00.000Z'),
      estimatedMinutes: 10,
      suggestBreakdown: false,
    })
    expect(drafts[1]?.suggestBreakdown).toBe(true)
    expect(drafts[1]?.dueAt).toBeNull()
  })

  it('sends the configured parse model and the raw text', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }))

    await parseCapture('buy milk')

    const request = create.mock.calls[0]![0]
    expect(request.model).toBe('claude-haiku-4-5')
    expect(JSON.stringify(request.messages)).toContain('buy milk')
  })

  it('asks for structured output and does not send unsupported parameters', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }))

    await parseCapture('buy milk')

    const request = create.mock.calls[0]![0]
    expect(request.output_config.format.type).toBe('json_schema')
    // Haiku 4.5 rejects `effort`, and thinking is unnecessary for extraction.
    expect(request.output_config.effort).toBeUndefined()
    expect(request.thinking).toBeUndefined()
    expect(request.temperature).toBeUndefined()
  })

  it('tells the model the current date so relative deadlines resolve', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }))

    await parseCapture('call mum tomorrow', new Date('2026-08-11T09:00:00.000Z'))

    expect(JSON.stringify(create.mock.calls[0]![0].messages)).toContain('2026-08-11')
  })

  it('drops a task whose title is blank rather than persisting junk', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          { title: '   ', notes: null, priority: 'low', dueAt: null, estimatedMinutes: null, suggestBreakdown: false },
          { title: 'Real task', notes: null, priority: 'low', dueAt: null, estimatedMinutes: null, suggestBreakdown: false },
        ],
      }),
    )

    const drafts = await parseCapture('...')

    expect(drafts.map((d) => d.title)).toEqual(['Real task'])
  })

  it('trims titles and drops an unparseable due date instead of failing the batch', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          {
            title: '  Buy milk  ',
            notes: null,
            priority: 'low',
            dueAt: 'next Tuesdayish',
            estimatedMinutes: null,
            suggestBreakdown: false,
          },
        ],
      }),
    )

    const drafts = await parseCapture('...')

    expect(drafts[0]?.title).toBe('Buy milk')
    expect(drafts[0]?.dueAt).toBeNull()
  })

  it('coerces a non-positive estimate to null', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          { title: 'Task', notes: null, priority: 'low', dueAt: null, estimatedMinutes: 0, suggestBreakdown: false },
        ],
      }),
    )

    expect((await parseCapture('...'))[0]?.estimatedMinutes).toBeNull()
  })

  it('falls back to medium when the priority is not a known value', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          { title: 'Task', notes: null, priority: 'urgent', dueAt: null, estimatedMinutes: null, suggestBreakdown: false },
        ],
      }),
    )

    expect((await parseCapture('...'))[0]?.priority).toBe('medium')
  })

  it('throws AiUnavailableError when the model refuses', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }, { stopReason: 'refusal', blocks: [] }))

    await expect(parseCapture('...')).rejects.toThrow(AiUnavailableError)
    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'refusal' })
  })

  it('throws AiUnavailableError when the response was truncated', async () => {
    create.mockResolvedValue(mockAnthropicResponse('{"tasks":[{"tit', { stopReason: 'max_tokens' }))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'max_tokens' })
  })

  it('throws AiUnavailableError when the response carries no text block', async () => {
    create.mockResolvedValue(mockAnthropicResponse(null, { blocks: [{ type: 'thinking', thinking: '' }] }))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'no_text_block' })
  })

  it('throws AiUnavailableError when the text is not valid JSON', async () => {
    create.mockResolvedValue(mockAnthropicResponse('sorry, I could not do that'))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'invalid_json' })
  })

  it('throws AiUnavailableError when the JSON has no tasks array', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ result: 'ok' }))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'invalid_shape' })
  })

  it('wraps a transport failure rather than leaking the SDK error', async () => {
    create.mockRejectedValue(new Error('socket hang up'))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'request_failed' })
  })
})
