import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import {
  DeleteSubscriptionBodySchema,
  PushResultSchema,
  PushSubscriptionSchema,
  SaveSubscriptionBodySchema,
  VapidKeySchema,
} from '../schemas/push.js'
import { ErrorSchema } from '../schemas/task.js'
import { pushConfig } from '../push/config.js'
import { sendToAllSubscriptions } from '../push/send.js'
import {
  deletePushSubscriptionByEndpoint,
  savePushSubscription,
  type PushSubscriptionRecord,
} from '../repositories/pushSubscriptions.js'

function toResponse(record: PushSubscriptionRecord) {
  // p256dh and auth are the device's own encryption material — the client
  // already has them, and there is no reason to echo them back.
  return {
    id: record.id,
    endpoint: record.endpoint,
    createdAt: record.createdAt.toISOString(),
  }
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/push/vapid-public-key',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: VapidKeySchema, 401: ErrorSchema } },
    },
    async () => ({ publicKey: pushConfig().publicKey }),
  )

  typedApp.post(
    '/push/subscriptions',
    {
      onRequest: app.requireAuth,
      schema: {
        body: SaveSubscriptionBodySchema,
        response: { 201: PushSubscriptionSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const saved = await savePushSubscription({
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        auth: request.body.keys.auth,
      })
      return reply.code(201).send(toResponse(saved))
    },
  )

  typedApp.delete(
    '/push/subscriptions',
    {
      onRequest: app.requireAuth,
      schema: {
        body: DeleteSubscriptionBodySchema,
        response: { 204: Type.Null(), 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const deleted = await deletePushSubscriptionByEndpoint(request.body.endpoint)
      if (!deleted) return reply.code(404).send({ error: 'Subscription not found' })
      return reply.code(204).send(null)
    },
  )

  typedApp.post(
    '/push/test',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: PushResultSchema, 401: ErrorSchema } },
    },
    async (request) =>
      // Verifying push end to end on iOS is fiddly enough that a deliberate
      // test send is worth the endpoint.
      sendToAllSubscriptions(
        { title: 'ToDo', body: 'Test notification — push is working.', url: pushConfig().appUrl },
        request.log,
      ),
  )
}
