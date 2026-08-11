import Fastify, { type FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'
import { taskRoutes } from './routes/tasks.js'
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

  await app.register(authPlugin)
  await app.register(healthRoutes)
  await app.register(taskRoutes)

  return app
}
