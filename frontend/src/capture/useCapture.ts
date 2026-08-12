import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { CaptureBatch, CaptureResponse, Task } from '../api/types.js'

export function useCapture() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rawText: string) =>
      apiFetch<CaptureResponse>('/capture', { method: 'POST', body: JSON.stringify({ rawText }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useReparseCaptureBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (batchId: string) =>
      apiFetch<{ batch: CaptureBatch; tasks: Task[] }>(`/capture-batches/${batchId}/parse`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
