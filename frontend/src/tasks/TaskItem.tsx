import { useState } from 'react'
import { useUpdateTask, useDeleteTask } from './useTasks.js'
import { TaskDetail } from './TaskDetail.js'
import { apiErrorMessage } from '../api/errors.js'
import type { Task } from '../api/types.js'
import { Card, Checkbox, Button, Flag } from '../ui/index.js'
import styles from './TaskItem.module.css'

function isOverdue(task: Task): boolean {
  return task.dueAt !== null && task.status === 'open' && new Date(task.dueAt) < new Date()
}

export function TaskItem({
  task,
  onBreakdownRequested,
}: {
  task: Task
  onBreakdownRequested: (task: Task) => void
}) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [isEditing, setIsEditing] = useState(false)

  // Never more than one amber flag at rest — overdue outranks priority.
  const flagLabel = isOverdue(task) ? 'Overdue' : task.priority === 'high' ? 'High' : null

  return (
    <Card as="li" className={task.status === 'done' ? styles.done : undefined}>
      <div className={styles.row}>
        <Checkbox
          aria-label={task.title}
          checked={task.status === 'done'}
          onChange={(e) =>
            updateTask.mutate({ id: task.id, patch: { status: e.target.checked ? 'done' : 'open' } })
          }
        />
        <span className={styles.title}>{task.title}</span>
        {flagLabel !== null && <Flag>{flagLabel}</Flag>}
        <div className={styles.actions}>
          {task.suggestBreakdown && (
            <Button size="small" onClick={() => onBreakdownRequested(task)}>
              Break this down?
            </Button>
          )}
          <Button size="small" variant="ghost" onClick={() => setIsEditing((prev) => !prev)}>
            {isEditing ? 'Cancel' : 'Edit'}
          </Button>
          <Button size="small" variant="danger" onClick={() => deleteTask.mutate(task.id)}>
            Delete
          </Button>
        </div>
      </div>
      {updateTask.isError && (
        <p role="alert" className={styles.error}>
          {apiErrorMessage(updateTask.error, 'Something went wrong updating this task.')}
        </p>
      )}
      {deleteTask.isError && (
        <p role="alert" className={styles.error}>
          {apiErrorMessage(deleteTask.error, 'Something went wrong deleting this task.')}
        </p>
      )}
      {isEditing && (
        <div className={styles.detail}>
          <TaskDetail task={task} onSaved={() => setIsEditing(false)} />
        </div>
      )}
    </Card>
  )
}
