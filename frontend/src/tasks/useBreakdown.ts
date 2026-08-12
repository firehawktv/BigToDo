import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { ProposedSubtask, Task } from '../api/types.js'

export function useProposeBreakdown() {
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ subtasks: ProposedSubtask[] }>(`/tasks/${taskId}/breakdown`, {
        method: 'POST',
      }).then((r) => r.subtasks),
  })
}

export function useSaveSubtasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, subtasks }: { taskId: string; subtasks: ProposedSubtask[] }) =>
      apiFetch<{ tasks: Task[] }>(`/tasks/${taskId}/subtasks`, {
        method: 'POST',
        body: JSON.stringify({ subtasks }),
      }).then((r) => r.tasks),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
