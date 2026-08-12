/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { precacheAndRoute } from 'workbox-precaching'

// injectManifest requires this line — vite-plugin-pwa replaces
// self.__WB_MANIFEST with the list of built assets to precache.
precacheAndRoute(self.__WB_MANIFEST)

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
