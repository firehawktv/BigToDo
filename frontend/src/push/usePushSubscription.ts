import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client.js'

type PushStatus = 'unsupported' | 'not-installed' | 'permission-denied' | 'unsubscribed' | 'subscribed'

/**
 * iOS Safari only exposes the Push API to a PWA that has been added to the
 * home screen — an in-Safari-tab PWA has no Notification/PushManager at all.
 * This is what makes 'unsupported' a real, expected status on iOS until the
 * user installs the app, not just a defensive fallback for ancient browsers.
 */
function isPushSupported(): boolean {
  return 'Notification' in globalThis && 'serviceWorker' in navigator && 'PushManager' in globalThis
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function usePushSubscriptionStatus() {
  const [status, setStatus] = useState<PushStatus>('unsubscribed')

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus('unsupported')
      return
    }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setStatus(sub === null ? 'unsubscribed' : 'subscribed'))
  }, [])

  async function subscribe(): Promise<void> {
    if (!isPushSupported()) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setStatus('permission-denied')
      return
    }
    const { publicKey } = await apiFetch<{ publicKey: string }>('/push/vapid-public-key')
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    await apiFetch('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    })
    setStatus('subscribed')
  }

  async function unsubscribe(): Promise<void> {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription === null) return
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    await apiFetch('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    })
    setStatus('unsubscribed')
  }

  async function sendTest(): Promise<{ sent: number; pruned: number; failed: number }> {
    return apiFetch('/push/test', { method: 'POST' })
  }

  return { status, subscribe, unsubscribe, sendTest }
}
