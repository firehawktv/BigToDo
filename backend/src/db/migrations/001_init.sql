CREATE TYPE task_status AS ENUM ('open', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE task_source AS ENUM ('manual', 'ai_parsed', 'ai_breakdown');

CREATE TABLE capture_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL CHECK (length(btrim(title)) > 0),
  notes              text,
  status             task_status NOT NULL DEFAULT 'open',
  priority           task_priority NOT NULL DEFAULT 'medium',
  due_at             timestamptz,
  estimated_minutes  integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  parent_task_id     uuid REFERENCES tasks (id) ON DELETE CASCADE,
  capture_batch_id   uuid REFERENCES capture_batches (id) ON DELETE SET NULL,
  source             task_source NOT NULL DEFAULT 'manual',
  alerted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

-- Deadline-alert sweep: open tasks with a due date, ordered by due_at.
CREATE INDEX tasks_open_due_at_idx ON tasks (due_at) WHERE status = 'open';

-- Subtask lookups when rendering a broken-down project.
CREATE INDEX tasks_parent_task_id_idx ON tasks (parent_task_id);

-- Review list for a freshly parsed capture batch.
CREATE INDEX tasks_capture_batch_id_idx ON tasks (capture_batch_id);
