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
| AI | Anthropic API, `claude-opus-5`, key server-side only | Structured outputs (JSON schema) guarantee parseable question JSON |
| Hosting | Cloudflare Workers + a custom domain | Replaces the earlier self-hosted-Docker plan |

### Why the runtime changed with the database

Workers has no filesystem and no long-lived processes, which invalidated three
things from the first pass:

- **PDF parsing moved to the browser.** `pdf-parse` is Node-only, and a 250-slide
  deck is a large multipart upload. pdf.js now extracts text on the phone and
  posts only the text — the 1.3 MB pdf.js bundle is lazy-loaded so it never
  touches the Today screen.
- **Background generation moved to a queue.** A Worker cannot keep working after
  the response is sent, so chunk text is persisted (`ingest_chunks`) and one
  Cloudflare Queue message is sent per chunk. The job survives a locked phone.
  A 2-minute cron re-drives anything stuck. Without the Paid plan, drop the
  `queues` block and the cron alone does the work, slower.
- **Transactions became CTEs.** Neon's HTTP driver has no interactive
  transactions, so recording an attempt (grade → log → update streak → move the
  SRS queue) is one statement with mutually-exclusive data-modifying CTEs. One
  round trip, still atomic.

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

- **Units are declared at upload time** ("Endocrine"), not auto-detected per
  chunk — auto-detected names drift ("DKA" vs "Diabetic Ketoacidosis") and would
  fragment the heatmap. Each question still gets a finer `topic` and an NCLEX
  client-need category, which pre-feeds module 4.6.
- **SRS**: wrong → queue at 1d; correct while queued advances 1d→3d→7d; two
  *consecutive* corrects retire the question; a wrong answer on a retired
  question reactivates it. When everything in a filter is retired, practice
  recycles rather than showing an empty screen. All six transitions are verified
  against Postgres.
- **Chunking** groups whole pages to ~8k chars (10–20 chunks for a 250-slide
  deck), 5–7 questions per chunk.
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
