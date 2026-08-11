import { Type } from '@sinclair/typebox'
import { TaskSchema } from './task.js'

export const CaptureBatchSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  rawText: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
})

export const CaptureBatchWithTasksSchema = Type.Intersect([
  CaptureBatchSchema,
  Type.Object({ tasks: Type.Array(TaskSchema) }),
])

export const CreateCaptureBatchSchema = Type.Object(
  {
    // minLength alone would let "   " through; the route trims before storing.
    rawText: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
)

export const CaptureBatchIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})
