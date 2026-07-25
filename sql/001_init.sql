-- Life — Neon (Postgres) schema.
-- Paste into the Neon SQL Editor, or: psql "$DATABASE_URL" -f sql/001_init.sql
-- Idempotent: safe to re-run.

-- ---------- shared: updated_at maintenance ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STUDY ENGINE  (wired to code)
-- ============================================================

CREATE TABLE IF NOT EXISTS courses (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text        NOT NULL,
  code       text,
  term       text,
  grade_min  numeric(5,2) NOT NULL DEFAULT 80,
  archived   boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exams (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name      text   NOT NULL,
  exam_date date,
  weight    numeric(5,2) NOT NULL DEFAULT 0,   -- percent of course grade
  score     numeric(5,2),                      -- NULL until graded
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exams_course ON exams(course_id, exam_date);

CREATE TABLE IF NOT EXISTS units (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name      text   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, name)
);

CREATE TABLE IF NOT EXISTS questions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id      bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  unit_id        bigint NOT NULL REFERENCES units(id)   ON DELETE CASCADE,
  topic          text,
  nclex_category text,            -- one of the 8 client-need categories (feeds module 4.6)
  stem           text   NOT NULL,
  options        jsonb  NOT NULL, -- array of 4 strings
  correct_index  int    NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  rationales     jsonb  NOT NULL, -- array of 4 strings, same order as options
  source         text   NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','manual')),
  status         text   NOT NULL DEFAULT 'active'    CHECK (status IN ('active','retired')),
  consecutive_correct int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT options_are_four    CHECK (jsonb_array_length(options) = 4),
  CONSTRAINT rationales_are_four CHECK (jsonb_array_length(rationales) = 4)
);
CREATE INDEX IF NOT EXISTS idx_questions_course_unit ON questions(course_id, unit_id, status);

CREATE TABLE IF NOT EXISTS question_attempts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id    bigint NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answered_index int    NOT NULL CHECK (answered_index BETWEEN 0 AND 3),
  correct        boolean NOT NULL,
  answered_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attempts_question ON question_attempts(question_id, answered_at DESC);

-- Spaced repetition: wrong -> stage 0 (1d); correct advances 1d -> 3d -> 7d;
-- two consecutive corrects retire the question (row deleted here).
CREATE TABLE IF NOT EXISTS review_queue (
  question_id bigint PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  stage       int    NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 2),
  due_at      timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_queue(due_at);

-- ---------- slide ingest (queue-driven) ----------
-- The browser extracts PDF text and posts chunks; the Worker enqueues one
-- message per chunk. Chunk text lives here so a job survives a closed phone.
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id  bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  unit_id    bigint NOT NULL REFERENCES units(id)   ON DELETE CASCADE,
  filename   text   NOT NULL,
  status     text   NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  total_chunks      int NOT NULL DEFAULT 0,
  done_chunks       int NOT NULL DEFAULT 0,
  questions_created int NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest_chunks (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id     bigint NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
  seq        int    NOT NULL,
  content    text   NOT NULL,
  status     text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  attempts   int    NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, seq)
);
-- Cron re-drives anything stuck in 'running' or left 'pending'.
CREATE INDEX IF NOT EXISTS idx_chunks_sweep ON ingest_chunks(status, updated_at);

-- ============================================================
-- TRAINING (module 4.2) — workouts are READ from LiftLogic's own
-- Neon database; only targets and manual fallback entries live here.
-- ============================================================

CREATE TABLE IF NOT EXISTS weekly_targets (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_start      date NOT NULL UNIQUE,          -- Monday
  target_sessions int  NOT NULL DEFAULT 4,
  plan            jsonb,                         -- per-day intent, e.g. ["push","pull",null,...]
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only used when LiftLogic can't be read, or for the one-tap "trained today"
-- fallback. Rows sourced from LiftLogic are never copied in — they are read live.
CREATE TABLE IF NOT EXISTS workouts_manual (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date       date NOT NULL,
  type       text,                               -- push | pull | other
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, type)
);

