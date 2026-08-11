import { vi } from 'vitest'

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://todo:todo@localhost:5433/todo_test'
process.env.API_TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
process.env.LOG_LEVEL = 'silent'
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real'
process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key'
process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key'
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

// Same insurance, for web-push. src/push/webPush.ts calls setVapidDetails at
// import time, and it validates the key is a real 65-byte EC point — the
// placeholder VAPID_PUBLIC_KEY above is not, so any test that pulls in the
// real module (e.g. by registering the app's push routes, which import
// push/send.js) would crash before the test even runs, not just when a push
// is sent. Tests that care about send behaviour already mock
// src/push/webPush.js or src/push/send.js directly, which takes precedence
// over this for that file.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: () => {
      throw new Error('a test attempted a real push send — mock src/push/send.js or webPush.js')
    },
  },
}))
