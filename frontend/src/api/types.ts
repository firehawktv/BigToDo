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

export interface CreateTaskInput {
  title: string
  notes?: string | null
  priority?: Task['priority']
  dueAt?: string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
}

export interface UpdateTaskInput {
  title?: string
  notes?: string | null
  status?: Task['status']
  priority?: Task['priority']
  dueAt?: string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
  suggestBreakdown?: boolean
}

export interface TaskListFilter {
  status?: Task['status']
  parentTaskId?: string | 'none'
  captureBatchId?: string
  maxEstimatedMinutes?: number
  limit?: number
}

export interface CaptureBatch {
  id: string
  rawText: string
  parseStatus: 'pending' | 'parsed' | 'failed'
  parseError: string | null
  createdAt: string
}

export type CaptureResponse =
  | { type: 'shortlist'; minutes: number; tasks: Task[] }
  | { type: 'batch'; batch: CaptureBatch; tasks: Task[] }

export interface ProposedSubtask {
  title: string
  estimatedMinutes: number | null
}

export interface CheckInSettings {
  enabled: boolean
  activeFrom: string
  activeTo: string
  checkInsPerDay: number
  timezone: string
  updatedAt: string
}
