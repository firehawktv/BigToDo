import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<TypeBoxTypeProvider>().get(
    '/health',
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal('ok') }),
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  )
}
