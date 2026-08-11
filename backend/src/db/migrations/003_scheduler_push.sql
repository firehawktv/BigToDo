-- One row per device the single user has installed the PWA on. `endpoint` is
-- the push service's URL for that device and is the natural key: resubscribing
-- the same device yields the same endpoint with possibly rotated keys.
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Single-row settings table. The boolean primary key with a CHECK is the
-- standard trick for "there can be only one": the PK admits one `true` row and
-- the CHECK forbids a `false` one.
CREATE TABLE check_in_settings (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled           boolean NOT NULL DEFAULT true,
  active_from       time NOT NULL DEFAULT '09:00',
  active_to         time NOT NULL DEFAULT '18:00',
  check_ins_per_day integer NOT NULL DEFAULT 3
                      CHECK (check_ins_per_day >= 0 AND check_ins_per_day <= 12),
  -- IANA zone. The design spec's "9am-6pm" is meaningless without one: the
  -- server runs UTC on a VPS and the user does not.
  timezone          text NOT NULL DEFAULT 'UTC',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (active_from < active_to)
);

INSERT INTO check_in_settings (id) VALUES (true);

-- One row per check-in actually sent. The scheduler counts today's rows to
-- decide how many it still owes, which is what makes the randomization
-- survive a process restart.
CREATE TABLE check_in_events (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX check_in_events_sent_at_idx ON check_in_events (sent_at);
