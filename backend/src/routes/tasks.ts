import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type, type Static } from '@sinclair/typebox'
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
  type Task,
} from '../repositories/tasks.js'

/** Postgres foreign-key violation — raised when parentTaskId points nowhere. */
const FOREIGN_KEY_VIOLATION = '23503'

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === FOREIGN_KEY_VIOLATION
}

/**
 * Converts a repository `Task` (timestamps as `Date | null` / `Date`) into the
 * wire shape `TaskSchema` declares (timestamps as ISO strings). This is a real
 * conversion, not a cast — it is what actually produces the ISO strings the
 * response carries, independent of any serializer behavior.
 */
type TaskResponse = Static<typeof TaskSchema>
function toResponse(task: Task): TaskResponse {
  return {
    ...task,
    dueAt: task.dueAt?.toISOString() ?? null,
    alertedAt: task.alertedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  }
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
      try {
        const task = await createTask(request.body)
        return reply.code(201).send(toResponse(task))
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          return reply.code(400).send({ error: 'parentTaskId does not exist' })
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

      return { tasks: (await listTasks(filter)).map(toResponse) }
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
      return toResponse(task)
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
      try {
        const task = await updateTask(request.params.id, request.body)
        if (task === null) return reply.code(404).send({ error: 'Task not found' })
        return toResponse(task)
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          return reply.code(400).send({ error: 'parentTaskId does not exist' })
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
