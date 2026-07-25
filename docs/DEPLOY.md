# Deploy

Three steps. Everything runs on free tiers.

## 1. Neon

Create a database, then run `sql/001_init.sql` in the Neon SQL Editor (or
`psql "$DATABASE_URL" -f sql/001_init.sql`). It's idempotent.

Optional: `sql/seed_demo.sql` adds a demo course and 5 questions so you have
something to practise against straight away.

Already ran an earlier version of the schema? Also run `sql/002_no_ai.sql` — it
drops two tables that were only used by the removed question generator.

Copy the **pooled** connection string (the one with `-pooler` in the host).

## 2. Deploy to Cloudflare

```sh
npm install
npm run deploy      # builds the site, then wrangler deploy
```

One Worker serves the whole site and the API. It appears under Workers & Pages
in the dashboard with a `*.workers.dev` URL; add a custom domain there if you
want.

## 3. Secrets

```sh
npx wrangler secret put DATABASE_URL       # Neon pooled URL from step 1
npx wrangler secret put APP_PASSWORD       # what you type to unlock the app
npx wrangler secret put SESSION_SECRET     # openssl rand -base64 32
```

| Secret | Without it |
|---|---|
| `DATABASE_URL` | every request fails |
| `APP_PASSWORD` | **the app is open to anyone with the URL** |
| `SESSION_SECRET` | same — auth needs both to switch on |

Secrets persist across deploys; set them once. Re-run `npm run deploy` any time.

---

## Optional: LiftLogic workouts

Only needed for the training module. Run `sql/liftlogic_readonly_role.sql`
against **LiftLogic's** database (replace `REPLACE_ME` with a password first) —
it creates a read-only role so this app can never write to your training data.
Then:

```sh
npx wrangler secret put LIFTLOGIC_DATABASE_URL
```

Its schema isn't guessed. Once deployed, run:

```sh
curl -s https://<your-worker>/api/training/liftlogic/introspect
```

That lists LiftLogic's real tables and columns; the query to read workouts goes
in `wrangler.jsonc` as `LIFTLOGIC_WORKOUTS_SQL` (takes `$1`/`$2` as a date
range, returns a `date` column). Until it's set, training uses a one-tap
"trained today" button instead.

## Local development

Put `DATABASE_URL` in `.dev.vars` (gitignored), then:

```sh
npx wrangler dev                 # API on :8787
cd web && npm run dev            # UI on :5173
```

Omitting `APP_PASSWORD`/`SESSION_SECRET` locally skips the login screen.

## Things to expect

- **First request after idle is slow** (~½ s) — Neon wakes from sleep.
- **Questions are yours to add.** Study → Add takes typed or pasted questions;
  there's no AI and no API key. Paste format is on that screen behind
  "Show the format".
