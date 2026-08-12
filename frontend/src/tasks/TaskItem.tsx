import { useUpdateTask, useDeleteTask } from './useTasks.js'
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
      <button type="button" onClick={() => deleteTask.mutate(task.id)}>
        Delete
      </button>
    </li>
  )
}
