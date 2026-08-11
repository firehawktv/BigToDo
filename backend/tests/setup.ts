import { vi } from 'vitest'

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://todo:todo@localhost:5433/todo_test'
process.env.API_TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
process.env.LOG_LEVEL = 'silent'
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real'

// Insurance, not correctness: every test file is expected to mock its Claude
// dependency (src/ai/anthropic.js or a whole service module) explicitly. This
// global mock exists so a future test file that forgets fails loudly with a
// real API call attempt instead of silently hitting the network. A test file
// that mocks '../../src/ai/anthropic.js' (or a service module) with its own
// vi.mock overrides this at the module level, so this never runs for them.
vi.mock('@anthropic-ai/sdk', () => {
  function AnthropicMock() {
    return {
      messages: {
        create: () => {
          throw new Error(
            'a test attempted a real Claude API call — mock the service module',
          )
        },
      },
    }
  }
  return { default: AnthropicMock }
})
