import { Hono } from "hono";
import { db } from "../db.js";

/**
 * Relapse tracker (spec 4.5).
 *
 * A reset is data, not a verdict. Nothing here computes a "failure", ranks you,
 * or keeps a score to lose. The number that matters is the trend in the gap
 * between resets — going from every 3 days to every 12 is progress even though
 * the day counter went back to zero, so the API returns that alongside the
 * counter and never in place of it.
 */
const reset = new Hono();

const tz = (env) => (env.TIMEZONE || "UTC").replace(/'/g, "");
const today = (env) => `(now() AT TIME ZONE '${tz(env)}')::date`;

reset.get("/", async (c) => {
  const sql = db(c.env);
  const [[state], resets, urges] = await Promise.all([
    sql.query(
      `SELECT
         (SELECT max(occurred_at) FROM reset_events) AS last_reset,
         (SELECT count(*)::int FROM urge_events
           WHERE occurred_at >= now() - interval '30 days') AS urges_30d,
         (SELECT count(*)::int FROM reset_events
           WHERE occurred_at >= now() - interval '90 days') AS resets_90d,
         ${today(c.env)}::text AS today,
         (SELECT min(occurred_at) FROM reset_events) AS first_reset`
    ),
    sql.query(
      `SELECT (occurred_at AT TIME ZONE '${tz(c.env)}')::date::text AS date
         FROM reset_events
        WHERE occurred_at >= now() - interval '400 days'
        ORDER BY occurred_at`
    ),
    sql.query(
      `SELECT context_tag, count(*)::int AS n FROM urge_events
        WHERE occurred_at >= now() - interval '30 days'
        GROUP BY context_tag ORDER BY n DESC LIMIT 1`
    ),
  ]);

  // Gaps in days between consecutive resets — the actual progress signal.
  const dates = resets.map((r) => r.date);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 864e5));
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const recent = mean(gaps.slice(-3));
  const earlier = mean(gaps.slice(-6, -3));

  const todayDate = Date.parse(state.today);
  const daysClean = dates.length
    ? Math.round((todayDate - Date.parse(dates[dates.length - 1])) / 864e5)
    : null;
  const best = gaps.length ? Math.max(...gaps, daysClean ?? 0) : daysClean;

  return c.json({
    today: state.today,
    days_clean: daysClean,
    best_ever: best,
    tracking_since: state.first_reset,
    reset_dates: dates,
    resets_90d: state.resets_90d,
    urges_30d: state.urges_30d,
    top_tag_30d: urges[0]?.context_tag ?? null,
    trend: {
      gaps,
      recent_avg: recent == null ? null : Math.round(recent * 10) / 10,
      earlier_avg: earlier == null ? null : Math.round(earlier * 10) / 10,
    },
  });
});

// One tap. Time and tag only — never a description of how you feel.
reset.post("/urge", async (c) => {
  const { context_tag } = await c.req.json().catch(() => ({}));
  if (!context_tag?.trim()) return c.json({ error: "context_tag required" }, 400);
  const sql = db(c.env);
  const [[urge], [plan]] = await Promise.all([
    sql.query(
      "INSERT INTO urge_events (context_tag) VALUES ($1) RETURNING id, occurred_at, context_tag",
      [context_tag.trim()]
    ),
    sql.query("SELECT action_text FROM if_then_plans WHERE trigger_tag = $1", [
      context_tag.trim(),
    ]),
  ]);
  // The app's whole job in the moment is handing back the plan already written.
  return c.json({ ...urge, plan: plan?.action_text ?? null });
});

// One tap plus two optional fields. Never require an explanation.
reset.post("/log", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const [row] = await db(c.env).query(
    `INSERT INTO reset_events (context_tag, note) VALUES ($1, $2)
     RETURNING id, occurred_at, context_tag`,
    [b.context_tag?.trim() || null, b.note?.trim() || null]
  );
  return c.json(row);
});

// Which hour, which weekday, which tag. Surface the pattern so the environment
// can change — that is the point of the module.
reset.get("/patterns", async (c) => {
  const sql = db(c.env);
  const [byHour, byTag] = await Promise.all([
    sql.query(
      `SELECT extract(dow  FROM occurred_at AT TIME ZONE '${tz(c.env)}')::int AS dow,
              extract(hour FROM occurred_at AT TIME ZONE '${tz(c.env)}')::int AS hour,
              count(*)::int AS n
         FROM urge_events GROUP BY 1, 2`
    ),
    sql.query(
      `SELECT context_tag, count(*)::int AS n,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM reset_events r
                   WHERE r.occurred_at BETWEEN u.occurred_at AND u.occurred_at + interval '2 hours'
                )
              )::int AS preceded_reset
         FROM urge_events u GROUP BY context_tag ORDER BY n DESC`
    ),
  ]);
  return c.json({ by_hour: byHour, by_tag: byTag });
});

reset.get("/plans", async (c) => {
  const rows = await db(c.env).query(
    "SELECT id, trigger_tag, action_text FROM if_then_plans ORDER BY trigger_tag"
  );
  return c.json(rows);
});

// Editable only outside an active urge — enforced in the UI, which never shows
// an edit control on the urge screen.
reset.put("/plans", async (c) => {
  const { trigger_tag, action_text } = await c.req.json().catch(() => ({}));
  if (!trigger_tag?.trim() || !action_text?.trim())
    return c.json({ error: "trigger_tag and action_text required" }, 400);
  const [row] = await db(c.env).query(
    `INSERT INTO if_then_plans (trigger_tag, action_text) VALUES ($1, $2)
     ON CONFLICT (trigger_tag) DO UPDATE SET action_text = EXCLUDED.action_text
     RETURNING id, trigger_tag, action_text`,
    [trigger_tag.trim(), action_text.trim()]
  );
  return c.json(row);
});

reset.delete("/plans/:id", async (c) => {
  await db(c.env).query("DELETE FROM if_then_plans WHERE id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

export default reset;
