import { useReparseCaptureBatch } from './useCapture.js'
import { apiErrorMessage } from '../api/errors.js'
import type { CaptureResponse } from '../api/types.js'

export function CaptureResult({ result }: { result: CaptureResponse }) {
  const reparse = useReparseCaptureBatch()

  if (result.type === 'shortlist') {
    return (
      <div>
        <p>With {result.minutes} minutes, here's what fits:</p>
        {result.tasks.length === 0 ? (
          <p>Nothing short enough right now.</p>
        ) : (
          <ul>
            {result.tasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // Prefer a successful retry's response over the original prop — otherwise
  // the failure banner and stale tasks would keep showing forever even
  // after the retry actually parsed the text correctly.
  const shown = reparse.data ?? result
  const { batch, tasks } = shown
  return (
    <div>
      {batch.parseStatus === 'failed' && (
        <div>
          <p>Couldn't parse that just now — your text is saved. {batch.parseError}</p>
          <button type="button" onClick={() => reparse.mutate(batch.id)} disabled={reparse.isPending}>
            Retry
          </button>
          {reparse.isError && (
            <p role="alert">{apiErrorMessage(reparse.error, 'Retry failed. Please try again.')}</p>
          )}
        </div>
      )}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </div>
  )
}
