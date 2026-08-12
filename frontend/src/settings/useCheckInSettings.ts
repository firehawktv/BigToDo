import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { CheckInSettings } from '../api/types.js'

const SETTINGS_KEY = ['check-in-settings'] as const

export function useCheckInSettingsQuery() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<CheckInSettings>('/check-in-settings'),
  })
}

export function useUpdateCheckInSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<CheckInSettings>) =>
      apiFetch<CheckInSettings>('/check-in-settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })
}
