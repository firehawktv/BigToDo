import { Type } from '@sinclair/typebox'

/** Matches the browser's PushSubscription.toJSON() shape. */
export const SaveSubscriptionBodySchema = Type.Object(
  {
    endpoint: Type.String({ minLength: 1, maxLength: 2000 }),
    keys: Type.Object(
      {
        p256dh: Type.String({ minLength: 1, maxLength: 500 }),
        auth: Type.String({ minLength: 1, maxLength: 500 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const DeleteSubscriptionBodySchema = Type.Object(
  { endpoint: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
)

export const PushSubscriptionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  endpoint: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
})

export const VapidKeySchema = Type.Object({ publicKey: Type.String() })

export const PushResultSchema = Type.Object({
  sent: Type.Integer(),
  pruned: Type.Integer(),
  failed: Type.Integer(),
})

const HH_MM_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$'

export const CheckInSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  activeFrom: Type.String({ pattern: HH_MM_PATTERN }),
  activeTo: Type.String({ pattern: HH_MM_PATTERN }),
  checkInsPerDay: Type.Integer({ minimum: 0, maximum: 12 }),
  timezone: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const UpdateCheckInSettingsBodySchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    activeFrom: Type.Optional(Type.String({ pattern: HH_MM_PATTERN })),
    activeTo: Type.Optional(Type.String({ pattern: HH_MM_PATTERN })),
    checkInsPerDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  },
  { additionalProperties: false, minProperties: 1 },
)
