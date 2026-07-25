import { Hono } from "hono";
import { db } from "../db.js";
import { processNextChunk } from "../ingest.js";

const study = new Hono();

// Postgres returns `numeric` as a string to protect precision. Nothing here
// needs that precision, so numeric columns are cast to float8 on the way out
// and the client gets real numbers.
const COURSE_COLS = `id, name, code, term, grade_min::float8 AS grade_min,
                     archived, created_at, updated_at`;
const EXAM_COLS = `id, course_id, name, exam_date::text AS exam_date,
                   weight::float8 AS weight, score::float8 AS score,
                   created_at, updated_at`;

// ---------------- courses & exams ----------------

study.get("/courses", async (c) => {
  const sql = db(c.env);
  const [courses, exams] = await Promise.all([
    sql.query(`SELECT ${COURSE_COLS} FROM courses WHERE archived = false ORDER BY name`),
    sql.query(`SELECT ${EXAM_COLS} FROM exams ORDER BY exam_date NULLS LAST`),
  ]);
  return c.json(
    courses.map((co) => ({ ...co, exams: exams.filter((e) => e.course_id === co.id) }))
  );
});

study.post("/courses", async (c) => {
  const { name, code, term, grade_min } = await c.req.json();
  if (!name) return c.json({ error: "name required" }, 400);
  const rows = await db(c.env).query(
    `INSERT INTO courses (name, code, term, grade_min) VALUES ($1,$2,$3,$4)
     RETURNING ${COURSE_COLS}`,
    [name, code || null, term || null, grade_min ?? 80]
  );
  return c.json(rows[0]);
});

