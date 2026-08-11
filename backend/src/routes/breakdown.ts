import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  BreakdownResponseSchema,
  SaveSubtasksBodySchema,
  SaveSubtasksResponseSchema,
} from '../schemas/ai.js'
import { ErrorSchema, TaskIdParamsSchema } from '../schemas/task.js'
import { proposeBreakdown } from '../ai/breakdown.js'
import { AiUnavailableError } from '../ai/errors.js'
import { createTasks, getTask, updateTask } from '../repositories/tasks.js'
import { toTaskResponse } from './serialize.js'

export async function breakdownRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/tasks/:id/breakdown',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        response: {
          200: BreakdownResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const task = await getTask(request.params.id)
      if (task === null) return reply.code(404).send({ error: 'Task not found' })

      try {
        // Nothing is saved here — the spec requires the user reviews and edits
        // the proposal before any subtask exists.
        return { subtasks: await proposeBreakdown({ title: task.title, notes: task.notes }) }
      } catch (error) {
        if (error instanceof AiUnavailableError) {
          request.log.warn({ err: error, reason: error.reason }, 'breakdown unavailable')
          return reply.code(503).send({ error: 'Breakdown is unavailable right now' })
        }
        throw error
      }
    },
  )

  typedApp.post(
    '/tasks/:id/subtasks',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        body: SaveSubtasksBodySchema,
        response: {
          201: SaveSubtasksResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const parent = await getTask(request.params.id)
      if (parent === null) return reply.code(404).send({ error: 'Task not found' })

      if (request.body.subtasks.length === 0) {
        return reply.code(400).send({ error: 'subtasks must not be empty' })
      }

      const subtasks = request.body.subtasks.map((subtask) => ({
        ...subtask,
        title: subtask.title.trim(),
      }))
      if (subtasks.some((subtask) => subtask.title === '')) {
        return reply.code(400).send({ error: 'subtask titles must not be blank' })
      }

      const created = await createTasks(
        subtasks.map((subtask) => ({
          title: subtask.title,
          estimatedMinutes: subtask.estimatedMinutes,
          parentTaskId: parent.id,
          source: 'ai_breakdown' as const,
        })),
      )

      // The parent is a project now, so the "Break this down?" affordance has
      // done its job.
      await updateTask(parent.id, { suggestBreakdown: false })

      return reply.code(201).send({ tasks: created.map(toTaskResponse) })
    },
  )
}
