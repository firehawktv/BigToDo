import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  CaptureBatchIdParamsSchema,
  CaptureBatchSchema,
  CaptureBatchWithTasksSchema,
  CreateCaptureBatchSchema,
} from '../schemas/captureBatch.js'
import { ErrorSchema } from '../schemas/task.js'
import { createCaptureBatch, getCaptureBatch } from '../repositories/captureBatches.js'
import { listTasks } from '../repositories/tasks.js'
import { toCaptureBatchResponse, toTaskResponse } from './serialize.js'

export async function captureBatchRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/capture-batches',
    {
      onRequest: app.requireAuth,
      schema: {
        body: CreateCaptureBatchSchema,
        response: { 201: CaptureBatchSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const rawText = request.body.rawText.trim()
      if (rawText === '') {
        return reply.code(400).send({ error: 'rawText must not be blank' })
      }
      const batch = await createCaptureBatch(rawText)
      return reply.code(201).send(toCaptureBatchResponse(batch))
    },
  )

  typedApp.get(
    '/capture-batches/:id',
    {
      onRequest: app.requireAuth,
      schema: {
        params: CaptureBatchIdParamsSchema,
        response: { 200: CaptureBatchWithTasksSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const batch = await getCaptureBatch(request.params.id)
      if (batch === null) return reply.code(404).send({ error: 'Capture batch not found' })

      const tasks = await listTasks({ captureBatchId: batch.id })
      return { ...toCaptureBatchResponse(batch), tasks: tasks.map(toTaskResponse) }
    },
  )
}
