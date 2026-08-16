import { useState } from 'react'
import { usePushSubscriptionStatus } from './usePushSubscription.js'
import { Card, Button } from '../ui/index.js'
import styles from './PushSettings.module.css'

const STATUS_MESSAGES: Record<string, string> = {
  'not-installed': 'Install this app to your home screen first to enable notifications.',
  'permission-denied': 'Notifications are blocked. Enable them in your browser/device settings to subscribe.',
  unsubscribed: 'Notifications are off.',
  subscribed: 'Notifications are on.',
  error: "Couldn't check your notification status. Try reloading the page.",
}

export function PushSettings() {
  const { status, subscribe, unsubscribe, sendTest } = usePushSubscriptionStatus()
  const [testResult, setTestResult] = useState<{ sent: number; pruned: number; failed: number } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  const [unsubscribeError, setUnsubscribeError] = useState<string | null>(null)

  async function handleSubscribe(): Promise<void> {
    setSubscribeError(null)
    try {
      await subscribe()
    } catch {
      setSubscribeError('Failed to subscribe to notifications.')
    }
  }

  async function handleUnsubscribe(): Promise<void> {
    setUnsubscribeError(null)
    try {
      await unsubscribe()
    } catch {
      setUnsubscribeError('Failed to unsubscribe from notifications.')
    }
  }

  async function handleSendTest(): Promise<void> {
    setIsSendingTest(true)
    setTestError(null)
    setTestResult(null)
    try {
      const result = await sendTest()
      setTestResult(result)
    } catch {
      setTestError('Failed to send test notification.')
    } finally {
      setIsSendingTest(false)
    }
  }

  return (
    <Card as="section">
      <h2 className={styles.heading}>Push notifications</h2>

      {status === 'unsupported' ? (
        <p>
          Push notifications aren't available in this browser tab. On iOS, add this app to your
          home screen (Share &rarr; Add to Home Screen) and open it from there to enable
          notifications.
        </p>
      ) : (
        <p>{STATUS_MESSAGES[status]}</p>
      )}

      {(status === 'unsubscribed' || status === 'permission-denied') && (
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void handleSubscribe()}>
            Subscribe
          </Button>
          {subscribeError !== null && (
            <p role="alert" className={styles.error}>
              {subscribeError}
            </p>
          )}
        </div>
      )}

      {status === 'subscribed' && (
        <div className={styles.actions}>
          <Button onClick={() => void handleUnsubscribe()}>Unsubscribe</Button>
          <Button onClick={() => void handleSendTest()} disabled={isSendingTest}>
            Send test notification
          </Button>
          {unsubscribeError !== null && (
            <p role="alert" className={styles.error}>
              {unsubscribeError}
            </p>
          )}
          {isSendingTest && <p className={styles.result}>Sending test notification&hellip;</p>}
          {testResult !== null && (
            <p className={styles.result}>
              Sent {testResult.sent}, pruned {testResult.pruned}, failed {testResult.failed}.
            </p>
          )}
          {testError !== null && (
            <p role="alert" className={styles.error}>
              {testError}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
