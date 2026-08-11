import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  AvailableQuerySchema,
  AvailableResponseSchema,
  CaptureBatchResponseSchema,
  CaptureBodySchema,
  ReparseResponseSchema,
  ShortlistResponseSchema,
} from '../schemas/ai.js'
import { CaptureBatchIdParamsSchema } from '../schemas/captureBatch.js'
import { ErrorSchema } from '../schemas/task.js'
import { parseCapture, type ParsedTaskDraft } from '../ai/parseCapture.js'
import { detectTimeAvailable } from '../ai/timeAvailable.js'
import { AiUnavailableError } from '../ai/errors.js'
import {
  createCaptureBatch,
  getCaptureBatch,
  setCaptureBatchParseStatus,
  type CaptureBatch,
} from '../repositories/captureBatches.js'
import { createTasks, deleteTask, listTasks, type Task } from '../repositories/tasks.js'
import { toCaptureBatchResponse, toTaskResponse } from './serialize.js'

/** Short enough to stay glanceable, long enough to feel like a choice. */
const SHORTLIST_SIZE = 5

/** A fallback task's title is one line; the full dump lives in its notes. */
const FALLBACK_TITLE_LIMIT = 120

function draftsToTasks(drafts: ParsedTaskDraft[], batchId: string) {
  return drafts.map((draft) => ({
    title: draft.title,
    notes: draft.notes,
    priority: draft.priority,
    dueAt: draft.dueAt,
    estimatedMinutes: draft.estimatedMinutes,
    suggestBreakdown: draft.suggestBreakdown,
    captureBatchId: batchId,
    source: 'ai_parsed' as const,
  }))
}

/**
 * When parsing fails the raw dump is already saved, but a batch the user can't
 * see isn't much comfort — so we also create a single ordinary task carrying
 * the text. They can edit it by hand or hit retry.
 */
function fallbackTask(rawText: string, batchId: string) {
  const firstLine = rawText.split('\n')[0]!.trim()
  const title =
    firstLine.length > FALLBACK_TITLE_LIMIT
      ? `${firstLine.slice(0, FALLBACK_TITLE_LIMIT - 1)}…`
      : firstLine
  return {
    title: title === '' ? 'Unparsed capture' : title,
    notes: rawText,
    captureBatchId: batchId,
    source: 'manual' as const,
  }
}

async function shortlist(minutes: number): Promise<Task[]> {
  return listTasks({ status: 'open', maxEstimatedMinutes: minutes, limit: SHORTLIST_SIZE })
}

async function runParse(
  batch: CaptureBatch,
): Promise<{ batch: CaptureBatch; tasks: Task[] }> {
  try {
    const drafts = await parseCapture(batch.rawText)
    const tasks = await createTasks(draftsToTasks(drafts, batch.id))
    const updated = await setCaptureBatchParseStatus(batch.id, 'parsed')
    return { batch: updated ?? batch, tasks }
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error
    const tasks = await createTasks([fallbackTask(batch.rawText, batch.id)])
    const updated = await setCaptureBatchParseStatus(batch.id, 'failed', error.message)
    return { batch: updated ?? batch, tasks }
  }
}

export async function captureRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/capture',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CaptureBodySchema,
        response: {
          200: ShortlistResponseSchema,
          201: CaptureBatchResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const rawText = request.body.rawText.trim()
      if (rawText === '') {
        return reply.code(400).send({ error: 'rawText must not be blank' })
      }

      // A time-available question is a query, not a capture — answer it and
      // save nothing, so asking twice doesn't litter the list.
      const minutes = detectTimeAvailable(rawText)
      if (minutes !== null) {
        return {
          type: 'shortlist' as const,
          minutes,
          tasks: (await shortlist(minutes)).map(toTaskResponse),
        }
      }

      const batch = await createCaptureBatch(rawText)
      const result = await runParse(batch)

      return reply.code(201).send({
        type: 'batch' as const,
        batch: toCaptureBatchResponse(result.batch),
        tasks: result.tasks.map(toTaskResponse),
      })
    },
  )

  typedApp.post(
    '/capture-batches/:id/parse',
    {
      preHandler: app.requireAuth,
      schema: {
        params: CaptureBatchIdParamsSchema,
        response: {
          200: ReparseResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const batch = await getCaptureBatch(request.params.id)
      if (batch === null) return reply.code(404).send({ error: 'Capture batch not found' })
      if (batch.parseStatus !== 'failed') {
        return reply.code(409).send({ error: 'Only a failed capture batch can be re-parsed' })
      }

      // Clear the fallback task from the previous attempt so a retry doesn't
      // leave a duplicate behind.
      for (const stale of await listTasks({ captureBatchId: batch.id })) {
        await deleteTask(stale.id)
      }

      const result = await runParse(batch)

      return {
        batch: toCaptureBatchResponse(result.batch),
        tasks: result.tasks.map(toTaskResponse),
      }
    },
  )

  typedApp.get(
    '/tasks/available',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: AvailableQuerySchema,
        response: { 200: AvailableResponseSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request) => ({
      minutes: request.query.minutes,
      tasks: (await shortlist(request.query.minutes)).map(toTaskResponse),
    }),
  )
}
