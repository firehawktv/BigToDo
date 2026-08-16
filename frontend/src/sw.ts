/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

// injectManifest requires this line — vite-plugin-pwa replaces
// self.__WB_MANIFEST with the list of built assets to precache.
precacheAndRoute(self.__WB_MANIFEST)

// `registerType: 'autoUpdate'` in vite.config.ts only controls how the
// *registration* behaves — for the `injectManifest` strategy it does not,
// by itself, make a newly-installed service worker take over. Without
// these two calls, a new SW finishes installing but sits in "waiting"
// until every open tab/PWA instance for this origin is fully closed (not
// just reloaded), so a deploy can go live on the server while installed
// clients keep serving the previous precached HTML/JS/CSS indefinitely —
// and once `rsync --delete` prunes the old build's hashed asset files,
// those stale references start 404ing. `skipWaiting()` activates the new
// SW as soon as it installs; `clientsClaim()` lets it take control of
// already-open tabs immediately, so the very next navigation/reload gets
// the current build instead of requiring a full close-and-reopen.
self.skipWaiting()
clientsClaim()

/**
 * Payload shape is documented in backend/README.md's "Notification payload"
 * section: {title, body, url?}, sent as a JSON string on the push event's
 * `data`. Every push the server sends — deadline alerts, check-ins, and
 * POST /push/test — uses this same shape.
 */
self.addEventListener('push', (event) => {
  if (event.data === null) return
  const payload = event.data.json() as { title: string; body: string; url?: string }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      // Focus an already-open tab rather than opening a duplicate one.
      // Compare pathnames, not full URLs: the payload's `url` is relative
      // (e.g. "/") while `client.url` is always absolute, so a strict
      // equality check would never match and always open a duplicate tab.
      const targetPath = new URL(url, self.location.origin).pathname
      for (const client of clientList) {
        if (new URL(client.url).pathname === targetPath && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
