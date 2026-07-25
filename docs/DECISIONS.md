# Build decisions — Phase 1

Every `[FILL IN]` from the spec, resolved to a default. Each one is cheap to change —
flag anything wrong in PR review and it gets swapped.

## Tech stack (spec §2)

| Blank | Decision | Why |
|---|---|---|
| Backend | Node + Express | One language across the stack; boring and debuggable |
| Database | SQLite (better-sqlite3, WAL) | Single user, single box, one file to back up. Postgres only makes sense if this ever leaves the home box |
| Auth | Single password via `APP_PASSWORD` env var → 90-day httpOnly session cookie | No user table, no signup, no wizard. Unset = auth disabled (dev mode, warns loudly) |
| Hosting | Self-hosted Docker on the home box (Dockerfile + compose included) | Alongside Immich/Pi-hole; Tailscale gives phone access without exposing it |
| AI | Anthropic API, `claude-opus-5`, key server-side only | Structured outputs (JSON schema) guarantee parseable question JSON |

## Study engine (spec §4.3)

- **Units are declared at upload time** ("Endocrine"), not auto-detected per chunk.
  Auto-detected topic names drift ("DKA" vs "Diabetic Ketoacidosis") and would fragment
  the heatmap. The generator still tags each question with a finer-grained `topic` and an
  NCLEX client-need category (which feeds module 4.6 later for free).
- **SRS interpretation**: wrong → queue at 1d, correct while queued advances 1d→3d→7d,
  two *consecutive* corrects retire the question (queued or not). A wrong answer on a
  retired question reactivates it. When every question in a filter is retired, practice
  recycles them rather than showing an empty screen.
- **Chunking** is ~8k chars on paragraph boundaries (roughly 10–15 chunks for a
  250-slide deck), 5–7 questions per chunk. "Chunk by topic" is approximated; unit-level
  tagging is what the heatmap actually needs.
- **Flashcard HTML export (4.3.6)**: dropped for now — you build these ad hoc already,
  and practice mode is deliberately the only study path. Easy to add later.
- **Practice never sends the answer with the question** — the correct index and
  rationales only come back after an attempt is recorded. Recognition-proofing at the
  API level.

## Deferred `[FILL IN]`s (owned by later phases)

| Blank | Working default, to confirm before that module is built |
|---|---|
| LiftLogic data access (4.2) | Unknown — if it has no readable API/DB, falls back to the spec'd one-tap "trained today" button. `workouts.source` column already distinguishes the two |
| Calendar scope (4.4) | Primary calendar only, until told otherwise |
| Urge context tags (4.5) | Seeded from spec examples: alone-at-night / bored / after-a-bad-exam / scrolling / can't-sleep — editable |
| Licensure state (4.6) | Virginia (GMU, Shenandoah, Inova all point there); compact-state license assumed |
| Grooming items (4.9) | Haircut 14d, beard 3d, nails 7d, skincare restock 60d — placeholder intervals |
| Home lab services (4.12) | Immich, Pi-hole, Tailscale as listed; more via the `services` table |

## Schema

Full proposal in [SCHEMA.md](./SCHEMA.md), implemented in
`server/migrations/001_init.sql`. All tables exist now (single-user, timestamps
everywhere); only study + auth are wired to code. Reviewing the migration file *is*
the schema approval — object in PR review and it changes before anything else
depends on it.
