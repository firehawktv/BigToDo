import { useReparseCaptureBatch } from './useCapture.js'
import { apiErrorMessage } from '../api/errors.js'
import type { CaptureResponse } from '../api/types.js'
import { Card, Button } from '../ui/index.js'
import styles from './CaptureResult.module.css'

export function CaptureResult({ result }: { result: CaptureResponse }) {
  const reparse = useReparseCaptureBatch()

  if (result.type === 'shortlist') {
    return (
      <div className={styles.wrap}>
        <Card>
          <p>With {result.minutes} minutes, here's what fits:</p>
          {result.tasks.length === 0 ? (
            <p>Nothing short enough right now.</p>
          ) : (
            <ul className={styles.list}>
              {result.tasks.map((task) => (
                <li key={task.id} className={styles.item}>
                  {task.title}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }

  // Prefer a successful retry's response over the original prop — otherwise
  // the failure banner and stale tasks would keep showing forever even
  // after the retry actually parsed the text correctly.
  const shown = reparse.data ?? result
  const { batch, tasks } = shown
  return (
    <div className={styles.wrap}>
      <p className={styles.heading}>Just captured — not filed yet</p>
      {/* Loose/askew: visibly provisional until the user reviews it, per
          DESIGN.md's raise from the Exposure Record challenger. */}
      <Card loose>
        {batch.parseStatus === 'failed' && (
          <div>
            <p className={styles.failed}>
              Couldn't parse that just now — your text is saved. {batch.parseError}
            </p>
            <div className={styles.failedActions}>
              <Button type="button" onClick={() => reparse.mutate(batch.id)} disabled={reparse.isPending}>
                Retry
              </Button>
            </div>
          </div>
        )}
        {reparse.isError && (
          <p role="alert" className={styles.retryError}>
            {apiErrorMessage(reparse.error, 'Retry failed. Please try again.')}
          </p>
        )}
        <ul className={styles.list}>
          {tasks.map((task) => (
            <li key={task.id} className={styles.item}>
              {task.title}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
