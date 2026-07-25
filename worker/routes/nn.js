import { Hono } from "hono";
import { db } from "../db.js";

const nn = new Hono();
const MAX_ITEMS = 5; // the constraint is the feature (spec 4.8)

const today = (env) => `(now() AT TIME ZONE '${(env.TIMEZONE || "UTC").replace(/'/g, "")}')::date`;

// Items plus the last 90 days of completions. The dot grid, the trailing-30-day
// rate, and the fix-or-delete prompt are all derived from `dates` on the client.
nn.get("/", async (c) => {
  const rows = await db(c.env).query(
    `SELECT i.id, i.title, i.position,
            COALESCE(
              array_agg(c.date::text ORDER BY c.date DESC)
                FILTER (WHERE c.date >= ${today(c.env)} - 89),
              '{}'
            ) AS dates
       FROM nn_items i
       LEFT JOIN nn_completions c ON c.item_id = i.id
      WHERE i.active
      GROUP BY i.id
      ORDER BY i.position, i.id`
  );
  const [{ d }] = await db(c.env).query(`SELECT ${today(c.env)}::text AS d`);
  return c.json({ date: d, items: rows, max_items: MAX_ITEMS });
});

nn.post("/items", async (c) => {
  const { title } = await c.req.json().catch(() => ({}));
  if (!title?.trim()) return c.json({ error: "title required" }, 400);

  const sql = db(c.env);
  const [{ count }] = await sql.query(
    "SELECT count(*)::int AS count FROM nn_items WHERE active"
  );
  if (count >= MAX_ITEMS)
    return c.json(
      { error: `${MAX_ITEMS} is the limit — delete one first. A short list is the point.` },
      400
    );

  const [row] = await sql.query(
    `INSERT INTO nn_items (title, position)
     VALUES ($1, COALESCE((SELECT max(position) + 1 FROM nn_items), 0))
     RETURNING id, title, position`,
    [title.trim()]
  );
  return c.json(row);
});

nn.patch("/items/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const [row] = await db(c.env).query(
    `UPDATE nn_items SET title = COALESCE($2, title), active = COALESCE($3, active)
      WHERE id = $1 RETURNING id, title, active`,
    [c.req.param("id"), b.title ?? null, b.active ?? null]
  );
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

nn.delete("/items/:id", async (c) => {
  await db(c.env).query("DELETE FROM nn_items WHERE id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

// One tap, no confirmation, and tapping again undoes it.
nn.post("/items/:id/toggle", async (c) => {
  const [row] = await db(c.env).query(
    `WITH removed AS (
       DELETE FROM nn_completions
        WHERE item_id = $1 AND date = ${today(c.env)}
        RETURNING 1
     ), added AS (
       INSERT INTO nn_completions (item_id, date)
       SELECT $1, ${today(c.env)}
        WHERE NOT EXISTS (SELECT 1 FROM removed)
       RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM added) AS done`,
    [c.req.param("id")]
  );
  return c.json({ done: row.done });
});

export default nn;
