import { type FormEvent, useState } from 'react'
import { useUpdateTask } from './useTasks.js'
import type { Task } from '../api/types.js'

export function TaskDetail({ task, onSaved }: { task: Task; onSaved?: (task: Task) => void }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [priority, setPriority] = useState<Task['priority']>(task.priority)
  const [dueAt, setDueAt] = useState(task.dueAt ?? '')
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
          dueAt: dueAt === '' ? null : dueAt,
          estimatedMinutes: estimatedMinutes === '' ? null : Number(estimatedMinutes),
        },
      },
      { onSuccess: (updated) => onSaved?.(updated) },
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="detail-title">Title</label>
      <input id="detail-title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label htmlFor="detail-notes">Notes</label>
      <textarea id="detail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <label htmlFor="detail-priority">Priority</label>
      <select
        id="detail-priority"
        value={priority}
        onChange={(e) => setPriority(e.target.value as Task['priority'])}
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <label htmlFor="detail-due-at">Due</label>
      <input
        id="detail-due-at"
        type="datetime-local"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
      />

      <label htmlFor="detail-estimated-minutes">Estimated minutes</label>
      <input
        id="detail-estimated-minutes"
        type="number"
        min="0"
        value={estimatedMinutes}
        onChange={(e) => setEstimatedMinutes(e.target.value)}
      />

      <button type="submit" disabled={updateTask.isPending}>
        Save
      </button>
    </form>
  )
}
