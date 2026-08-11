import { describe, expect, it } from 'vitest'
import { mockAnthropicResponse } from '../helpers/mockAnthropic.js'
import { readStructuredJson } from '../../src/ai/response.js'
import { AiUnavailableError } from '../../src/ai/errors.js'

describe('readStructuredJson', () => {
  it('returns the parsed object on a well-formed response', () => {
    const response = mockAnthropicResponse({ tasks: [] })
    expect(readStructuredJson(response, 'parse this input')).toEqual({ tasks: [] })
  })

  it('throws with reason refusal and includes what in the message', () => {
    const response = mockAnthropicResponse({ tasks: [] }, { stopReason: 'refusal' })
    try {
      readStructuredJson(response, 'parse this input')
      throw new Error('expected readStructuredJson to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AiUnavailableError)
      expect((error as AiUnavailableError).reason).toBe('refusal')
      expect((error as Error).message).toContain('parse this input')
    }
  })

  it('throws with reason max_tokens when the response was truncated', () => {
    const response = mockAnthropicResponse('{"tasks":[{"tit', { stopReason: 'max_tokens' })
    expect(() => readStructuredJson(response, 'parse this input')).toThrow(
      expect.objectContaining({ reason: 'max_tokens' }),
    )
  })

  it('throws with reason no_text_block when the response carries no text block', () => {
    const response = mockAnthropicResponse(null, { blocks: [{ type: 'thinking', thinking: '' }] })
    expect(() => readStructuredJson(response, 'parse this input')).toThrow(
      expect.objectContaining({ reason: 'no_text_block' }),
    )
  })

  it('throws with reason invalid_json when the text is not valid JSON', () => {
    const response = mockAnthropicResponse('sorry, I could not do that')
    expect(() => readStructuredJson(response, 'parse this input')).toThrow(
      expect.objectContaining({ reason: 'invalid_json' }),
    )
  })

  it('picks the text block when it is not first in content', () => {
    const response = mockAnthropicResponse(null, {
      blocks: [
        { type: 'thinking', thinking: 'pondering' },
        { type: 'text', text: JSON.stringify({ tasks: [] }) },
      ],
    })
    expect(readStructuredJson(response, 'parse this input')).toEqual({ tasks: [] })
  })
})
