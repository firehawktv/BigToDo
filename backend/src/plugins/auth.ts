import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import { config } from '../config.js'

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler
  }
}

const BEARER_PREFIX = 'Bearer '

/** Constant-time compare that does not leak length through early return timing. */
function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) {
    // Still burn a comparison so a length mismatch is not measurably faster.
    timingSafeEqual(expectedBuffer, expectedBuffer)
    return false
  }
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

const authPlugin: FastifyPluginAsync = async (app) => {
  const requireAuth: preHandlerHookHandler = async (request, reply) => {
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    if (!tokensMatch(header.slice(BEARER_PREFIX.length), config.apiToken)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  }

  app.decorate('requireAuth', requireAuth)
}

export default fp(authPlugin, { name: 'auth' })
