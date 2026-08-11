-- Haiku flags tasks that look like big/vague projects during the same parsing
-- pass, so the UI can offer a "Break this down?" affordance without a second
-- AI call. Cleared once the task actually has subtasks.
ALTER TABLE tasks
  ADD COLUMN suggest_breakdown boolean NOT NULL DEFAULT false;

CREATE TYPE capture_parse_status AS ENUM ('pending', 'parsed', 'failed');

-- A batch is stored before parsing is attempted, so the raw text survives an
-- AI failure. parse_error carries the reason so the UI can explain the retry.
ALTER TABLE capture_batches
  ADD COLUMN parse_status capture_parse_status NOT NULL DEFAULT 'pending',
  ADD COLUMN parse_error text;
