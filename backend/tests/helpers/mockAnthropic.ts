/**
 * Builds a response object shaped like the Messages API returns, so tests can
 * exercise real parsing logic against a realistic payload without a network
 * call. Only the fields our code reads are populated.
 */
export function mockAnthropicResponse(
  payload: unknown,
  overrides: { stopReason?: string; blocks?: unknown[] } = {},
): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    stop_reason: overrides.stopReason ?? 'end_turn',
    stop_details: null,
    content: overrides.blocks ?? [
      { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}
