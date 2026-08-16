import { type FormEvent, useState } from 'react'
import { useCreateTask } from './useTasks.js'
import { apiErrorMessage } from '../api/errors.js'
import type { Task } from '../api/types.js'
import { Button, TextInput } from '../ui/index.js'
import styles from './TaskForm.module.css'

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
    <div>
      <form onSubmit={handleSubmit} className={styles.form}>
        <label htmlFor="task-title" className={styles.label}>
          Title
        </label>
        <TextInput
          id="task-title"
          className={styles.input}
          placeholder="Add a task directly…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={createTask.isPending}>
          Add
        </Button>
      </form>
      {createTask.isError && (
        <p role="alert" className={styles.error}>
          {apiErrorMessage(createTask.error, 'Something went wrong adding this task.')}
        </p>
      )}
    </div>
  )
}
