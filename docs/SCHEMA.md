# Data model

Source of truth: **`sql/001_init.sql`** (Neon / Postgres 16). Single-user, no
tenancy. Every table carries `created_at`; every mutable table carries
`updated_at`, maintained by a `touch_updated_at` trigger rather than by hand.
The file is idempotent — re-running it is safe.

## Wired to code

| Table | Purpose | Notes |
|---|---|---|
| `courses` | course registry | `grade_min` drives the grade-scenario table |
| `exams` | dates, weights, scores | `score IS NULL` = not yet taken |
| `units` | heatmap rows | unique per (course, name); declared at ingest time |
| `questions` | the bank, all hand-entered | `options`/`rationales` are `jsonb`, each constrained to exactly 4 entries; `correct_index` constrained to 0–3; `status` active/retired; `consecutive_correct` drives retirement; `nclex_category` pre-tags for module 4.6 |
| `question_attempts` | every answer ever | feeds accuracy, heatmap, weekly review |
| `review_queue` | spaced repetition | `stage` 0/1/2 = 1d/3d/7d; row deleted on retirement |
| `weekly_targets` | training targets (4.2) | per-day intent as `jsonb` |
| `workouts_manual` | the "trained today" fallback | LiftLogic sessions are **read live**, never copied here |
| `nn_items` / `nn_completions` | daily non-negotiables (4.8) | 5-item cap enforced in the API, not the schema; a completion row's existence *is* the tick |
| `urge_events` / `reset_events` / `if_then_plans` | relapse tracker (4.5) | urges store time + tag only; resets store nothing beyond the timestamp unless you volunteer it |

There is no `sessions` table — the login cookie is an HMAC-signed expiry stamp,
so auth costs no database round trip.

## Declared now, wired by later modules

| Module | Tables |
|---|---|
| Dating (4.1) | `matches`, `messages`, `confidence_reps`, `confidence_rep_completions` |
| Calendar (4.4) | `calendar_tokens` |
| Licensure (4.6) | `licensure_milestones` |
| Jobs (4.7) | `applications`, `target_programs`, `resume_variants`, `interview_answers` |
| Grooming (4.9) | `grooming_items` |
| Money (4.10) | `recurring_charges`, `ledger_entries` |
| Home lab (4.12) | `services`, `health_checks` |

## Repeated shapes (spec §6)

- **Dot grid** reads `nn_completions`, `reset_events` (inverted — absence is a
  clean day), and `confidence_rep_completions`. All are (thing, date) rows, so
  one component renders all three.
- **Heatmap** reads `question_attempts` grouped by unit (study), by
  `nclex_category` (NCLEX readiness), and `urge_events`/`reset_events` by
  hour × weekday (patterns).
- **Staged pipeline**: `applications.stage` and `licensure_milestones.status` —
  same component, different stage lists.

## Conventions

- Calendar dates are `date`; instants are `timestamptz` defaulting to `now()`.
  "Today" is computed as `(now() AT TIME ZONE $TIMEZONE)::date`, so the day
  boundary follows you rather than UTC.
- Enum-ish columns use `CHECK` constraints, not Postgres enums — adding a value
  later is an `ALTER … DROP/ADD CONSTRAINT`, not a type migration.
- Money is integer cents. Percentages are `numeric(5,2)` and cast to `float8` on
  the way out of the API, since the driver returns `numeric` as a string.
- IDs are `bigint … GENERATED ALWAYS AS IDENTITY`, which the driver returns as
  strings. Nothing does arithmetic on an id, so this is only worth remembering
  when comparing them.
- Weekly review (4.11) gets **no tables** — it is a read-only aggregation over
  everything above, generated on demand.

## Verified against Postgres 16

`sql/001_init.sql` applies twice cleanly; `sql/seed_demo.sql` is idempotent.
Every statement the Worker issues was exercised: all six SRS transitions,
practice selection priority (due → unseen → rotation → recycled), the unit
filter, the heatmap aggregate, the grade-scenario aggregate, timezone-aware
"today" counts, exam-score preserve/set/clear, chunk claiming (double-claim is a
no-op), the retry-vs-give-up error paths, the stuck-chunk sweep, both `questions`
check constraints, and cascade deletes — plus the atomic chunk claim (sequential
claims never collide, a stale `running` chunk is reclaimed and prioritised over
pending ones, and job scoping works).
