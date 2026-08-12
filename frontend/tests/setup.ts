import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './mocks/server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterEach(() => cleanup())
afterAll(() => server.close())

// A predictable, non-empty token so tests don't have to set one up per file
// unless they're specifically testing the token-entry flow itself.
localStorage.setItem('todo:apiToken', 'test-token-0123456789abcdef0123456789')
