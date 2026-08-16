import { useEffect, useState } from 'react'
import { useProposeBreakdown, useSaveSubtasks } from './useBreakdown.js'
import type { ProposedSubtask, Task } from '../api/types.js'
import { ApiError, apiErrorMessage } from '../api/errors.js'
import { Modal, Button, TextInput } from '../ui/index.js'
import styles from './BreakdownModal.module.css'

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
      <Modal>
        <p>
          {isUnavailable
            ? "Couldn't reach the breakdown service right now."
            : 'Something went wrong proposing a breakdown.'}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => propose.mutate(task.id, { onSuccess: setSubtasks })}>
            Try again
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </Modal>
    )
  }

  if (propose.isPending)
    return (
      <Modal>
        <p>Thinking…</p>
      </Modal>
    )

  if (save.isSuccess) {
    return (
      <Modal>
        <p role="status" className={styles.status}>
          Subtasks saved.
        </p>
      </Modal>
    )
  }

  return (
    <Modal>
      <h2 className={styles.heading}>Break down: {task.title}</h2>
      <ul className={styles.list}>
        {subtasks.map((subtask, index) => (
          <li key={index} className={styles.subtask}>
            <TextInput
              className={styles.title}
              value={subtask.title}
              onChange={(e) => updateTitle(index, e.target.value)}
            />
            <TextInput
              type="number"
              className={`${styles.minutes} mono-figure`}
              value={subtask.estimatedMinutes ?? ''}
              onChange={(e) => updateEstimatedMinutes(index, e.target.value)}
              aria-label={`Estimated minutes for ${subtask.title}`}
            />
            <Button
              size="small"
              variant="danger"
              onClick={() => removeSubtask(index)}
              aria-label={`Remove ${subtask.title}`}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      {subtasks.length >= 20 && <p className={styles.limit}>You can save at most 20 subtasks at a time.</p>}
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={save.isPending || subtasks.length === 0 || subtasks.length > 20}
        >
          Save
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
      {save.isError && (
        <p role="alert" className={styles.error}>
          {apiErrorMessage(save.error, 'Something went wrong saving these subtasks.')}
        </p>
      )}
    </Modal>
  )
}
