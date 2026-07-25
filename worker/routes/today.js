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
  });
});

export default today;
