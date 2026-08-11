import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import {
  CreateTaskSchema,
  ErrorSchema,
  ListTasksQuerySchema,
  TaskIdParamsSchema,
  TaskSchema,
  UpdateTaskSchema,
} from '../schemas/task.js'
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type ListTasksFilter,
} from '../repositories/tasks.js'
import { toTaskResponse } from './serialize.js'

/** Postgres foreign-key violation — raised when parentTaskId/captureBatchId points nowhere. */
const FOREIGN_KEY_VIOLATION = '23503'

/** Maps the FK constraint name to the request field it validates. */
const FOREIGN_KEY_FIELD_BY_CONSTRAINT: Record<string, string> = {
  tasks_parent_task_id_fkey: 'parentTaskId',
  tasks_capture_batch_id_fkey: 'captureBatchId',
}

/** Returns the request field name a foreign-key violation maps to, or undefined otherwise. */
function foreignKeyViolationField(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  if ((error as { code?: string }).code !== FOREIGN_KEY_VIOLATION) return undefined
  const constraint = (error as { constraint?: string }).constraint
  return constraint !== undefined ? FOREIGN_KEY_FIELD_BY_CONSTRAINT[constraint] : undefined
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/tasks',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CreateTaskSchema,
        response: { 201: TaskSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim()
      if (title === '') {
        return reply.code(400).send({ error: 'title must not be blank' })
      }

      try {
        const task = await createTask({ ...request.body, title })
        return reply.code(201).send(toTaskResponse(task))
      } catch (error) {
        const field = foreignKeyViolationField(error)
        if (field !== undefined) {
          return reply.code(400).send({ error: `${field} does not exist` })
        }
        throw error
      }
    },
  )

  typedApp.get(
    '/tasks',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: ListTasksQuerySchema,
        response: {
          200: Type.Object({ tasks: Type.Array(TaskSchema) }),
          401: ErrorSchema,
        },
      },
    },
    async (request) => {
      const query = request.query
      const filter: ListTasksFilter = {}

      if (query.status !== undefined) filter.status = query.status
      // 'none' is the querystring spelling of "top-level only" — a bare
      // parentTaskId= would be indistinguishable from an omitted filter.
      if (query.parentTaskId !== undefined) {
        filter.parentTaskId = query.parentTaskId === 'none' ? null : query.parentTaskId
      }
      if (query.captureBatchId !== undefined) filter.captureBatchId = query.captureBatchId
      if (query.maxEstimatedMinutes !== undefined) {
        filter.maxEstimatedMinutes = query.maxEstimatedMinutes
      }
      if (query.limit !== undefined) filter.limit = query.limit

      return { tasks: (await listTasks(filter)).map(toTaskResponse) }
    },
  )

  typedApp.get(
    '/tasks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        response: { 200: TaskSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const task = await getTask(request.params.id)
      if (task === null) return reply.code(404).send({ error: 'Task not found' })
      return toTaskResponse(task)
    },
  )

  typedApp.patch(
    '/tasks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        body: UpdateTaskSchema,
        response: { 200: TaskSchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const patch = { ...request.body }

      if (patch.title !== undefined) {
        const title = patch.title.trim()
        if (title === '') {
          return reply.code(400).send({ error: 'title must not be blank' })
        }
        patch.title = title
      }

      if (patch.parentTaskId !== undefined && patch.parentTaskId === request.params.id) {
        return reply.code(400).send({ error: 'a task cannot be its own parent' })
      }

      try {
        const task = await updateTask(request.params.id, patch)
        if (task === null) return reply.code(404).send({ error: 'Task not found' })
        return toTaskResponse(task)
      } catch (error) {
        const field = foreignKeyViolationField(error)
        if (field !== undefined) {
          return reply.code(400).send({ error: `${field} does not exist` })
        }
        throw error
      }
    },
  )

  typedApp.delete(
    '/tasks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        response: { 204: Type.Null(), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const deleted = await deleteTask(request.params.id)
      if (!deleted) return reply.code(404).send({ error: 'Task not found' })
      return reply.code(204).send(null)
    },
  )
}
