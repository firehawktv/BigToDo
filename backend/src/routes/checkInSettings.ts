import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  CheckInSettingsSchema,
  UpdateCheckInSettingsBodySchema,
} from '../schemas/push.js'
import { ErrorSchema } from '../schemas/task.js'
import { parseHhMm } from '../scheduler/time.js'
import {
  getCheckInSettings,
  updateCheckInSettings,
  type CheckInSettings,
} from '../repositories/checkInSettings.js'

function toResponse(settings: CheckInSettings) {
  return { ...settings, updatedAt: settings.updatedAt.toISOString() }
}

/** A zone the runtime doesn't know would make every later sweep throw. */
function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export async function checkInSettingsRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/check-in-settings',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: CheckInSettingsSchema, 401: ErrorSchema } },
    },
    async () => toResponse(await getCheckInSettings()),
  )

  typedApp.patch(
    '/check-in-settings',
    {
      onRequest: app.requireAuth,
      schema: {
        body: UpdateCheckInSettingsBodySchema,
        response: { 200: CheckInSettingsSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const patch = request.body

      if (patch.timezone !== undefined && !isKnownTimezone(patch.timezone)) {
        return reply.code(400).send({ error: 'timezone is not a known IANA zone' })
      }

      // The window's ends can be patched independently, so validate the merged
      // result rather than only what was sent.
      const current = await getCheckInSettings()
      const from = parseHhMm(patch.activeFrom ?? current.activeFrom)
      const to = parseHhMm(patch.activeTo ?? current.activeTo)
      if (from >= to) {
        return reply.code(400).send({ error: 'activeFrom must be earlier than activeTo' })
      }

      return toResponse(await updateCheckInSettings(patch))
    },
  )
}
