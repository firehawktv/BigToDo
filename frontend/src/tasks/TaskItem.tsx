import { useState } from 'react'
import { useUpdateTask, useDeleteTask } from './useTasks.js'
import { TaskDetail } from './TaskDetail.js'
import { apiErrorMessage } from '../api/errors.js'
import type { Task } from '../api/types.js'

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

  return (
    <li>
      <input
        type="checkbox"
        aria-label={task.title}
        checked={task.status === 'done'}
        onChange={(e) =>
          updateTask.mutate({ id: task.id, patch: { status: e.target.checked ? 'done' : 'open' } })
        }
      />
      <span>{task.title}</span>
      {task.suggestBreakdown && (
        <button type="button" onClick={() => onBreakdownRequested(task)}>
          Break this down?
        </button>
      )}
      <button type="button" onClick={() => setIsEditing((prev) => !prev)}>
        {isEditing ? 'Cancel' : 'Edit'}
      </button>
      <button type="button" onClick={() => deleteTask.mutate(task.id)}>
        Delete
      </button>
      {updateTask.isError && (
        <p role="alert">{apiErrorMessage(updateTask.error, 'Something went wrong updating this task.')}</p>
      )}
      {deleteTask.isError && (
        <p role="alert">{apiErrorMessage(deleteTask.error, 'Something went wrong deleting this task.')}</p>
      )}
      {isEditing && <TaskDetail task={task} onSaved={() => setIsEditing(false)} />}
    </li>
  )
}
