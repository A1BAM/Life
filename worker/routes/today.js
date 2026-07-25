import { Hono } from "hono";
import { db } from "../db.js";

const today = new Hono();

// Everything the Today screen needs, in one round trip.
today.get("/", async (c) => {
  const sql = db(c.env);
  const tz = c.env.TIMEZONE || "America/New_York";

  const [[exam], [study]] = await Promise.all([
    sql.query(
      `SELECT e.id, e.name, e.exam_date::text AS exam_date,
              c.name AS course_name, c.code AS course_code,
              (e.exam_date - (now() AT TIME ZONE $1)::date) AS days_left
         FROM exams e JOIN courses c ON c.id = e.course_id
        WHERE e.exam_date >= (now() AT TIME ZONE $1)::date AND c.archived = false
        ORDER BY e.exam_date LIMIT 1`,
      [tz]
    ),
    sql.query(
      `SELECT
         (SELECT count(*) FROM questions)                                   AS total_questions,
         (SELECT count(*) FROM review_queue WHERE due_at <= now())          AS due_reviews,
         (SELECT count(*) FROM review_queue
           WHERE due_at <= now() - interval '1 day')                        AS overdue_reviews,
         (SELECT count(*) FROM question_attempts
           WHERE (answered_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date)
                                                                            AS answered_today,
         (SELECT count(*) FROM question_attempts
           WHERE answered_at >= now() - interval '7 days')                  AS week_attempts,
         (SELECT count(*) FROM question_attempts
           WHERE answered_at >= now() - interval '7 days' AND correct)      AS week_correct`,
      [tz]
    ),
  ]);

  const [[daily], [rst], [train]] = await Promise.all([
    sql.query(
      `SELECT (SELECT count(*)::int FROM nn_items WHERE active) AS total,
              (SELECT count(*)::int FROM nn_completions
                WHERE date = (now() AT TIME ZONE $1)::date) AS done`,
      [tz]
    ),
    sql.query(
      // Computed in SQL: a timestamptz that round-trips through JS Date
      // parsing loses its year and reports decades of "clean" days.
      `SELECT (SELECT (now() AT TIME ZONE $1)::date
                      - (max(occurred_at) AT TIME ZONE $1)::date
                 FROM reset_events)::int AS days_clean,
              (SELECT count(*)::int FROM urge_events
                WHERE occurred_at >= now() - interval '7 days') AS urges_7d`,
      [tz]
    ),
    sql.query(
      `SELECT (SELECT COALESCE(target_sessions, 4) FROM weekly_targets
                WHERE week_start = date_trunc('week', now())::date) AS target,
              (SELECT count(*)::int FROM workouts_manual
                WHERE date >= date_trunc('week', now())::date) AS sessions`
    ),
  ]);

  const n = (v) => Number(v ?? 0);
  const totalQuestions = n(study.total_questions);
  const dueReviews = n(study.due_reviews);
  const answeredToday = n(study.answered_today);
  const weekAttempts = n(study.week_attempts);

  // green = done today · amber = due, not done · red = overdue · grey = n/a
  let status = "grey";
  if (totalQuestions > 0) {
    if (n(study.overdue_reviews) > 0) status = "red";
    else if (dueReviews > 0) status = "amber";
    else status = answeredToday > 0 ? "green" : "amber";
  }

  return c.json({
    date: new Date().toISOString().slice(0, 10),
    next_exam: exam
      ? { ...exam, days_left: Number(exam.days_left) }
      : null,
    study: {
      status,
      total_questions: totalQuestions,
      due_reviews: dueReviews,
      answered_today: answeredToday,
      accuracy_7d:
        weekAttempts > 0 ? Math.round((n(study.week_correct) / weekAttempts) * 100) : null,
    },
    daily: {
      // grey until items exist, green when all done, amber while any remain
      status: n(daily.total) === 0 ? "grey" : n(daily.done) >= n(daily.total) ? "green" : "amber",
      done: n(daily.done),
      total: n(daily.total),
    },
    reset: {
      // never red: a reset is data, not a verdict
      status: rst.days_clean == null ? "grey" : "green",
      days_clean: rst.days_clean == null ? null : Number(rst.days_clean),
      urges_7d: n(rst.urges_7d),
    },
    training: {
      status:
        n(train.sessions) >= n(train.target) ? "green"
        : n(train.sessions) > 0 ? "amber"
        : "grey",
      sessions: n(train.sessions),
      target: n(train.target) || 4,
    },
  });
});

export default today;
