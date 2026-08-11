import { anthropic } from './anthropic.js'
import { aiConfig } from './config.js'
import { AiUnavailableError } from './errors.js'
import { readStructuredJson, type ClaudeResponseLike } from './response.js'

export interface ProposedSubtask {
  title: string
  estimatedMinutes: number | null
}

/** More than this many steps stops being a plan and starts being a wall. */
const MAX_SUBTASKS = 20

const BREAKDOWN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subtasks'],
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'estimatedMinutes'],
        properties: {
          title: { type: 'string' },
          estimatedMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = `You break a vague or oversized task into concrete next actions for someone who struggles to start when a task feels large.

Rules:
- Every subtask is something the person could sit down and actually do. No "think about", no "research" without a target, no "plan the plan".
- Order them the way they should be done.
- Aim for three to seven subtasks. Fewer if the task is smaller than it looked; never more than ${MAX_SUBTASKS}.
- Give each one a realistic whole-minute estimate for a single focused sitting, or null if you genuinely cannot tell.
- The first subtask should be the smallest possible way to begin — the thing that gets the person unstuck.

Return only the subtasks.`

interface RawSubtask {
  title?: unknown
  estimatedMinutes?: unknown
}

function toSubtask(raw: RawSubtask): ProposedSubtask | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title === '') return null

  const estimate = raw.estimatedMinutes
  const estimatedMinutes =
    typeof estimate === 'number' && Number.isInteger(estimate) && estimate > 0
      ? Math.min(estimate, 100_000)
      : null

  return { title, estimatedMinutes }
}

export async function proposeBreakdown(
  task: { title: string; notes: string | null },
): Promise<ProposedSubtask[]> {
  let response: ClaudeResponseLike

  const details = task.notes === null ? task.title : `${task.title}\n\nNotes: ${task.notes}`

  try {
    response = await anthropic.messages.create({
      model: aiConfig.breakdownModel,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: BREAKDOWN_SCHEMA },
      },
      messages: [{ role: 'user', content: `Break down this task:\n\n${details}` }],
    })
  } catch (error) {
    throw new AiUnavailableError('Claude request failed', 'request_failed', { cause: error })
  }

  const payload = readStructuredJson(response, 'break down this task')

  const subtasks = (payload as { subtasks?: unknown } | null)?.subtasks
  if (!Array.isArray(subtasks)) {
    throw new AiUnavailableError('Claude response had no subtasks array', 'invalid_shape')
  }

  return subtasks
    .map((raw) => toSubtask((raw ?? {}) as RawSubtask))
    .filter((subtask): subtask is ProposedSubtask => subtask !== null)
    .slice(0, MAX_SUBTASKS)
}
