# Life

Single-user life dashboard. Phase 1: app shell (Today screen, auth, full DB schema)
plus the **study engine** — the only way to study is answering NCLEX-style questions
generated from your own lecture PDFs.

## Run it

```sh
cp .env.example .env        # set APP_PASSWORD and ANTHROPIC_API_KEY
docker compose up -d --build
# → http://<box>:3001
```

Dev (two terminals):

```sh
npm install && npm run dev          # API on :3001
cd web && npm install && npm run dev  # Vite on :5173, proxies /api
```

No `APP_PASSWORD` set → auth is disabled (dev mode, logs a warning).
No `ANTHROPIC_API_KEY` → everything works except question generation.
`npm run seed:demo` loads a sample course + 5 questions to try the practice flow.

## What works now

- **Today** — date, exam countdown, study module card (status color + one number + one tap).
- **Study heatmap** — units × courses colored by accuracy; tap a cell to drill it.
- **Ingest** — upload a lecture PDF, pick course + unit, questions generate in the
  background (progress bar; job survives page closes).
- **Practice** — due reviews first, then unseen, then rotation. Answer → per-option
  rationales. Wrong answers re-queue at 1d/3d/7d; twice-right questions retire.
- **Courses** — exam registry, weights, scores, and the "what do I need on the
  remaining exams" scenario table.

## Docs

- [docs/DECISIONS.md](docs/DECISIONS.md) — every `[FILL IN]` from the spec and what was chosen.
- [docs/SCHEMA.md](docs/SCHEMA.md) — full data model (all modules), implemented in
  `server/migrations/001_init.sql`.

## Layout

```
server/          Express API (CommonJS)
  migrations/    SQL, applied at boot
  routes/        study.js (vertical slice), today.js
  ai/            question generation (Anthropic API, server-side key)
web/             React + Vite + Tailwind SPA, mobile-first, dark
```
