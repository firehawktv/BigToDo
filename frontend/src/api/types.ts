export interface Task {
  id: string
  title: string
  notes: string | null
  status: 'open' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueAt: string | null
  estimatedMinutes: number | null
  parentTaskId: string | null
  captureBatchId: string | null
  source: 'manual' | 'ai_parsed' | 'ai_breakdown'
  suggestBreakdown: boolean
  alertedAt: string | null
  createdAt: string
  completedAt: string | null
}

export interface CaptureBatch {
  id: string
  rawText: string
  parseStatus: 'pending' | 'parsed' | 'failed'
  parseError: string | null
  createdAt: string
}

export interface CheckInSettings {
  enabled: boolean
  activeFrom: string
  activeTo: string
  checkInsPerDay: number
  timezone: string
  updatedAt: string
}
