import { getWebPush } from './webPush.js'
import type { Logger } from '../logger.js'
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
} from '../repositories/pushSubscriptions.js'

export interface PushPayload {
  title: string
  body: string
  /** Path or URL the service worker opens when the notification is tapped. */
  url?: string
}

export interface PushResult {
  sent: number
  /** Subscriptions removed because the push service said they no longer exist. */
  pruned: number
  /** Sends that failed for a reason worth retrying next time. */
  failed: number
}

/** Status codes meaning "this endpoint is gone" — the subscription is dead. */
const GONE_STATUS_CODES = new Set([404, 410])

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode?: unknown }).statusCode
    if (typeof code === 'number') return code
  }
  return undefined
}

/**
 * Sends one notification to every registered device.
 *
 * Never throws: it is called from cron ticks, and an exception escaping here
 * would take down the scheduler for the life of the process. Failures are
 * counted and logged; the next tick tries again.
 *
 * Subscriptions the push service reports as gone are deleted. That is cleanup,
 * not the resubscribe-nagging the spec rules out for v1 — the user simply
 * re-subscribes next time they open the app.
 */
export async function sendToAllSubscriptions(
  payload: PushPayload,
  logger?: Logger,
): Promise<PushResult> {
  const subscriptions = await listPushSubscriptions()
  const result: PushResult = { sent: 0, pruned: 0, failed: 0 }
  const body = JSON.stringify(payload)

  for (const subscription of subscriptions) {
    try {
      await getWebPush().sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
      )
      result.sent += 1
    } catch (error) {
      const statusCode = statusCodeOf(error)
      if (statusCode !== undefined && GONE_STATUS_CODES.has(statusCode)) {
        await deletePushSubscriptionByEndpoint(subscription.endpoint)
        result.pruned += 1
        logger?.warn(
          { endpoint: subscription.endpoint, statusCode },
          'pruned a push subscription the service reported as gone',
        )
      } else {
        result.failed += 1
        logger?.warn({ err: error, endpoint: subscription.endpoint }, 'push send failed')
      }
    }
  }

  return result
}
