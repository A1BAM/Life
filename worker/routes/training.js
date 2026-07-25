import { Hono } from "hono";
import { db, liftlogicDb } from "../db.js";

const training = new Hono();

/**
 * LiftLogic owns the workout data; Life only reads it. Its schema is not known
 * here, so the read is config-driven rather than guessed:
 *
 *   LIFTLOGIC_WORKOUTS_SQL — a SELECT returning at least a date column, plus
 *                            optional `type` and `volume` columns. Receives $1
 *                            (inclusive start date) and $2 (inclusive end date).
 *
 * Until that is set, /introspect reports LiftLogic's actual tables and columns
 * and auto-detect makes a clearly-labelled best guess.
 */
const DEFAULT_WORKOUTS_SQL = null;

function assertReadOnly(sql) {
  const head = sql.trim().slice(0, 6).toLowerCase();
  if (head !== "select" && !sql.trim().toLowerCase().startsWith("with "))
    throw new Error("LIFTLOGIC_WORKOUTS_SQL must be a SELECT/WITH query");
  if (/;\s*\S/.test(sql)) throw new Error("LIFTLOGIC_WORKOUTS_SQL must be a single statement");
}

// What tables/columns does LiftLogic actually have? Used to write the mapping.
training.get("/liftlogic/introspect", async (c) => {
  const sql = liftlogicDb(c.env);
  if (!sql) return c.json({ error: "no LiftLogic connection configured" }, 503);

  const cols = await sql.query(
    `SELECT table_schema, table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
      ORDER BY table_schema, table_name, ordinal_position`
  );

  const tables = new Map();
  for (const r of cols) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!tables.has(key)) tables.set(key, { table: key, columns: [] });
    tables.get(key).columns.push({ name: r.column_name, type: r.data_type });
  }

  const list = [...tables.values()];
  const likely = list.filter((t) => /workout|session|lift|train|set|exercise/i.test(t.table));

  return c.json({
    connection: c.env.LIFTLOGIC_DATABASE_URL ? "LIFTLOGIC_DATABASE_URL" : "DATABASE_URL (shared)",
    configured_query: Boolean(c.env.LIFTLOGIC_WORKOUTS_SQL),
    tables: list,
    likely_workout_tables: likely.map((t) => t.table),
  });
});

/** Read completed sessions in a date range. Never writes, never dedupes into Life. */
async function readLiftlogicWorkouts(env, from, to) {
  const sql = liftlogicDb(env);
  const query = env.LIFTLOGIC_WORKOUTS_SQL || DEFAULT_WORKOUTS_SQL;
  if (!sql || !query) return { available: false, workouts: [] };

  assertReadOnly(query);
  const rows = await sql.query(query, [from, to]);
  return {
    available: true,
    workouts: rows.map((r) => ({
      date: String(r.date ?? r.performed_on ?? r.performed_at ?? "").slice(0, 10),
      type: r.type ?? r.split ?? null,
      volume: r.volume ?? null,
      source: "liftlogic",
    })).filter((w) => w.date),
  };
}

// Planned vs actual for a week. Weeks start Monday.
training.get("/week", async (c) => {
  const sql = db(c.env);
  const monday =
    c.req.query("week_start") ||
    (await sql.query("SELECT (date_trunc('week', now())::date)::text AS d"))[0].d;
  const sunday = (await sql.query("SELECT ($1::date + 6)::text AS d", [monday]))[0].d;

  const [[target], manual] = await Promise.all([
    sql.query("SELECT * FROM weekly_targets WHERE week_start = $1", [monday]),
    sql.query(
      "SELECT date::text AS date, type, 'manual' AS source FROM workouts_manual WHERE date BETWEEN $1 AND $2",
      [monday, sunday]
    ),
  ]);

  let liftlogic = { available: false, workouts: [] };
  let readError = null;
  try {
    liftlogic = await readLiftlogicWorkouts(c.env, monday, sunday);
  } catch (err) {
    readError = String(err?.message || err);
  }

  // LiftLogic is the source of truth; a manual entry for a date it already
  // covers is dropped so a session is never counted twice.
  const covered = new Set(liftlogic.workouts.map((w) => w.date));
  const sessions = [...liftlogic.workouts, ...manual.filter((m) => !covered.has(m.date))];

  const targetSessions = target?.target_sessions ?? 4;
  return c.json({
    week_start: monday,
    target_sessions: targetSessions,
    plan: target?.plan ?? null,
    sessions,
    hit: sessions.length,
    source: liftlogic.available ? "liftlogic" : "manual",
    liftlogic_error: readError,
  });
});

// One-tap fallback when LiftLogic can't be read.
training.post("/manual", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const rows = await db(c.env).query(
    `INSERT INTO workouts_manual (date, type, note)
     VALUES (COALESCE($1::date, current_date), $2, $3)
     ON CONFLICT (date, type) DO UPDATE SET note = EXCLUDED.note
     RETURNING *`,
    [b.date || null, b.type || null, b.note || null]
  );
  return c.json(rows[0]);
});

training.put("/target", async (c) => {
  const b = await c.req.json();
  const rows = await db(c.env).query(
    `INSERT INTO weekly_targets (week_start, target_sessions, plan)
     VALUES (COALESCE($1::date, date_trunc('week', now())::date), $2, $3)
     ON CONFLICT (week_start)
     DO UPDATE SET target_sessions = EXCLUDED.target_sessions, plan = EXCLUDED.plan
     RETURNING *`,
    [b.week_start || null, b.target_sessions ?? 4, b.plan ? JSON.stringify(b.plan) : null]
  );
  return c.json(rows[0]);
});

export default training;
export { readLiftlogicWorkouts };
