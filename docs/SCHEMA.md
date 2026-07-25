# Data model

Source of truth: `server/migrations/001_init.sql`. Single-user (no tenancy), every
table timestamped. SQLite, WAL mode, foreign keys on.

## Wired in Phase 1 (study engine + auth)

| Table | Purpose | Notes |
|---|---|---|
| `sessions` | auth cookie tokens | 90-day expiry |
| `courses` | course registry | `grade_min` drives the grade-scenario table |
| `exams` | exam dates, weights, scores | `score IS NULL` = not yet taken |
| `units` | heatmap rows | unique per (course, name); declared at ingest time |
| `questions` | the bank | options/rationales as JSON arrays; `status` active/retired; `consecutive_correct` drives retirement; `nclex_category` pre-tags for module 4.6 |
| `question_attempts` | every answer ever | feeds accuracy, heatmap, weekly review |
| `review_queue` | spaced repetition | stage 0/1/2 = 1d/3d/7d |
| `ingest_jobs` | PDF → generation progress | polled by the ingest screen |

## Declared now, wired by later modules

| Module | Tables |
|---|---|
| Training (4.2) | `weekly_targets` (week + per-day plan JSON), `workouts` (`source` = manual \| liftlogic) |
| Dating (4.1) | `matches`, `messages` (direction + timestamp, body optional), `confidence_reps`, `confidence_rep_completions` |
| Relapse (4.5) | `urge_events` (tag + time only), `reset_events` (all fields optional beyond timestamp), `if_then_plans` (one per trigger tag) |
| Calendar (4.4) | `calendar_tokens` (OAuth tokens + selected calendar ids) |
| Licensure (4.6) | `licensure_milestones` (ordered pipeline stages with due dates) |
| Jobs (4.7) | `applications` (staged pipeline), `target_programs` (window countdowns), `resume_variants` (master + per-application), `interview_answers` |
| Non-negotiables (4.8) | `nn_items` (the 3–5 max is enforced in UI, not schema), `nn_completions` (presence = done that day) |
| Grooming (4.9) | `grooming_items` (interval + last_done + visual ref) |
| Money (4.10) | `recurring_charges`, `ledger_entries` |
| Home lab (4.12) | `services`, `health_checks` (ok/latency/detail JSON per poll) |

## Repeated shapes (spec §6)

- **Dot grid** reads: `nn_completions`, `reset_events` (inverted: absence = clean day),
  `confidence_rep_completions` — all are (thing, date) rows; one shared component renders them.
- **Heatmap** reads: `question_attempts` grouped by unit (study), by `nclex_category`
  (NCLEX readiness), and `urge_events`/`reset_events` grouped by hour×weekday (patterns).
- **Staged pipeline**: `applications.stage` and `licensure_milestones.status` — same
  component, different stage lists.

## Conventions

- Dates that are calendar dates (exams, workouts, completions) are `TEXT` `YYYY-MM-DD`;
  instants (attempts, urges, sessions) are UTC `datetime('now')` strings. "Today" queries
  use `date('now','localtime')` — set `TZ` correctly in the container.
- JSON columns are plain `TEXT`, parsed at the edge. SQLite's `json_*` functions remain
  available for queries if ever needed.
- Weekly review (4.11) gets **no tables**: it is a read-only aggregation over everything
  above, generated on demand.
