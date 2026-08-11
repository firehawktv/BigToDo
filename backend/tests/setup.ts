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

// Structural safety net, not the thing that makes individual tests pass:
// every test that exercises the push-send path is expected to mock
// src/push/send.js or src/push/webPush.js explicitly. This mock only
// replaces sendNotification, so src/push/webPush.ts's module-scope
// `setVapidDetails(...)` call still runs for real against the fixture
// VAPID keypair above — a test file that mocks '../../src/push/send.js' or
// '../../src/push/webPush.js' overrides this at the module level, so this
// never runs for them. A test that reaches sendNotification unmocked fails
// loudly instead of making a real outbound HTTPS request.
// @types/web-push declares only named exports (no `export =`/`export default`),
// so there is no ambient type for the `.default` field that actually shows up
// on the module at runtime once Vite's CJS interop wraps it (the real
// `web-push` package is plain CommonJS: `module.exports = { setVapidDetails,
// sendNotification, ... }`, and Vite puts that whole object under `.default`
// rather than statically discovering every named export, unlike tsc's own
// esModuleInterop `__importDefault` helper). This local type describes that
// runtime shape by reusing each function's real type off the named exports,
// so `importOriginal` can be given an accurate generic instead of an `as` cast.
interface WebPushDefault {
  default: {
    WebPushError: typeof import('web-push').WebPushError
    supportedContentEncodings: typeof import('web-push').supportedContentEncodings
    encrypt: typeof import('web-push').encrypt
    getVapidHeaders: typeof import('web-push').getVapidHeaders
    generateVAPIDKeys: typeof import('web-push').generateVAPIDKeys
    setGCMAPIKey: typeof import('web-push').setGCMAPIKey
    setVapidDetails: typeof import('web-push').setVapidDetails
    generateRequestDetails: typeof import('web-push').generateRequestDetails
    sendNotification: typeof import('web-push').sendNotification
  }
}

vi.mock('web-push', async (importOriginal) => {
  const actual = await importOriginal<WebPushDefault>()
  return {
    default: {
      ...actual.default,
      sendNotification: () => {
        throw new Error('a test attempted a real web push — mock src/push/send.js instead')
      },
    },
  }
})
