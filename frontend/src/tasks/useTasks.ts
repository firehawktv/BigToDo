import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { CreateTaskInput, Task, TaskListFilter, UpdateTaskInput } from '../api/types.js'

const TASKS_KEY = ['tasks'] as const

function toQueryString(filter: TaskListFilter): string {
  const params = new URLSearchParams()
  if (filter.status !== undefined) params.set('status', filter.status)
  if (filter.parentTaskId !== undefined) params.set('parentTaskId', filter.parentTaskId)
  if (filter.captureBatchId !== undefined) params.set('captureBatchId', filter.captureBatchId)
  if (filter.maxEstimatedMinutes !== undefined) {
    params.set('maxEstimatedMinutes', String(filter.maxEstimatedMinutes))
  }
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

export function useTasksQuery(filter: TaskListFilter = {}) {
  return useQuery({
    queryKey: [...TASKS_KEY, filter],
    queryFn: () => apiFetch<{ tasks: Task[] }>(`/tasks${toQueryString(filter)}`).then((r) => r.tasks),
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}
