import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'
import { taskRoutes } from './routes/tasks.js'
import { captureBatchRoutes } from './routes/captureBatches.js'
import authPlugin from './plugins/auth.js'

export interface BuildAppOptions {
  logger?: boolean
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    // Fastify's default ajv options set removeAdditional: true, which silently
    // strips properties disallowed by `additionalProperties: false` instead of
    // rejecting the request. Our schemas rely on unknown properties producing
    // a 400, so that default is turned off here.
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>()

  // Every route declares its 4xx responses as { error: string } (see ErrorSchema).
  // Without this handler, anything that reaches Fastify's default handler — including
  // genuinely unexpected 5xxs — leaks as { statusCode, error, message } with the raw
  // internal message. This keeps the envelope consistent and status codes correct:
  // validation/4xx errors keep their status and message, everything else becomes a
  // generic 500 with the real error only logged server-side.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500

    if (statusCode >= 400 && statusCode < 500) {
      request.log.warn({ err: error }, 'request failed')
      return reply.code(statusCode).send({ error: error.message })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.code(500).send({ error: 'Internal Server Error' })
  })

  await app.register(authPlugin)
  await app.register(healthRoutes)
  await app.register(taskRoutes)
  await app.register(captureBatchRoutes)

  return app
}
