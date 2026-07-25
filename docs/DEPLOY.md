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

## 4. Deploy from GitHub

Pushing to `main` builds and deploys automatically — no laptop, no Docker, no
manual step. `.github/workflows/deploy.yml` does it, and it also builds every
pull request and validates the Worker bundle without deploying, so a broken
config fails on the PR instead of in production.

Add two **GitHub** secrets (Settings → Secrets and variables → Actions):

| GitHub secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right-hand sidebar |

> **These are deploy credentials only.** They are not the five runtime secrets
> from step 3. Those live on the Worker itself, are set once with
> `wrangler secret put`, and survive every deploy — never put them in GitHub.

### Alternative: let Cloudflare pull the repo itself

If you'd rather not keep tokens in GitHub, connect the repo in the Cloudflare
dashboard instead (Workers & Pages → your Worker → Settings → Builds → Connect).
Cloudflare then clones and builds on each push. Settings:

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`

The root `build` script installs the `web/` dependencies itself, so a clean
checkout builds with no extra configuration. If you go this route, delete
`.github/workflows/deploy.yml` so the two don't both deploy on the same push.

### Deploying by hand

Still works, for a one-off:

```sh
npm install && npm run deploy
```

### Where this lands, and the Pages question

One Worker serves both the API (`/api/*`) and the website. It appears under
**Workers & Pages** in the dashboard and gets a `*.workers.dev` URL; add a
custom domain there when you want a real address.

There is deliberately **no separate Pages project**. Workers serves static
assets natively, those requests are free and don't count against the daily
request limit, and a single origin means no CORS between the site and its API —
one deploy instead of two to keep in sync. The frontend is still a plain static
bundle in `web/dist`, so splitting it onto Pages later is a config change rather
than a rewrite. Say so if you want that split and it's a small change.

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
