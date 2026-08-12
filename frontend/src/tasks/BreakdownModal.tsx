import { useEffect, useState } from 'react'
import { useProposeBreakdown, useSaveSubtasks } from './useBreakdown.js'
import type { ProposedSubtask, Task } from '../api/types.js'
import { ApiError, apiErrorMessage } from '../api/errors.js'

export function BreakdownModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [subtasks, setSubtasks] = useState<ProposedSubtask[]>([])
  const propose = useProposeBreakdown()
  const save = useSaveSubtasks()

  useEffect(() => {
    propose.mutate(task.id, { onSuccess: setSubtasks })
    // Only run once per mount — proposing again on every render would spend
    // another Sonnet call for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateTitle(index: number, title: string): void {
    setSubtasks((prev) => prev.map((s, i) => (i === index ? { ...s, title } : s)))
  }

  function updateEstimatedMinutes(index: number, value: string): void {
    const estimatedMinutes = value === '' ? null : Number(value)
    setSubtasks((prev) => prev.map((s, i) => (i === index ? { ...s, estimatedMinutes } : s)))
  }

  function removeSubtask(index: number): void {
    setSubtasks((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSave(): void {
    save.mutate({ taskId: task.id, subtasks }, { onSuccess: onClose })
  }

  if (propose.isError) {
    const isUnavailable = propose.error instanceof ApiError && propose.error.status === 503
    return (
      <div role="dialog">
        <p>
          {isUnavailable
            ? "Couldn't reach the breakdown service right now."
            : 'Something went wrong proposing a breakdown.'}
        </p>
        <button type="button" onClick={() => propose.mutate(task.id, { onSuccess: setSubtasks })}>
          Try again
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    )
  }

  if (propose.isPending) return <div role="dialog">Thinking…</div>

  if (save.isSuccess) {
    return (
      <div role="dialog">
        <p role="status">Subtasks saved.</p>
      </div>
    )
  }

  return (
    <div role="dialog">
      <h2>Break down: {task.title}</h2>
      <ul>
        {subtasks.map((subtask, index) => (
          <li key={index}>
            <input value={subtask.title} onChange={(e) => updateTitle(index, e.target.value)} />
            <input
              type="number"
              value={subtask.estimatedMinutes ?? ''}
              onChange={(e) => updateEstimatedMinutes(index, e.target.value)}
              aria-label={`Estimated minutes for ${subtask.title}`}
            />
            <button
              type="button"
              onClick={() => removeSubtask(index)}
              aria-label={`Remove ${subtask.title}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {subtasks.length >= 20 && <p>You can save at most 20 subtasks at a time.</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={save.isPending || subtasks.length === 0 || subtasks.length > 20}
      >
        Save
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      {save.isError && (
        <p role="alert">{apiErrorMessage(save.error, 'Something went wrong saving these subtasks.')}</p>
      )}
    </div>
  )
}
