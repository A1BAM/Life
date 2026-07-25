# Build decisions

Every `[FILL IN]` from the spec, resolved to a default. Each one is cheap to
change — flag anything wrong in review and it gets swapped.

## Tech stack (spec §2)

| Blank | Decision | Why |
|---|---|---|
| Database | **Neon (Postgres)** | Your call. Pooled connection string; the schema is one idempotent file (`sql/001_init.sql`) |
| Backend | **Cloudflare Workers + Hono** | Follows from Neon + Cloudflare. Express and `better-sqlite3` cannot run on Workers, so the server was ported rather than pointed at a new database |
| Frontend | React + Vite + Tailwind, served as static assets by the same Worker | One deploy, one origin, no CORS |
| Auth | Single password → HMAC-signed cookie (WebCrypto) | Stateless: no session table, no DB round trip per request. Auth switches on only when `APP_PASSWORD` **and** `SESSION_SECRET` are both set |
| AI | **None** | Removed at your request — it was the only thing needing a paid API key. Questions are typed or pasted instead |
| Hosting | Cloudflare Workers, **free plan**, one Worker serving both API and SPA | Replaces the earlier self-hosted-Docker plan. No separate Pages project: Workers serves static assets natively, asset requests are free and don't count against the daily request budget, and one origin means no CORS to configure |

### Why the runtime changed with the database

Workers has no filesystem and no long-lived processes:

- **Transactions became CTEs.** Neon's HTTP driver has no interactive
  transactions, so recording an attempt (grade → log → update streak → move the
  SRS queue) is one statement with mutually-exclusive data-modifying CTEs. One
  round trip, still atomic.

### Free-plan constraints the design accounts for

| Constraint | Consequence |
|---|---|
| A cron would hold Neon open 24/7 and drain its compute-hour allowance | No cron at all — the database is touched only while the app is in use |
| Neon autosuspends when idle | The first request after a gap takes roughly half a second |
| 100k Worker requests/day | Not a factor: a practice answer costs 1 request, static assets are free |

## LiftLogic (spec §4.2)

- **Life never writes to LiftLogic.** `sql/liftlogic_readonly_role.sql` creates a
  `life_reader` role with `SELECT` only; its connection string goes in
  `LIFTLOGIC_DATABASE_URL`. Unset → falls back to `DATABASE_URL`, which covers
  both apps sharing one database.
- **Its schema is not guessed.** The spec warned that an invented schema is worse
  than none, so `GET /api/training/liftlogic/introspect` reports LiftLogic's real
  tables and columns, and the actual read is a config-driven query
  (`LIFTLOGIC_WORKOUTS_SQL`, taking `$1`/`$2` as the date range). Until that's
  set, training reports `source: "manual"` and uses the specced one-tap
  "trained today" fallback.
- **No workout is counted twice.** LiftLogic rows are read live, never copied
  into Life; a manual entry on a date LiftLogic already covers is dropped.

## Study engine (spec §4.3)

- **Units are named when you add questions** ("Endocrine") and are the heatmap's
  rows. Each question can also carry a finer `topic` line.
- **SRS**: wrong → queue at 1d; correct while queued advances 1d→3d→7d; two
  *consecutive* corrects retire the question; a wrong answer on a retired
  question reactivates it. When everything in a filter is retired, practice
  recycles rather than showing an empty screen. All six transitions are verified
  against Postgres.
- **Questions come from you.** With AI removed, Study → Add accepts typed or
  pasted questions in a plain format (blank line between questions, `*` marks
  the answer, `- A:` lines add rationales). Parsed and previewed in the browser,
  validated again server-side; a bad batch is rejected whole with per-question
  errors rather than half-importing. **The cost of dropping AI: nothing turns a
  250-slide deck into a question bank any more — that legwork is yours.** The
  recall-only engine around it (practice, spaced repetition, heatmap) is
  unchanged.
- **Flashcard HTML export (4.3.6)**: dropped — you build these ad hoc already,
  and practice-only is the point.
- **The answer never leaves the server** until an attempt is recorded.
  Recognition-proofing at the API level, not just the UI.

## Deferred `[FILL IN]`s (owned by later phases)

| Blank | Working default, to confirm before that module is built |
|---|---|
| Calendar scope (4.4) | Primary calendar only |
| Urge context tags (4.5) | Spec examples: alone-at-night / bored / after-a-bad-exam / scrolling / can't-sleep |
| Licensure state (4.6) | Virginia (GMU, Shenandoah, Inova all point there); compact license assumed |
| Grooming items (4.9) | Haircut 14d, beard 3d, nails 7d, skincare restock 60d — placeholders |
| Home lab services (4.12) | Immich, Pi-hole, Tailscale; more via the `services` table |

## Schema

Full proposal in [SCHEMA.md](./SCHEMA.md), implemented in `sql/001_init.sql`.
All tables exist now; only study, auth, and training are wired to code.
Reviewing that file **is** the schema approval from spec §6.
