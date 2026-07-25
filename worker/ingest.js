import { db } from "./db.js";
import { generateFromChunk } from "./ai/generate.js";

const MAX_ATTEMPTS = 3;
// A chunk left 'running' this long is assumed abandoned (tab closed, request
// timed out) and becomes claimable again.
const STALE = "2 minutes";

/**
 * Claim exactly one chunk and generate its questions.
 *
 * Pull-based on purpose: Cloudflare Queues is a paid feature, and a frequent
 * cron would keep the Neon instance awake around the clock and burn the free
 * plan's compute hours. Instead the client calls this once per chunk while the
 * app is open, and any chunk left behind is picked up the next time it opens.
 *
 * Returns { done: true } when there is nothing left to process.
 */
export async function processNextChunk(env, jobId = null) {
  const sql = db(env);

  // Atomic claim: the subquery takes a row lock and skips rows another caller
  // already holds, so two tabs can't process the same chunk.
  const [chunk] = await sql.query(
    `UPDATE ingest_chunks SET status = 'running', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM ingest_chunks
         WHERE ($1::bigint IS NULL OR job_id = $1)
           AND (status = 'pending'
                OR (status = 'running' AND updated_at < now() - interval '${STALE}'))
         ORDER BY (status = 'running') DESC, seq
         LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [jobId]
  );
  if (!chunk) return { done: true };

  const [ctx] = await sql.query(
    `SELECT c.name AS course_name, u.name AS unit_name, j.course_id, j.unit_id
       FROM ingest_jobs j
       JOIN courses c ON c.id = j.course_id
       JOIN units   u ON u.id = j.unit_id
      WHERE j.id = $1`,
    [chunk.job_id]
  );
  if (!ctx) return { done: true };

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

    const [job] = await sql.query(
      `WITH done AS (
         UPDATE ingest_chunks SET status = 'done', error = NULL
          WHERE id = $1 RETURNING job_id
       )
       UPDATE ingest_jobs j
          SET done_chunks       = done_chunks + 1,
              questions_created = questions_created + $2,
              status = CASE WHEN done_chunks + 1 >= total_chunks THEN 'done' ELSE status END
         FROM done WHERE j.id = done.job_id
       RETURNING j.id, j.status, j.done_chunks, j.total_chunks, j.questions_created`,
      [chunk.id, questions.length]
    );

    return { done: false, job, questions_created: questions.length };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500);
    const giveUp = chunk.attempts >= MAX_ATTEMPTS;

    const [job] = await sql.query(
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
         FROM upd WHERE j.id = upd.job_id
       RETURNING j.id, j.status, j.done_chunks, j.total_chunks, j.questions_created`,
      [chunk.id, message, giveUp]
    );

    // Not fatal to the run — the client keeps stepping and this chunk either
    // retries or is already recorded as failed.
    return { done: false, job, error: message, gave_up: giveUp };
  }
}
