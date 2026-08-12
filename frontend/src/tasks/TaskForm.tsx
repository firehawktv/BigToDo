import { type FormEvent, useState } from 'react'
import { useCreateTask } from './useTasks.js'
import type { Task } from '../api/types.js'

export function TaskForm({ onCreated }: { onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState('')
  const createTask = useCreateTask()

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '') return
    createTask.mutate(
      { title: trimmed },
      {
        onSuccess: (task) => {
          setTitle('')
          onCreated(task)
        },
      },
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="task-title">Title</label>
      <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={createTask.isPending}>
        Add
      </button>
    </form>
  )
}