-- ============================================================
-- Remaining modules: tables declared now so later phases build on an
-- approved shape. No code reads these yet.
-- ============================================================

-- ---------- dating & social (4.1) ----------
CREATE TABLE IF NOT EXISTS matches (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  app        text NOT NULL CHECK (app IN ('hinge','pof')),
  matched_on date,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id   bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  direction  text   NOT NULL CHECK (direction IN ('sent','received')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  body       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS confidence_reps (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text       text    NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS confidence_rep_completions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rep_id     bigint NOT NULL REFERENCES confidence_reps(id) ON DELETE CASCADE,
  date       date   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rep_id, date)
);

-- ---------- relapse tracker (4.5) ----------
CREATE TABLE IF NOT EXISTS urge_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  context_tag text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_urges_time ON urge_events(occurred_at);

CREATE TABLE IF NOT EXISTS reset_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  context_tag text,                              -- optional
  note        text,                              -- optional, never required
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resets_time ON reset_events(occurred_at);

CREATE TABLE IF NOT EXISTS if_then_plans (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger_tag text NOT NULL UNIQUE,
  action_text text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- calendar (4.4) ----------
CREATE TABLE IF NOT EXISTS calendar_tokens (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider      text NOT NULL DEFAULT 'google',
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  calendar_ids  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- NCLEX & licensure (4.6) ----------
CREATE TABLE IF NOT EXISTS licensure_milestones (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  stage_order int  NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','in_progress','done','blocked')),
  due_date    date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- jobs & resume (4.7) ----------
CREATE TABLE IF NOT EXISTS applications (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hospital         text NOT NULL,
  unit             text,
  role             text,
  applied_on       date,
  stage            text NOT NULL DEFAULT 'applied'
                   CHECK (stage IN ('applied','screen','interview','offer','declined')),
  next_action      text,
  next_action_date date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS target_programs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hospital   text NOT NULL,
  program    text,
  opens_on   date,
  closes_on  date,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resume_variants (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           text NOT NULL,
  is_master      boolean NOT NULL DEFAULT false,
  application_id bigint REFERENCES applications(id) ON DELETE SET NULL,
  content        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interview_answers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question   text NOT NULL,
  answer     text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- daily non-negotiables (4.8) ----------
CREATE TABLE IF NOT EXISTS nn_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      text    NOT NULL,
  position   int     NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nn_completions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id    bigint NOT NULL REFERENCES nn_items(id) ON DELETE CASCADE,
  date       date   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, date)
);

-- ---------- grooming cadence (4.9) ----------
CREATE TABLE IF NOT EXISTS grooming_items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  interval_days int  NOT NULL,
  last_done     date,
  ref_note      text,
  ref_image_url text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- money & subscriptions (4.10) ----------
CREATE TABLE IF NOT EXISTS recurring_charges (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  amount_cents int  NOT NULL,
  cycle        text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly','annual')),
  billing_day  int  CHECK (billing_day BETWEEN 1 AND 31),
  renews_on    date,
  category     text,
  last_used    date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month        text NOT NULL,                    -- YYYY-MM
  kind         text NOT NULL CHECK (kind IN ('income','fixed','discretionary')),
  label        text,
  amount_cents int  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- home lab (4.12) ----------
CREATE TABLE IF NOT EXISTS services (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_checks (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id bigint NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok         boolean NOT NULL,
  latency_ms int,
  detail     jsonb
);
CREATE INDEX IF NOT EXISTS idx_health_service ON health_checks(service_id, checked_at DESC);

-- ---------- updated_at triggers ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'courses','exams','questions','review_queue','ingest_jobs','ingest_chunks',
    'weekly_targets','workouts_manual','matches','if_then_plans','calendar_tokens',
    'licensure_milestones','applications','target_programs','resume_variants',
    'interview_answers','nn_items','grooming_items','recurring_charges',
    'ledger_entries','services'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;
