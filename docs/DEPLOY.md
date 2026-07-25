# Deploy: Neon + Cloudflare (free tier)

Nothing here needs a paid plan. Two databases are involved: **Life** owns its
own Neon database; **LiftLogic** keeps owning its own, and Life only ever reads
from it through a role that cannot write.

---

## 1. Neon — the Life database

Create a Neon project, then run the schema. Use the **pooled** connection string
(the one with `-pooler` in the host) — Workers open a connection per request.

```sh
export DATABASE_URL='postgresql://…-pooler.…neon.tech/life?sslmode=require'
npm run db:init      # sql/001_init.sql — idempotent, safe to re-run
npm run db:seed      # optional demo course + 5 questions
```

Or paste `sql/001_init.sql` into the Neon SQL Editor.

## 2. Neon — read-only access to LiftLogic

Run `sql/liftlogic_readonly_role.sql` **against the LiftLogic database**, after
replacing `REPLACE_ME` with a generated password. It creates a `life_reader`
role with `SELECT` and nothing else, so a bug on this side can't corrupt your
training history.

Build LiftLogic's connection string with that role and keep it for step 3:

```
postgresql://life_reader:<PASSWORD>@<liftlogic-pooler-host>/<db>?sslmode=require
```

If LiftLogic lives in the *same* Neon database as Life, skip this entirely and
leave `LIFTLOGIC_DATABASE_URL` unset — the code falls back to `DATABASE_URL`.

## 3. Cloudflare — secrets

Five secrets, all via `wrangler secret put` (encrypted; never in the repo):

```sh
npx wrangler secret put DATABASE_URL             # Neon pooled URL for Life
npx wrangler secret put LIFTLOGIC_DATABASE_URL   # life_reader URL from step 2
npx wrangler secret put ANTHROPIC_API_KEY        # sk-ant-…
npx wrangler secret put APP_PASSWORD             # what you type to unlock the app
npx wrangler secret put SESSION_SECRET           # openssl rand -base64 32
```

| Secret | Required | Without it |
|---|---|---|
| `DATABASE_URL` | yes | every request 500s |
| `ANTHROPIC_API_KEY` | yes | ingest returns 503; everything else works |
| `APP_PASSWORD` | prod | app is **wide open** to anyone with the URL |
| `SESSION_SECRET` | prod | same — auth needs both to switch on |
| `LIFTLOGIC_DATABASE_URL` | no | falls back to `DATABASE_URL`, then to manual entry |

`SESSION_SECRET` signs the login cookie — changing it logs you out, nothing more.

Non-secret settings live in `wrangler.jsonc` under `vars` (`TIMEZONE`,
`ANTHROPIC_MODEL`, `LIFTLOGIC_WORKOUTS_SQL`). Those are visible in the dashboard,
so anything sensitive belongs in `secret put` instead.

## 4. Deploy

```sh
npm install
npm run deploy        # builds web/dist, then wrangler deploy
```

One Worker serves both the API (`/api/*`) and the SPA. Add a custom domain in
the dashboard if you don't want the `*.workers.dev` URL.

### Why not a separate Pages project?

Workers now serves static assets natively, and **static asset requests are free
and don't count against the daily request limit**. Putting the SPA on the same
Worker means one deploy, one origin, and no CORS between the app and its API. A
separate Pages project would add a second deploy and CORS config to configure
and keep in sync, for nothing gained. The build output is still a plain static
bundle, so moving it to Pages later is a config change, not a rewrite.

---

## What the free tier means here

The design is shaped around three free-plan realities:

**Cloudflare Queues is paid-only.** Lecture generation is therefore driven by the
browser: the ingest screen calls `POST /api/study/ingest/step` once per chunk,
each call generating one chunk's questions. Chunk text is stored in the database
first, so nothing is lost — leaving the page mid-run just pauses it, and opening
the app again resumes automatically from the next unfinished chunk.

**A cron would keep Neon awake and burn its compute allowance.** Neon's free plan
autosuspends the database after a few minutes idle and gives a fixed monthly
compute-hour budget. A Worker cron polling every minute would hold it open
around the clock and exhaust that budget doing nothing. So there is no cron —
the app only touches the database when you're actually using it. The trade is
that a half-finished ingest waits for you to reopen the app rather than
finishing on its own.

**Request budget is not a concern.** The Workers free plan allows 100,000
requests/day. A 250-slide lecture is roughly 10–20 chunks, so one deck costs
~20 requests; answering a practice question costs one. Static assets are free.

**Expect a slow first request.** After idle, Neon takes roughly half a second to
wake. That lands on whatever you open first and then goes away.

**If a chunk times out**, Cloudflare cuts the connection at ~100 seconds and the
step fails. The chunk returns to `pending` and is retried automatically (three
attempts, then it's marked failed and the rest of the deck continues). If it
happens often, set a faster model in `wrangler.jsonc`:

```jsonc
"vars": { "ANTHROPIC_MODEL": "claude-sonnet-5" }
```

---

## Local development

Put the same values in `.dev.vars` (gitignored, never deployed):

```
DATABASE_URL=postgresql://…
ANTHROPIC_API_KEY=sk-ant-…
# APP_PASSWORD / SESSION_SECRET omitted -> auth disabled locally
```

```sh
npx wrangler dev                 # Worker + API on :8787
cd web && npm run dev            # Vite on :5173, proxies /api to :8787
```

Point `DATABASE_URL` at a Neon **branch** rather than your main database so local
experiments can't touch real data — branches are free and instant.

---

## Wiring LiftLogic's workouts

Life doesn't guess LiftLogic's schema. Ask the deployed Worker what's actually
there:

```sh
curl -s https://<your-worker>/api/training/liftlogic/introspect | jq
```

That returns every table and column the read-only role can see, plus a
`likely_workout_tables` shortlist. Turn the right one into a query and set it as
a var in `wrangler.jsonc`. It takes `$1` = start date, `$2` = end date, and must
return a `date` column, optionally `type` and `volume`:

```jsonc
"vars": {
  "LIFTLOGIC_WORKOUTS_SQL": "SELECT performed_on AS date, split AS type, NULL AS volume FROM workouts WHERE performed_on BETWEEN $1 AND $2"
}
```

Until that's set, `/api/training/week` reports `source: "manual"` and the
training module uses the one-tap "trained today" fallback. Only `SELECT`/`WITH`
queries are accepted, and the role is read-only regardless.
