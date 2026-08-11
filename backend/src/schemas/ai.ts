import { Type } from '@sinclair/typebox'
import { TaskSchema } from './task.js'
import { CaptureBatchSchema } from './captureBatch.js'

export const CaptureBodySchema = Type.Object(
  { rawText: Type.String({ minLength: 1, maxLength: 20_000 }) },
  { additionalProperties: false },
)

export const ShortlistResponseSchema = Type.Object({
  type: Type.Literal('shortlist'),
  minutes: Type.Integer(),
  tasks: Type.Array(TaskSchema),
})

export const CaptureBatchResponseSchema = Type.Object({
  type: Type.Literal('batch'),
  batch: CaptureBatchSchema,
  tasks: Type.Array(TaskSchema),
})

export const ReparseResponseSchema = Type.Object({
  batch: CaptureBatchSchema,
  tasks: Type.Array(TaskSchema),
})

export const ProposedSubtaskSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 500 }),
    estimatedMinutes: Type.Union([Type.Integer({ minimum: 1, maximum: 100_000 }), Type.Null()]),
  },
  { additionalProperties: false },
)

export const BreakdownResponseSchema = Type.Object({
  subtasks: Type.Array(ProposedSubtaskSchema),
})

// minItems is deliberately NOT enforced here: schema validation runs before the
// `preHandler` auth check, so an unauthenticated request with an empty array
// would 400 before ever reaching the 401. The empty-list rule is checked in
// the handler instead, after auth, so both orderings behave as documented.
export const SaveSubtasksBodySchema = Type.Object(
  { subtasks: Type.Array(ProposedSubtaskSchema, { maxItems: 20 }) },
  { additionalProperties: false },
)

export const SaveSubtasksResponseSchema = Type.Object({ tasks: Type.Array(TaskSchema) })

export const AvailableQuerySchema = Type.Object(
  { minutes: Type.Integer({ minimum: 1, maximum: 1440 }) },
  { additionalProperties: false },
)

export const AvailableResponseSchema = Type.Object({
  minutes: Type.Integer(),
  tasks: Type.Array(TaskSchema),
})
