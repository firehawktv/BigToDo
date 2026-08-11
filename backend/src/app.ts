import Fastify, { type FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'

export interface BuildAppOptions {
  logger?: boolean
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
  }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(healthRoutes)

  return app
}
