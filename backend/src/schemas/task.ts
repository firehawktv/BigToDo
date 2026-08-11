import { Type, type Static } from '@sinclair/typebox'

export const TaskStatusSchema = Type.Union([Type.Literal('open'), Type.Literal('done')])
export const TaskPrioritySchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
])
export const TaskSourceSchema = Type.Union([
  Type.Literal('manual'),
  Type.Literal('ai_parsed'),
  Type.Literal('ai_breakdown'),
])

export type TaskStatusValue = Static<typeof TaskStatusSchema>
export type TaskPriorityValue = Static<typeof TaskPrioritySchema>
export type TaskSourceValue = Static<typeof TaskSourceSchema>

const Nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()])

const UuidSchema = Type.String({ format: 'uuid' })
const DateTimeSchema = Type.String({ format: 'date-time' })

/** The task as it appears in every API response. */
export const TaskSchema = Type.Object({
  id: UuidSchema,
  title: Type.String(),
  notes: Nullable(Type.String()),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueAt: Nullable(DateTimeSchema),
  estimatedMinutes: Type.Union([Type.Integer(), Type.Null()]),
  parentTaskId: Nullable(UuidSchema),
  captureBatchId: Nullable(UuidSchema),
  source: TaskSourceSchema,
  alertedAt: Nullable(DateTimeSchema),
  createdAt: DateTimeSchema,
  completedAt: Nullable(DateTimeSchema),
})

export const CreateTaskSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 500 }),
    notes: Type.Optional(Nullable(Type.String({ maxLength: 10_000 }))),
    priority: Type.Optional(TaskPrioritySchema),
    dueAt: Type.Optional(Nullable(DateTimeSchema)),
    estimatedMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    parentTaskId: Type.Optional(Nullable(UuidSchema)),
    captureBatchId: Type.Optional(Nullable(UuidSchema)),
    source: Type.Optional(TaskSourceSchema),
  },
  { additionalProperties: false },
)

export const UpdateTaskSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    notes: Type.Optional(Nullable(Type.String({ maxLength: 10_000 }))),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    dueAt: Type.Optional(Nullable(DateTimeSchema)),
    estimatedMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    parentTaskId: Type.Optional(Nullable(UuidSchema)),
  },
  { additionalProperties: false, minProperties: 1 },
)

export const ListTasksQuerySchema = Type.Object(
  {
    status: Type.Optional(TaskStatusSchema),
    parentTaskId: Type.Optional(Type.Union([UuidSchema, Type.Literal('none')])),
    captureBatchId: Type.Optional(UuidSchema),
    maxEstimatedMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
)

export const TaskIdParamsSchema = Type.Object({ id: UuidSchema })
export const ErrorSchema = Type.Object({ error: Type.String() })
