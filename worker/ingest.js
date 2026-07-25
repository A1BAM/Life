import { db } from "./db.js";
import { generateFromChunk } from "./ai/generate.js";

const MAX_ATTEMPTS = 3;

/**
 * Generate questions for a single chunk and fold the result into its job.
 * Claims the chunk first so a cron sweep and a queue retry can't double-run it.
 */
export async function processChunk(env, chunkId) {
  const sql = db(env);

  const [chunk] = await sql.query(
    `UPDATE ingest_chunks
        SET status = 'running', attempts = attempts + 1
      WHERE id = $1 AND status IN ('pending','running')
      RETURNING *`,
    [chunkId]
  );
  if (!chunk) return; // already done, or claimed elsewhere

  const [ctx] = await sql.query(
    `SELECT c.name AS course_name, u.name AS unit_name, j.course_id, j.unit_id
       FROM ingest_jobs j
       JOIN courses c ON c.id = j.course_id
       JOIN units   u ON u.id = j.unit_id
      WHERE j.id = $1`,
    [chunk.job_id]
  );
  if (!ctx) return;

  try {
    const questions = await generateFromChunk(env, chunk.content, {
      courseName: ctx.course_name,
      unitName: ctx.unit_name,
    });

    if (questions.length) {
      await sql.query(
        `INSERT INTO questions
           (course_id, unit_id, topic, nclex_category, stem, options, correct_index, rationales)
         SELECT $1, $2, q->>'topic', q->>'nclex_category', q->>'stem',
                q->'options', (q->>'correct_index')::int, q->'rationales'
           FROM jsonb_array_elements($3::jsonb) AS q`,
        [ctx.course_id, ctx.unit_id, JSON.stringify(questions)]
      );
    }

    await sql.query(
      `WITH done AS (
         UPDATE ingest_chunks SET status = 'done', error = NULL WHERE id = $1 RETURNING job_id
       )
       UPDATE ingest_jobs j
          SET done_chunks       = done_chunks + 1,
              questions_created = questions_created + $2,
              status = CASE WHEN done_chunks + 1 >= total_chunks THEN 'done' ELSE status END
        FROM done WHERE j.id = done.job_id`,
      [chunkId, questions.length]
    );
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500);
    const giveUp = chunk.attempts + 1 >= MAX_ATTEMPTS;

    await sql.query(
      `WITH upd AS (
         UPDATE ingest_chunks
            SET status = CASE WHEN $3::boolean THEN 'error' ELSE 'pending' END,
                error  = $2
          WHERE id = $1 RETURNING job_id, status
       )
       UPDATE ingest_jobs j
          SET done_chunks = done_chunks + CASE WHEN upd.status = 'error' THEN 1 ELSE 0 END,
              error       = COALESCE(j.error, $2),
              status = CASE
                WHEN done_chunks + CASE WHEN upd.status = 'error' THEN 1 ELSE 0 END >= total_chunks
                THEN CASE WHEN questions_created > 0 THEN 'done' ELSE 'error' END
                ELSE j.status END
        FROM upd WHERE j.id = upd.job_id`,
      [chunkId, message, giveUp]
    );

    if (!giveUp) throw err; // let the queue retry with backoff
  }
}

/**
 * Cron safety net: re-drive chunks left pending (no queue bound) or stuck
 * running (a Worker died mid-chunk).
 */
export async function sweepStuckChunks(env, limit = 25) {
  const sql = db(env);
  const stuck = await sql.query(
    `SELECT id FROM ingest_chunks
      WHERE (status = 'pending')
         OR (status = 'running' AND updated_at < now() - interval '10 minutes')
      ORDER BY updated_at LIMIT $1`,
    [limit]
  );
  for (const { id } of stuck) {
    try {
      await processChunk(env, id);
    } catch {
      // already recorded on the chunk row; keep sweeping
    }
  }
  return stuck.length;
}
