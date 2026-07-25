# Life

Single-user life dashboard on **Cloudflare Workers + Neon**. Phase 1: app shell
(Today screen, auth, full schema) plus the **study engine** — the only way to
study is answering NCLEX-style questions generated from your own lecture PDFs.

## Setup

Full walkthrough in **[docs/DEPLOY.md](docs/DEPLOY.md)**. Short version:

```sh
# 1. Neon: create the database, run the schema
export DATABASE_URL='postgresql://…-pooler.…neon.tech/life?sslmode=require'
npm run db:init
npm run db:seed          # optional: demo course + 5 questions

# 2. Neon: give Life read-only access to LiftLogic
#    run sql/liftlogic_readonly_role.sql against the LiftLogic database

# 3. Cloudflare (free plan — no Queues, no cron, no paid features)
npx wrangler secret put DATABASE_URL
npx wrangler secret put LIFTLOGIC_DATABASE_URL
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET      # openssl rand -base64 32

npm install && npm run deploy
```


Local dev: put the same values in `.dev.vars` (see `.dev.vars.example`), then
`npx wrangler dev` for the API on :8787 and `cd web && npm run dev` for the UI on
:5173. Omit `APP_PASSWORD`/`SESSION_SECRET` locally to skip the login screen.

## What works now

- **Today** — date, exam countdown, study card (status color + one number + one tap).
- **Study heatmap** — units × courses colored by accuracy; tap a cell to drill it.
- **Ingest** — pick a lecture PDF; the phone extracts the text and drives
  generation one chunk at a time. Leave the page and it pauses; reopen the app
  and it resumes from where it stopped.
- **Practice** — due reviews first, then unseen, then rotation. Answer → per-option
  rationales. Wrong answers re-queue at 1d/3d/7d; twice-right questions retire.
- **Courses** — exam registry, weights, scores, and the "what do I need on the
  remaining exams" scenario table.
- **Training (API only)** — reads workouts live from LiftLogic once
  `LIFTLOGIC_WORKOUTS_SQL` is set; `/api/training/liftlogic/introspect` reports
  LiftLogic's real schema so that query can be written correctly.

## Docs

- [docs/DEPLOY.md](docs/DEPLOY.md) — Neon setup, every Cloudflare secret, LiftLogic wiring.
- [docs/DECISIONS.md](docs/DECISIONS.md) — every `[FILL IN]` from the spec and what was chosen.
- [docs/SCHEMA.md](docs/SCHEMA.md) — the data model, implemented in `sql/001_init.sql`.

## Layout

```
sql/       001_init.sql (schema) · liftlogic_readonly_role.sql · seed_demo.sql
worker/    Hono API on Workers
  routes/  study.js · today.js · training.js
  ai/      question generation (Anthropic, server-side key)
  ingest.js  claim-and-generate one chunk per call (no queue, no cron)
web/       React + Vite + Tailwind SPA, mobile-first, dark
```
