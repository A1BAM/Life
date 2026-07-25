# Deploy: Neon + Cloudflare

Two databases are involved. **Life** owns its own Neon database. **LiftLogic**
keeps owning its own — Life only ever reads from it, through a role that cannot
write.

---

## 1. Neon — the Life database

Create a Neon project (or a new database inside your existing one), then run the
schema. Use the **pooled** connection string (the one with `-pooler` in the host)
— Workers open a connection per request.

```sh
export DATABASE_URL='postgresql://…-pooler.…neon.tech/life?sslmode=require'
npm run db:init      # sql/001_init.sql  — idempotent, safe to re-run
npm run db:seed      # optional demo course + 5 questions
```

Or paste `sql/001_init.sql` into the Neon SQL Editor.

## 2. Neon — read-only access to LiftLogic

Run `sql/liftlogic_readonly_role.sql` **against the LiftLogic database** after
replacing `REPLACE_ME` with a generated password. It creates a `life_reader`
role with `SELECT` and nothing else, so a bug on this side can't corrupt your
training history.

Then build LiftLogic's connection string with that role and keep it for step 4:

```
postgresql://life_reader:<PASSWORD>@<liftlogic-pooler-host>/<db>?sslmode=require
```

If LiftLogic lives in the *same* Neon database as Life, skip this and leave
`LIFTLOGIC_DATABASE_URL` unset — the code falls back to `DATABASE_URL`.

## 3. Cloudflare — create the queue

Durable background question generation. Requires the Workers Paid plan ($5/mo).

```sh
npx wrangler queues create life-ingest
```

Without it, delete the `queues` block from `wrangler.jsonc` — the 2-minute cron
sweep still processes chunks, just more slowly.

## 4. Cloudflare — secrets

These five go in as **secrets** (encrypted, never in the repo):

```sh
npx wrangler secret put DATABASE_URL             # Neon pooled URL for Life
npx wrangler secret put LIFTLOGIC_DATABASE_URL   # life_reader URL from step 2
npx wrangler secret put ANTHROPIC_API_KEY        # sk-ant-…
npx wrangler secret put APP_PASSWORD             # what you type to unlock the app
npx wrangler secret put SESSION_SECRET           # see below — random, 32+ bytes
```

Generate the session secret (it signs the login cookie; changing it logs you out):

```sh
openssl rand -base64 32
```

| Secret | Required | What breaks without it |
|---|---|---|
| `DATABASE_URL` | yes | every request 500s |
| `ANTHROPIC_API_KEY` | yes | ingest returns 503; everything else works |
| `APP_PASSWORD` | prod | app is **wide open** to anyone with the URL |
| `SESSION_SECRET` | prod | same — auth stays off unless both are set |
| `LIFTLOGIC_DATABASE_URL` | no | training falls back to `DATABASE_URL`, then to manual entry |

Non-secret settings live in `wrangler.jsonc` under `vars` (`TIMEZONE`,
`ANTHROPIC_MODEL`, `LIFTLOGIC_WORKOUTS_SQL`) — they're visible in the dashboard,
so keep anything sensitive in `secret put` instead.

## 5. Deploy

```sh
npm install
npm run deploy        # builds web/dist, then wrangler deploy
```

The Worker serves the API at `/api/*` and the SPA everywhere else. Add a custom
domain in the Cloudflare dashboard if you don't want the `*.workers.dev` URL.

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
experiments can't touch real data.

---

## Wiring LiftLogic's workouts

Life doesn't guess LiftLogic's schema. Ask the deployed Worker what's actually
there:

```sh
curl -s https://<your-worker>/api/training/liftlogic/introspect | jq
```

That returns every table and column the read-only role can see, plus a
`likely_workout_tables` shortlist. Turn the right one into a query and set it as
a var in `wrangler.jsonc` (or a secret if the SQL itself is sensitive). It takes
`$1` = start date, `$2` = end date, and must return a `date` column, optionally
`type` and `volume`:

```jsonc
"vars": {
  "LIFTLOGIC_WORKOUTS_SQL": "SELECT performed_on AS date, split AS type, NULL AS volume FROM workouts WHERE performed_on BETWEEN $1 AND $2"
}
```

Until that's set, `/api/training/week` reports `source: "manual"` and the
training module uses the one-tap "trained today" fallback. Only `SELECT`/`WITH`
queries are accepted, and the role is read-only regardless.
