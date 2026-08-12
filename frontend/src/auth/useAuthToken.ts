import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'todo:apiToken'

export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Subscription machinery for reacting to token changes.
 *
 * This lives here — alongside the storage primitives above — rather than in
 * TokenGate.tsx, so that client.ts (which needs to call notifyTokenChanged()
 * from its 401 handler) and TokenGate.tsx (which needs to subscribe to it via
 * useAuthToken()) can both import from this one module without a circular
 * dependency between the two.
 */
const listeners = new Set<() => void>()

/**
 * Fires whenever the stored token changes — including apiFetch's own
 * clearAuthToken() on a 401, from anywhere in the app, not just from
 * TokenGate's own submit handler. useAuthToken()'s useSyncExternalStore
 * subscription is what makes a 401 deep inside a task mutation immediately
 * bounce the whole app back to the token-entry screen.
 */
export function notifyTokenChanged(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive read of the stored token — re-renders subscribers on any change. */
export function useAuthToken(): string | null {
  return useSyncExternalStore(subscribe, getAuthToken)
}
