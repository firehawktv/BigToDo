import { getAnthropic } from './anthropic.js'
import { aiConfig } from './config.js'
import { AiUnavailableError } from './errors.js'
import { readStructuredJson, type ClaudeResponseLike } from './response.js'

export interface ParsedTaskDraft {
  title: string
  notes: string | null
  priority: 'low' | 'medium' | 'high'
  dueAt: Date | null
  estimatedMinutes: number | null
  suggestBreakdown: boolean
}

/**
 * Structured-output schema for the parse call.
 *
 * Deliberately NOT derived from CreateTaskSchema: structured outputs reject
 * `minLength`, `maximum`, and the other constraints that schema carries. Every
 * property is listed in `required` and made explicitly nullable instead, so the
 * model always emits a complete object and we do the range checking ourselves.
 */
const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'notes', 'priority', 'dueAt', 'estimatedMinutes', 'suggestBreakdown'],
        properties: {
          title: { type: 'string' },
          notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          dueAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          estimatedMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          suggestBreakdown: { type: 'boolean' },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = `You turn a person's freeform brain-dump into discrete, actionable tasks.

Split the input into separate tasks. One line usually means one task, but a single line can hold several, and several lines can describe one. Use judgement.

For each task:
- title: a short, clear, actionable phrase. Start with a verb where natural. Strip filler.
- notes: the original snippet if it carries detail the title loses, otherwise null.
- priority: infer from urgency language. "ASAP", "urgent", "!!", "today" mean high. A plain statement means medium. "sometime", "eventually", "someday" mean low.
- dueAt: an ISO-8601 UTC timestamp only when the text states or clearly implies a deadline. Resolve relative dates against the current date given below. Use null when no deadline is mentioned — do not invent one.
- estimatedMinutes: a realistic whole-minute estimate for one focused sitting, or null when you genuinely cannot tell.
- suggestBreakdown: true when the task is broad or vague enough that it is really a project — no single clear action, or phrasing like "redesign", "plan", "organize", "sort out", "look into". False for anything a person could sit down and just do.

Return every task you find. If the input contains no actionable task, return an empty list.`

const KNOWN_PRIORITIES = new Set(['low', 'medium', 'high'])

interface RawDraft {
  title?: unknown
  notes?: unknown
  priority?: unknown
  dueAt?: unknown
  estimatedMinutes?: unknown
  suggestBreakdown?: unknown
}

/** Postgres timestamptz can't hold a year outside this range. */
const MIN_TIMESTAMP_YEAR = 1
const MAX_TIMESTAMP_YEAR = 9999

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value)
  // The model occasionally returns something human-readable rather than ISO.
  // A bad date is not worth failing the whole batch over — drop it and let the
  // user set one, which they can already do by editing the task.
  if (Number.isNaN(date.getTime())) return null
  // JS Date accepts years outside 1..9999 (e.g. '+275760-09-13') that Postgres
  // timestamptz cannot store — dropping those here avoids a 500 on insert.
  const year = date.getUTCFullYear()
  if (year < MIN_TIMESTAMP_YEAR || year > MAX_TIMESTAMP_YEAR) return null
  return date
}

function toEstimate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  // The tasks table stores this as a plain integer; keep it inside that range.
  return Math.min(value, 100_000)
}

/** Matches the cap CreateTaskSchema and ProposedSubtaskSchema put on a title. */
const MAX_TITLE_LENGTH = 500

function toDraft(raw: RawDraft): ParsedTaskDraft | null {
  const trimmed = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (trimmed === '') return null
  const title = trimmed.slice(0, MAX_TITLE_LENGTH)

  return {
    title,
    notes: typeof raw.notes === 'string' && raw.notes.trim() !== '' ? raw.notes : null,
    priority: KNOWN_PRIORITIES.has(raw.priority as string)
      ? (raw.priority as ParsedTaskDraft['priority'])
      : 'medium',
    dueAt: toDate(raw.dueAt),
    estimatedMinutes: toEstimate(raw.estimatedMinutes),
    suggestBreakdown: raw.suggestBreakdown === true,
  }
}

export async function parseCapture(rawText: string, now: Date = new Date()): Promise<ParsedTaskDraft[]> {
  let response: ClaudeResponseLike

  try {
    // The request (including `output_config`) type-checks against the
    // installed SDK's types with no cast needed, and the SDK's real `Message`
    // result is structurally assignable to `ClaudeResponseLike` now that its
    // `stop_reason` field allows `null` too — no cast needed here either.
    response = await getAnthropic().messages.create({
      model: aiConfig().parseModel,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Current date and time: ${now.toISOString()}\n\nBrain-dump:\n${rawText}`,
        },
      ],
    })
  } catch (error) {
    throw new AiUnavailableError('Claude request failed', 'request_failed', { cause: error })
  }

  const payload = readStructuredJson(response, 'parse this input')

  const tasks = (payload as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) {
    throw new AiUnavailableError('Claude response had no tasks array', 'invalid_shape')
  }

  return tasks
    .map((raw) => toDraft((raw ?? {}) as RawDraft))
    .filter((draft): draft is ParsedTaskDraft => draft !== null)
}
