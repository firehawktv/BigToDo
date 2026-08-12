import { useState } from 'react'
import { usePushSubscriptionStatus } from './usePushSubscription.js'

const STATUS_MESSAGES: Record<string, string> = {
  'not-installed': 'Install this app to your home screen first to enable notifications.',
  'permission-denied': 'Notifications are blocked. Enable them in your browser/device settings to subscribe.',
  unsubscribed: 'Notifications are off.',
  subscribed: 'Notifications are on.',
}

export function PushSettings() {
  const { status, subscribe, unsubscribe, sendTest } = usePushSubscriptionStatus()
  const [testResult, setTestResult] = useState<{ sent: number; pruned: number; failed: number } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [isSendingTest, setIsSendingTest] = useState(false)

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
    <section>
      <h2>Push notifications</h2>

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
        <button type="button" onClick={() => void subscribe()}>
          Subscribe
        </button>
      )}

      {status === 'subscribed' && (
        <>
          <button type="button" onClick={() => void unsubscribe()}>
            Unsubscribe
          </button>
          <button type="button" onClick={() => void handleSendTest()} disabled={isSendingTest}>
            Send test notification
          </button>
          {isSendingTest && <p>Sending test notification&hellip;</p>}
          {testResult !== null && (
            <p>
              Sent {testResult.sent}, pruned {testResult.pruned}, failed {testResult.failed}.
            </p>
          )}
          {testError !== null && <p role="alert">{testError}</p>}
        </>
      )}
    </section>
  )
}