study.patch("/courses/:id", async (c) => {
  const b = await c.req.json();
  const rows = await db(c.env).query(
    `UPDATE courses SET
       name      = COALESCE($2, name),
       code      = COALESCE($3, code),
       term      = COALESCE($4, term),
       grade_min = COALESCE($5, grade_min),
       archived  = COALESCE($6, archived)
     WHERE id = $1 RETURNING ${COURSE_COLS}`,
    [c.req.param("id"), b.name ?? null, b.code ?? null, b.term ?? null,
     b.grade_min ?? null, b.archived ?? null]
  );
  if (!rows.length) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

study.post("/courses/:id/exams", async (c) => {
  const b = await c.req.json();
  if (!b.name) return c.json({ error: "name required" }, 400);
  const rows = await db(c.env).query(
    `INSERT INTO exams (course_id, name, exam_date, weight, score)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${EXAM_COLS}`,
    [c.req.param("id"), b.name, b.exam_date || null, b.weight ?? 0, b.score ?? null]
  );
  return c.json(rows[0]);
});

study.patch("/exams/:id", async (c) => {
  const b = await c.req.json();
  // score is explicitly nullable — `undefined` means "leave alone", `null` means "clear".
  const rows = await db(c.env).query(
    `UPDATE exams SET
       name      = COALESCE($2, name),
       exam_date = COALESCE($3, exam_date),
       weight    = COALESCE($4, weight),
       score     = CASE WHEN $5::boolean THEN $6::numeric ELSE score END
     WHERE id = $1 RETURNING ${EXAM_COLS}`,
    [c.req.param("id"), b.name ?? null, b.exam_date ?? null, b.weight ?? null,
     Object.hasOwn(b, "score"), b.score ?? null]
  );
  if (!rows.length) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

study.delete("/exams/:id", async (c) => {
  await db(c.env).query("DELETE FROM exams WHERE id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

// Grade calculator — "what do I need on what's left?" as a table of scenarios.
study.get("/courses/:id/grade-scenarios", async (c) => {
  const sql = db(c.env);
  const [course] = await sql.query("SELECT * FROM courses WHERE id = $1", [c.req.param("id")]);
  if (!course) return c.json({ error: "not found" }, 404);

  const [agg] = await sql.query(
    `SELECT
       COALESCE(SUM(score * weight / 100) FILTER (WHERE score IS NOT NULL), 0) AS earned,
       COALESCE(SUM(weight)               FILTER (WHERE score IS NOT NULL), 0) AS graded_weight,
       COALESCE(SUM(weight)               FILTER (WHERE score IS NULL),     0) AS remaining_weight
     FROM exams WHERE course_id = $1`,
    [course.id]
  );

  const earned = Number(agg.earned);
  const gradedWeight = Number(agg.graded_weight);
  const remainingWeight = Number(agg.remaining_weight);
  const round1 = (n) => Math.round(n * 10) / 10;

  const targets = [...new Set([Number(course.grade_min), 85, 90])].sort((a, b) => a - b);
  const scenarios = targets.map((target) => {
    if (remainingWeight === 0) {
      return { target, needed: null, feasible: gradedWeight > 0 && earned >= target };
    }
    const needed = ((target - earned) / remainingWeight) * 100;
    return { target, needed: round1(needed), feasible: needed <= 100 };
  });

  return c.json({
    current: gradedWeight > 0 ? round1((earned / gradedWeight) * 100) : null,
    earned: round1(earned),
    graded_weight: gradedWeight,
    remaining_weight: remainingWeight,
    scenarios,
  });
});

// ---------------- units & questions ----------------

study.get("/courses/:id/units", async (c) => {
  const rows = await db(c.env).query(
    "SELECT * FROM units WHERE course_id = $1 ORDER BY name",
    [c.req.param("id")]
  );
  return c.json(rows);
});

study.get("/questions", async (c) => {
  const { course_id, unit_id } = c.req.query();
  const rows = await db(c.env).query(
    `SELECT * FROM questions
     WHERE ($1::bigint IS NULL OR course_id = $1)
       AND ($2::bigint IS NULL OR unit_id   = $2)
     ORDER BY created_at DESC LIMIT 500`,
    [course_id || null, unit_id || null]
  );
  return c.json(rows);
});

study.delete("/questions/:id", async (c) => {
  await db(c.env).query("DELETE FROM questions WHERE id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

// ---------------- practice ----------------
// Selection order: due reviews -> never attempted -> least recently answered.
// Falls back to retired questions rather than showing an empty screen.

study.get("/practice/next", async (c) => {
  const { course_id, unit_id } = c.req.query();
  const params = [course_id || null, unit_id || null];
  const scope = `($1::bigint IS NULL OR q.course_id = $1) AND ($2::bigint IS NULL OR q.unit_id = $2)`;

  const [row] = await db(c.env).query(
    `WITH scoped AS (SELECT q.* FROM questions q WHERE ${scope}),
     pick AS (
       SELECT s.*, 'review' AS pool, 0 AS rank
         FROM scoped s JOIN review_queue r ON r.question_id = s.id
        WHERE s.status = 'active' AND r.due_at <= now()
        ORDER BY r.due_at LIMIT 1
     ), pick2 AS (
       SELECT s.*, 'new' AS pool, 1 AS rank FROM scoped s
        WHERE s.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM question_attempts a WHERE a.question_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM pick)
        ORDER BY random() LIMIT 1
     ), pick3 AS (
       SELECT s.*, 'rotation' AS pool, 2 AS rank FROM scoped s
        WHERE s.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM pick) AND NOT EXISTS (SELECT 1 FROM pick2)
        ORDER BY (SELECT max(a.answered_at) FROM question_attempts a WHERE a.question_id = s.id)
                 ASC NULLS FIRST
        LIMIT 1
     ), pick4 AS (
       SELECT s.*, 'retired' AS pool, 3 AS rank FROM scoped s
        WHERE NOT EXISTS (SELECT 1 FROM pick) AND NOT EXISTS (SELECT 1 FROM pick2)
          AND NOT EXISTS (SELECT 1 FROM pick3)
        ORDER BY random() LIMIT 1
     )
     SELECT * FROM (
       SELECT * FROM pick UNION ALL SELECT * FROM pick2
       UNION ALL SELECT * FROM pick3 UNION ALL SELECT * FROM pick4
     ) t ORDER BY rank LIMIT 1`,
    params
  );

  if (!row) return c.json({ question: null });

  // The answer never leaves the server until an attempt is recorded.
  const { correct_index, rationales, consecutive_correct, pool, rank, ...question } = row;
  return c.json({ question, pool });
});

// One statement, one round trip: grade the answer, record the attempt, update
// the streak, and move the spaced-repetition queue. All CTEs see the same
// snapshot, and the branches are mutually exclusive, so no row is touched twice.
const RECORD_ATTEMPT = `
WITH graded AS (
  SELECT id,
         ($2::int = correct_index)      AS correct,
         consecutive_correct + 1 >= 2   AS would_retire,
         correct_index,
         rationales
    FROM questions WHERE id = $1::bigint
),
ins AS (
  INSERT INTO question_attempts (question_id, answered_index, correct)
  SELECT id, $2::int, correct FROM graded
),
wrong_streak AS (
  UPDATE questions SET consecutive_correct = 0, status = 'active'
   WHERE id = $1::bigint AND (SELECT NOT correct FROM graded)
),
right_streak AS (
  UPDATE questions
     SET consecutive_correct = consecutive_correct + 1,
         status = CASE WHEN consecutive_correct + 1 >= 2 THEN 'retired' ELSE status END
   WHERE id = $1::bigint AND (SELECT correct FROM graded)
),
queue_wrong AS (
  INSERT INTO review_queue (question_id, stage, due_at)
  SELECT $1::bigint, 0, now() + interval '1 day' FROM graded WHERE NOT correct
  ON CONFLICT (question_id)
  DO UPDATE SET stage = 0, due_at = now() + interval '1 day'
),
queue_retire AS (
  DELETE FROM review_queue
   WHERE question_id = $1::bigint
     AND (SELECT correct AND would_retire FROM graded)
),
queue_advance AS (
  UPDATE review_queue
     SET stage  = LEAST(stage + 1, 2),
         due_at = now() + ((ARRAY[1,3,7])[LEAST(stage + 1, 2) + 1] * interval '1 day')
   WHERE question_id = $1::bigint
     AND (SELECT correct AND NOT would_retire FROM graded)
)
SELECT correct, correct_index, rationales FROM graded`;

study.post("/attempts", async (c) => {
  const { question_id, answered_index } = await c.req.json();
  if (![0, 1, 2, 3].includes(answered_index))
    return c.json({ error: "answered_index must be 0-3" }, 400);

  const [row] = await db(c.env).query(RECORD_ATTEMPT, [question_id, answered_index]);
  if (!row) return c.json({ error: "question not found" }, 404);
  return c.json(row);
});

// ---------------- weak-topic heatmap ----------------

study.get("/heatmap", async (c) => {
  const rows = await db(c.env).query(
    `SELECT c.id AS course_id, c.name AS course_name, c.code AS course_code,
            u.id AS unit_id, u.name AS unit_name,
            count(DISTINCT q.id)                       AS question_count,
            count(a.id)                                AS attempt_count,
            count(a.id) FILTER (WHERE a.correct)       AS correct_count,
            count(DISTINCT r.question_id) FILTER (WHERE r.due_at <= now()) AS due_count
       FROM units u
       JOIN courses c ON c.id = u.course_id
       LEFT JOIN questions q         ON q.unit_id = u.id
       LEFT JOIN question_attempts a ON a.question_id = q.id
       LEFT JOIN review_queue r      ON r.question_id = q.id
      WHERE c.archived = false
      GROUP BY c.id, c.name, c.code, u.id, u.name
      ORDER BY c.name, u.name`
  );

  const byCourse = new Map();
  for (const r of rows) {
    if (!byCourse.has(r.course_id)) {
      byCourse.set(r.course_id, {
        course_id: r.course_id,
        course_name: r.course_name,
        course_code: r.course_code,
        units: [],
      });
    }
    const attempts = Number(r.attempt_count);
    byCourse.get(r.course_id).units.push({
      unit_id: r.unit_id,
      unit_name: r.unit_name,
      question_count: Number(r.question_count),
      attempt_count: attempts,
      accuracy: attempts > 0 ? Math.round((Number(r.correct_count) / attempts) * 100) : null,
      due_count: Number(r.due_count),
    });
  }
  return c.json([...byCourse.values()]);
});

// ---------------- ingest ----------------
// The browser extracts PDF text (pdf.js) and posts chunks. Chunk text is stored
// so a job survives the phone being locked; a queue message per chunk does the
// generation. Nothing large flows through the Worker request body twice.

study.get("/ingest/jobs", async (c) => {
  const rows = await db(c.env).query(
    `SELECT j.*, c.name AS course_name, u.name AS unit_name
       FROM ingest_jobs j
       JOIN courses c ON c.id = j.course_id
       JOIN units   u ON u.id = j.unit_id
      ORDER BY j.created_at DESC LIMIT 20`
  );
  return c.json(rows);
});

study.post("/ingest", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY)
    return c.json({ error: "ANTHROPIC_API_KEY is not configured" }, 503);

  const { course_id, unit_name, filename, chunks } = await c.req.json();
  if (!course_id || !unit_name) return c.json({ error: "course_id and unit_name required" }, 400);
  if (!Array.isArray(chunks) || chunks.length === 0)
    return c.json({ error: "no text extracted from the PDF" }, 400);

  const sql = db(c.env);
  const [course] = await sql.query("SELECT * FROM courses WHERE id = $1", [course_id]);
  if (!course) return c.json({ error: "course not found" }, 400);

  const [unit] = await sql.query(
    `INSERT INTO units (course_id, name) VALUES ($1,$2)
     ON CONFLICT (course_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [course.id, unit_name.trim()]
  );

  const [job] = await sql.query(
    `INSERT INTO ingest_jobs (course_id, unit_id, filename, total_chunks)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [course.id, unit.id, filename || "lecture.pdf", chunks.length]
  );

  const inserted = await sql.query(
    `INSERT INTO ingest_chunks (job_id, seq, content)
     SELECT $1, ordinality - 1, value
       FROM unnest($2::text[]) WITH ORDINALITY AS t(value, ordinality)
     RETURNING id, seq`,
    [job.id, chunks]
  );

  return c.json({ job_id: job.id, total_chunks: inserted.length });
});

// Generate questions for one chunk. The client calls this repeatedly while the
// app is open; each call is a single Anthropic request, which keeps every
// invocation well inside the free plan's subrequest and CPU budgets.
study.post("/ingest/step", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY)
    return c.json({ error: "ANTHROPIC_API_KEY is not configured" }, 503);
  const body = await c.req.json().catch(() => ({}));
  return c.json(await processNextChunk(c.env, body.job_id ?? null));
});

// Any job with work left, so the app can resume one it didn't finish.
study.get("/ingest/pending", async (c) => {
  const rows = await db(c.env).query(
    `SELECT j.id AS job_id, j.status, j.done_chunks, j.total_chunks, j.questions_created,
            u.name AS unit_name, j.filename,
            count(ch.id) FILTER (WHERE ch.status IN ('pending','running')) AS remaining
       FROM ingest_jobs j
       JOIN units u ON u.id = j.unit_id
       LEFT JOIN ingest_chunks ch ON ch.job_id = j.id
      WHERE j.status = 'running'
      GROUP BY j.id, u.name
     HAVING count(ch.id) FILTER (WHERE ch.status IN ('pending','running')) > 0
      ORDER BY j.created_at`
  );
  return c.json(rows.map((r) => ({ ...r, remaining: Number(r.remaining) })));
});

export default study;
