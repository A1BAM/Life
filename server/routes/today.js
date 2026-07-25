const express = require("express");
const db = require("../db");

const router = express.Router();

// Everything the Today screen needs in one round trip.
router.get("/", (req, res) => {
  const nextExam = db.prepare(
    `SELECT e.id, e.name, e.exam_date, c.name AS course_name, c.code AS course_code,
            CAST(julianday(e.exam_date) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left
     FROM exams e JOIN courses c ON c.id = e.course_id
     WHERE e.exam_date >= date('now', 'localtime') AND c.archived = 0
     ORDER BY e.exam_date LIMIT 1`
  ).get();

  const totalQuestions = db.prepare("SELECT COUNT(*) AS n FROM questions").get().n;
  const dueReviews = db.prepare(
    "SELECT COUNT(*) AS n FROM review_queue WHERE due_at <= datetime('now')"
  ).get().n;
  const overdueReviews = db.prepare(
    "SELECT COUNT(*) AS n FROM review_queue WHERE due_at <= datetime('now', '-1 day')"
  ).get().n;
  const answeredToday = db.prepare(
    "SELECT COUNT(*) AS n FROM question_attempts WHERE date(answered_at, 'localtime') = date('now', 'localtime')"
  ).get().n;
  const week = db.prepare(
    `SELECT COUNT(*) AS n, SUM(correct) AS c FROM question_attempts
     WHERE answered_at >= datetime('now', '-7 days')`
  ).get();

  // Color language: green = done today, amber = due not done, red = overdue, grey = n/a
  let studyStatus = "grey";
  if (totalQuestions > 0) {
    if (overdueReviews > 0) studyStatus = "red";
    else if (dueReviews > 0) studyStatus = "amber";
    else if (answeredToday > 0) studyStatus = "green";
    else studyStatus = "amber";
  }

  res.json({
    date: new Date().toISOString().slice(0, 10),
    next_exam: nextExam || null,
    study: {
      status: studyStatus,
      total_questions: totalQuestions,
      due_reviews: dueReviews,
      answered_today: answeredToday,
      accuracy_7d: week.n > 0 ? Math.round((week.c / week.n) * 100) : null,
    },
  });
});

module.exports = router;
