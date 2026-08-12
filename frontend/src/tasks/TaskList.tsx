import { useState } from 'react'
import { useTasksQuery } from './useTasks.js'
import { TaskItem } from './TaskItem.js'
import { TaskForm } from './TaskForm.js'
import { BreakdownModal } from './BreakdownModal.js'
import type { Task } from '../api/types.js'

export function TaskList() {
  const { data: tasks, isLoading, isError } = useTasksQuery({ status: 'open' })
  const [breakdownTarget, setBreakdownTarget] = useState<Task | null>(null)

  if (isError) return <p>Something went wrong loading your tasks.</p>
  if (isLoading) return <p>Loading…</p>

  return (
    <div>
      <TaskForm onCreated={() => {}} />
      {tasks !== undefined && tasks.length === 0 ? (
        <p>Nothing open — you're all caught up.</p>
      ) : (
        <ul>
          {tasks?.map((task) => (
            <TaskItem key={task.id} task={task} onBreakdownRequested={setBreakdownTarget} />
          ))}
        </ul>
      )}
      {breakdownTarget !== null && (
        <BreakdownModal task={breakdownTarget} onClose={() => setBreakdownTarget(null)} />
      )}
    </div>
  )
}
