import { vi } from 'vitest'

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://todo:todo@localhost:5433/todo_test'
process.env.API_TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
process.env.LOG_LEVEL = 'silent'
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real'
// A real-format VAPID keypair (generated once via `npm run vapid:generate`,
// i.e. web-push's own generateVAPIDKeys()), committed as a throwaway test
// fixture — not a leaked credential. It is used nowhere real: it exists only
// so src/push/webPush.ts's module-scope `setVapidDetails(...)` call, which
// validates the public key is a real 65-byte decoded EC point, succeeds at
// import time and is actually exercised by the suite, rather than being
// bypassed by a mock.
process.env.VAPID_PUBLIC_KEY =
  'BB-wMT2JNeA0jv5KRzQt4y6TRuCpf6PmXinm5H28bl2kVEbwnzS67aO3PAAuA4w-ZUv2Bm-IjI8wD1aSGbV0DJ8'
process.env.VAPID_PRIVATE_KEY = 't-xxJu78J1ejybjtfRHBuXx90J7umgrAqBXgrym7PHw'
process.env.VAPID_SUBJECT = 'mailto:test@example.com'
process.env.APP_URL = 'https://todo.test'

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
