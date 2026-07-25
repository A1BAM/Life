-- Full schema proposal per spec section 6.
-- Single-user: no tenancy. Every table gets timestamps.
-- Only the study engine + auth tables are wired to code in Phase 1;
-- the rest exist so later modules build on an approved shape.

-- ============ auth ============
CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- ============ study engine ============
CREATE TABLE courses (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT,
  term        TEXT,
  grade_min   REAL NOT NULL DEFAULT 80,   -- nursing pass threshold
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE exams (
  id          INTEGER PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  exam_date   TEXT,                        -- YYYY-MM-DD
  weight      REAL NOT NULL DEFAULT 0,     -- percent of course grade
  score       REAL,                        -- null until graded
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE units (
  id          INTEGER PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(course_id, name)
);

CREATE TABLE questions (
  id                  INTEGER PRIMARY KEY,
  course_id           INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  unit_id             INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  topic               TEXT,                -- finer-grained label from the generator
  nclex_category      TEXT,               -- one of the 8 client-need categories (feeds module 4.6)
  stem                TEXT NOT NULL,
  options             TEXT NOT NULL,       -- JSON array of 4 strings
  correct_index       INTEGER NOT NULL,
  rationales          TEXT NOT NULL,       -- JSON array of 4 strings (why each option is right/wrong)
  source              TEXT NOT NULL DEFAULT 'generated',  -- generated | manual
  status              TEXT NOT NULL DEFAULT 'active',     -- active | retired
  consecutive_correct INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_questions_course_unit ON questions(course_id, unit_id, status);

CREATE TABLE question_attempts (
  id             INTEGER PRIMARY KEY,
  question_id    INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answered_index INTEGER NOT NULL,
  correct        INTEGER NOT NULL,
  answered_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attempts_question ON question_attempts(question_id, answered_at);

-- Spaced repetition: wrong answers enter at stage 0 (1d), then 3d, 7d.
-- Two consecutive corrects retire the question.
CREATE TABLE review_queue (
  question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  stage       INTEGER NOT NULL DEFAULT 0,  -- 0=1d, 1=3d, 2=7d
  due_at      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ingest_jobs (
  id                INTEGER PRIMARY KEY,
  course_id         INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  unit_id           INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  filename          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  total_chunks      INTEGER NOT NULL DEFAULT 0,
  done_chunks       INTEGER NOT NULL DEFAULT 0,
  questions_created INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ training (module 4.2) ============
CREATE TABLE weekly_targets (
  id              INTEGER PRIMARY KEY,
  week_start      TEXT NOT NULL UNIQUE,    -- Monday, YYYY-MM-DD
  target_sessions INTEGER NOT NULL DEFAULT 4,
  plan            TEXT,                    -- JSON: per-day intent, e.g. ["push","pull",null,...]
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workouts (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,               -- YYYY-MM-DD
  type        TEXT,                        -- push | pull | other
  source      TEXT NOT NULL DEFAULT 'manual',  -- manual | liftlogic
  volume      TEXT,                        -- JSON: sets per muscle group (from LiftLogic when readable)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ dating & social (module 4.1) ============
CREATE TABLE matches (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  app           TEXT NOT NULL,             -- hinge | pof
  matched_on    TEXT,                      -- YYYY-MM-DD
  status        TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL,               -- sent | received
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  body        TEXT,                        -- optional; facts and status only
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE confidence_reps (
  id          INTEGER PRIMARY KEY,
  text        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE confidence_rep_completions (
  id          INTEGER PRIMARY KEY,
  rep_id      INTEGER NOT NULL REFERENCES confidence_reps(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,               -- YYYY-MM-DD
  done        INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(rep_id, date)
);

-- ============ relapse tracker (module 4.5) ============
CREATE TABLE urge_events (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  context_tag TEXT NOT NULL,               -- user-defined tags, seeded from spec examples
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reset_events (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  context_tag TEXT,                        -- optional
  note        TEXT,                        -- optional, never required
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE if_then_plans (
  id          INTEGER PRIMARY KEY,
  trigger_tag TEXT NOT NULL UNIQUE,
  action_text TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ calendar (module 4.4) ============
CREATE TABLE calendar_tokens (
  id            INTEGER PRIMARY KEY,
  provider      TEXT NOT NULL DEFAULT 'google',
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,
  calendar_ids  TEXT,                      -- JSON array of selected calendar ids
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ NCLEX & licensure (module 4.6) ============
CREATE TABLE licensure_milestones (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done | blocked
  due_date    TEXT,                        -- YYYY-MM-DD, derived from graduation date
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ jobs & resume (module 4.7) ============
CREATE TABLE applications (
  id               INTEGER PRIMARY KEY,
  hospital         TEXT NOT NULL,
  unit             TEXT,
  role             TEXT,
  applied_on       TEXT,                   -- YYYY-MM-DD
  stage            TEXT NOT NULL DEFAULT 'applied',  -- applied | screen | interview | offer | declined
  next_action      TEXT,
  next_action_date TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE target_programs (
  id          INTEGER PRIMARY KEY,
  hospital    TEXT NOT NULL,
  program     TEXT,
  opens_on    TEXT,                        -- YYYY-MM-DD
  closes_on   TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE resume_variants (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  is_master      INTEGER NOT NULL DEFAULT 0,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  content        TEXT NOT NULL DEFAULT '', -- markdown
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE interview_answers (
  id          INTEGER PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ daily non-negotiables (module 4.8) ============
CREATE TABLE nn_items (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE nn_completions (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES nn_items(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,               -- YYYY-MM-DD
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, date)
);

-- ============ grooming cadence (module 4.9) ============
CREATE TABLE grooming_items (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  last_done     TEXT,                      -- YYYY-MM-DD
  ref_note      TEXT,                      -- e.g. guard numbers / zone map for the fade
  ref_image     TEXT,                      -- path to stored reference image
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ money & subscriptions (module 4.10) ============
CREATE TABLE recurring_charges (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  cycle        TEXT NOT NULL DEFAULT 'monthly',  -- monthly | annual
  billing_day  INTEGER,                    -- day of month (monthly) or renewal date handling in app
  renews_on    TEXT,                       -- YYYY-MM-DD, for annual
  category     TEXT,
  last_used    TEXT,                       -- YYYY-MM-DD, set manually
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ledger_entries (
  id           INTEGER PRIMARY KEY,
  month        TEXT NOT NULL,              -- YYYY-MM
  kind         TEXT NOT NULL,              -- income | fixed | discretionary
  label        TEXT,
  amount_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ home lab (module 4.12) ============
CREATE TABLE services (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,               -- health endpoint to poll
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE health_checks (
  id          INTEGER PRIMARY KEY,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL,
  latency_ms  INTEGER,
  detail      TEXT                         -- JSON: service-specific metrics
);
CREATE INDEX idx_health_checks_service ON health_checks(service_id, at);
