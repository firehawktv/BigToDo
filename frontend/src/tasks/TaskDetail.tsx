import { type FormEvent, useState } from 'react'
import { useUpdateTask } from './useTasks.js'
import { apiErrorMessage } from '../api/errors.js'
import type { Task } from '../api/types.js'
import { Button, Label, TextInput, TextArea, Select } from '../ui/index.js'
import styles from './TaskDetail.module.css'

/**
 * `<input type="datetime-local">` reads/writes a timezone-free
 * "YYYY-MM-DDTHH:mm" string interpreted in the browser's local timezone —
 * it cannot parse or display an ISO-8601 UTC string directly. These two
 * helpers are the only place that conversion happens.
 */
function isoToLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function localInputValueToIso(value: string): string {
  // `new Date(value)` on a timezone-free "YYYY-MM-DDTHH:mm" string parses it
  // as local time, so converting to ISO here correctly captures the offset.
  return new Date(value).toISOString()
}

export function TaskDetail({ task, onSaved }: { task: Task; onSaved?: (task: Task) => void }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [priority, setPriority] = useState<Task['priority']>(task.priority)
  const [dueAt, setDueAt] = useState(task.dueAt === null ? '' : isoToLocalInputValue(task.dueAt))
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    task.estimatedMinutes === null ? '' : String(task.estimatedMinutes),
  )
  const updateTask = useUpdateTask()

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle === '') return
    updateTask.mutate(
      {
        id: task.id,
        patch: {
          title: trimmedTitle,
          notes: notes.trim() === '' ? null : notes,
          priority,
          dueAt: dueAt === '' ? null : localInputValueToIso(dueAt),
          estimatedMinutes: estimatedMinutes === '' ? null : Number(estimatedMinutes),
        },
      },
      { onSuccess: (updated) => onSaved?.(updated) },
    )
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div>
        <Label htmlFor="detail-title">Title</Label>
        <TextInput id="detail-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div>
        <Label htmlFor="detail-notes">Notes</Label>
        <TextArea id="detail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className={styles.row}>
        <div>
          <Label htmlFor="detail-priority">Priority</Label>
          <Select
            id="detail-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Task['priority'])}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="detail-estimated-minutes">Estimated minutes</Label>
          <TextInput
            id="detail-estimated-minutes"
            type="number"
            min="0"
            className="mono-figure"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="detail-due-at">Due</Label>
        <TextInput
          id="detail-due-at"
          type="datetime-local"
          className="mono-figure"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </div>

      {updateTask.isError && (
        <p role="alert" className={styles.error}>
          {apiErrorMessage(updateTask.error, 'Something went wrong saving this task.')}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={updateTask.isPending}>
        Save
      </Button>
    </form>
  )
}
