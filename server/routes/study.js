const express = require("express");
const multer = require("multer");
const db = require("../db");
const { generateFromChunk, chunkText, hasKey } = require("../ai/generate");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const REVIEW_INTERVALS_DAYS = [1, 3, 7]; // stage 0, 1, 2

// ---------- courses & exams ----------

router.get("/courses", (req, res) => {
  const courses = db
    .prepare("SELECT * FROM courses WHERE archived = 0 ORDER BY name")
    .all();
  const exams = db.prepare("SELECT * FROM exams ORDER BY exam_date").all();
  res.json(
    courses.map((c) => ({ ...c, exams: exams.filter((e) => e.course_id === c.id) }))
  );
});

router.post("/courses", (req, res) => {
  const { name, code, term, grade_min } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const info = db
    .prepare("INSERT INTO courses (name, code, term, grade_min) VALUES (?, ?, ?, ?)")
    .run(name, code || null, term || null, grade_min ?? 80);
  res.json(db.prepare("SELECT * FROM courses WHERE id = ?").get(info.lastInsertRowid));
});

router.patch("/courses/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM courses WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  const { name, code, term, grade_min, archived } = req.body || {};
  db.prepare(
    `UPDATE courses SET name = ?, code = ?, term = ?, grade_min = ?, archived = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(
    name ?? c.name,
    code ?? c.code,
    term ?? c.term,
    grade_min ?? c.grade_min,
    archived ?? c.archived,
    c.id
  );
  res.json(db.prepare("SELECT * FROM courses WHERE id = ?").get(c.id));
});

router.post("/courses/:id/exams", (req, res) => {
  const c = db.prepare("SELECT * FROM courses WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "course not found" });
  const { name, exam_date, weight, score } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const info = db
    .prepare(
      "INSERT INTO exams (course_id, name, exam_date, weight, score) VALUES (?, ?, ?, ?, ?)"
    )
    .run(c.id, name, exam_date || null, weight ?? 0, score ?? null);
  res.json(db.prepare("SELECT * FROM exams WHERE id = ?").get(info.lastInsertRowid));
});

router.patch("/exams/:id", (req, res) => {
  const e = db.prepare("SELECT * FROM exams WHERE id = ?").get(req.params.id);
  if (!e) return res.status(404).json({ error: "not found" });
  const { name, exam_date, weight, score } = req.body || {};
  db.prepare(
    `UPDATE exams SET name = ?, exam_date = ?, weight = ?, score = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(name ?? e.name, exam_date ?? e.exam_date, weight ?? e.weight,
        score === undefined ? e.score : score, e.id);
  res.json(db.prepare("SELECT * FROM exams WHERE id = ?").get(e.id));
});

router.delete("/exams/:id", (req, res) => {
  db.prepare("DELETE FROM exams WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Grade calculator: "what do I need on the remaining work to hit X?"
router.get("/courses/:id/grade-scenarios", (req, res) => {
  const c = db.prepare("SELECT * FROM courses WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  const exams = db.prepare("SELECT * FROM exams WHERE course_id = ?").all(c.id);

  const graded = exams.filter((e) => e.score != null);
  const remaining = exams.filter((e) => e.score == null);
  const earned = graded.reduce((s, e) => s + (e.score * e.weight) / 100, 0);
  const gradedWeight = graded.reduce((s, e) => s + e.weight, 0);
  const remainingWeight = remaining.reduce((s, e) => s + e.weight, 0);

  const targets = [...new Set([c.grade_min, 85, 90])].sort((a, b) => a - b);
  const scenarios = targets.map((target) => {
    if (remainingWeight === 0) {
      return { target, needed: null, feasible: earned >= target * (gradedWeight / 100) };
    }
    const needed = ((target - earned) / remainingWeight) * 100;
    return {
      target,
      needed: Math.round(needed * 10) / 10,
      feasible: needed <= 100,
    };
  });

  res.json({
    current:
      gradedWeight > 0 ? Math.round((earned / gradedWeight) * 1000) / 10 : null,
    earned: Math.round(earned * 10) / 10,
    graded_weight: gradedWeight,
    remaining_weight: remainingWeight,
    scenarios,
  });
});

// ---------- units & questions ----------

router.get("/courses/:id/units", (req, res) => {
  res.json(
    db.prepare("SELECT * FROM units WHERE course_id = ? ORDER BY name").all(req.params.id)
  );
});

router.get("/questions", (req, res) => {
  const { course_id, unit_id } = req.query;
  let sql = "SELECT * FROM questions WHERE 1=1";
  const args = [];
  if (course_id) { sql += " AND course_id = ?"; args.push(course_id); }
  if (unit_id) { sql += " AND unit_id = ?"; args.push(unit_id); }
  sql += " ORDER BY created_at DESC";
  res.json(db.prepare(sql).all(...args).map(hydrateQuestion));
});

router.delete("/questions/:id", (req, res) => {
  db.prepare("DELETE FROM questions WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

function hydrateQuestion(q) {
  return { ...q, options: JSON.parse(q.options), rationales: JSON.parse(q.rationales) };
}

// ---------- practice mode ----------
// The only way to study. Selection order: due reviews → unseen → least recently answered.

router.get("/practice/next", (req, res) => {
  const { course_id, unit_id } = req.query;
  const filt = (alias) => {
    let s = "";
    const a = [];
    if (course_id) { s += ` AND ${alias}.course_id = ?`; a.push(course_id); }
    if (unit_id) { s += ` AND ${alias}.unit_id = ?`; a.push(unit_id); }
    return { s, a };
  };
  const f = filt("q");

  // 1. due reviews first
  let q = db.prepare(
    `SELECT q.*, r.due_at FROM review_queue r JOIN questions q ON q.id = r.question_id
     WHERE r.due_at <= datetime('now') AND q.status = 'active' ${f.s}
     ORDER BY r.due_at LIMIT 1`
  ).get(...f.a);
  let pool = "review";

  // 2. never attempted
  if (!q) {
    q = db.prepare(
      `SELECT q.* FROM questions q
       WHERE q.status = 'active' ${f.s}
         AND NOT EXISTS (SELECT 1 FROM question_attempts a WHERE a.question_id = q.id)
       ORDER BY RANDOM() LIMIT 1`
    ).get(...f.a);
    pool = "new";
  }

  // 3. active, least recently answered
  if (!q) {
    q = db.prepare(
      `SELECT q.* FROM questions q
       WHERE q.status = 'active' ${f.s}
       ORDER BY (SELECT MAX(a.answered_at) FROM question_attempts a WHERE a.question_id = q.id) ASC
       LIMIT 1`
    ).get(...f.a);
    pool = "rotation";
  }

  // 4. everything retired — recycle rather than show an empty screen
  if (!q) {
    q = db.prepare(
      `SELECT q.* FROM questions q WHERE 1=1 ${f.s} ORDER BY RANDOM() LIMIT 1`
    ).get(...f.a);
    pool = "retired";
  }

  if (!q) return res.json({ question: null });

  const hydrated = hydrateQuestion(q);
  // Never send the answer with the question.
  const { correct_index, rationales, consecutive_correct, ...pub } = hydrated;
  res.json({ question: pub, pool });
});

router.post("/attempts", (req, res) => {
  const { question_id, answered_index } = req.body || {};
  const q = db.prepare("SELECT * FROM questions WHERE id = ?").get(question_id);
  if (!q) return res.status(404).json({ error: "question not found" });
  if (![0, 1, 2, 3].includes(answered_index))
    return res.status(400).json({ error: "answered_index must be 0-3" });

  const correct = answered_index === q.correct_index;

  db.transaction(() => {
    db.prepare(
      "INSERT INTO question_attempts (question_id, answered_index, correct) VALUES (?, ?, ?)"
    ).run(q.id, answered_index, correct ? 1 : 0);

    const inQueue = db
      .prepare("SELECT * FROM review_queue WHERE question_id = ?")
      .get(q.id);

    if (!correct) {
      // wrong → (re)enter queue at stage 0 (1 day), reset streak, reactivate if retired
      db.prepare(
        `INSERT INTO review_queue (question_id, stage, due_at)
         VALUES (?, 0, datetime('now', '+1 day'))
         ON CONFLICT(question_id) DO UPDATE SET
           stage = 0, due_at = datetime('now', '+1 day'), updated_at = datetime('now')`
      ).run(q.id);
      db.prepare(
        "UPDATE questions SET consecutive_correct = 0, status = 'active', updated_at = datetime('now') WHERE id = ?"
      ).run(q.id);
    } else {
      const streak = q.consecutive_correct + 1;
      if (streak >= 2) {
        // right twice → retire
        db.prepare("DELETE FROM review_queue WHERE question_id = ?").run(q.id);
        db.prepare(
          "UPDATE questions SET consecutive_correct = ?, status = 'retired', updated_at = datetime('now') WHERE id = ?"
        ).run(streak, q.id);
      } else {
        db.prepare(
          "UPDATE questions SET consecutive_correct = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(streak, q.id);
        if (inQueue) {
          // advance interval: 1d → 3d → 7d
          const stage = Math.min(inQueue.stage + 1, REVIEW_INTERVALS_DAYS.length - 1);
          db.prepare(
            `UPDATE review_queue SET stage = ?, due_at = datetime('now', '+' || ? || ' days'),
             updated_at = datetime('now') WHERE question_id = ?`
          ).run(stage, REVIEW_INTERVALS_DAYS[stage], q.id);
        }
      }
    }
  })();

  const hydrated = hydrateQuestion(q);
  res.json({
    correct,
    correct_index: q.correct_index,
    rationales: hydrated.rationales,
  });
});

// ---------- weak-topic heatmap (the main study screen) ----------

router.get("/heatmap", (req, res) => {
  const rows = db.prepare(
    `SELECT c.id AS course_id, c.name AS course_name, c.code AS course_code,
            u.id AS unit_id, u.name AS unit_name,
            COUNT(DISTINCT q.id) AS question_count,
            COUNT(a.id) AS attempt_count,
            SUM(COALESCE(a.correct, 0)) AS correct_count,
            (SELECT COUNT(*) FROM review_queue r JOIN questions q2 ON q2.id = r.question_id
             WHERE q2.unit_id = u.id AND r.due_at <= datetime('now')) AS due_count
     FROM units u
     JOIN courses c ON c.id = u.course_id
     LEFT JOIN questions q ON q.unit_id = u.id
     LEFT JOIN question_attempts a ON a.question_id = q.id
     WHERE c.archived = 0
     GROUP BY u.id
     ORDER BY c.name, u.name`
  ).all();

  const byCourse = {};
  for (const r of rows) {
    byCourse[r.course_id] ||= {
      course_id: r.course_id,
      course_name: r.course_name,
      course_code: r.course_code,
      units: [],
    };
    byCourse[r.course_id].units.push({
      unit_id: r.unit_id,
      unit_name: r.unit_name,
      question_count: r.question_count,
      attempt_count: r.attempt_count,
      accuracy:
        r.attempt_count > 0
          ? Math.round((r.correct_count / r.attempt_count) * 100)
          : null,
      due_count: r.due_count,
    });
  }
  res.json(Object.values(byCourse));
});

// ---------- slide ingest → question generation ----------

router.get("/ingest/jobs", (req, res) => {
  res.json(
    db.prepare(
      `SELECT j.*, c.name AS course_name, u.name AS unit_name
       FROM ingest_jobs j
       JOIN courses c ON c.id = j.course_id
       JOIN units u ON u.id = j.unit_id
       ORDER BY j.created_at DESC LIMIT 20`
    ).all()
  );
});

router.post("/ingest", upload.single("file"), async (req, res) => {
  if (!hasKey())
    return res.status(503).json({
      error: "ANTHROPIC_API_KEY is not set — question generation is unavailable",
    });
  const { course_id, unit_name } = req.body || {};
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(course_id);
  if (!course) return res.status(400).json({ error: "valid course_id required" });
  if (!unit_name) return res.status(400).json({ error: "unit_name required" });
  if (!req.file) return res.status(400).json({ error: "PDF file required" });

  let text;
  try {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const parsed = await pdfParse(req.file.buffer);
    text = parsed.text || "";
  } catch (err) {
    return res.status(400).json({ error: `could not read PDF: ${err.message}` });
  }
  if (text.trim().length < 200)
    return res.status(400).json({ error: "PDF contains almost no extractable text (scanned images?)" });

  // find-or-create the unit
  db.prepare("INSERT OR IGNORE INTO units (course_id, name) VALUES (?, ?)").run(
    course.id,
    unit_name.trim()
  );
  const unit = db
    .prepare("SELECT * FROM units WHERE course_id = ? AND name = ?")
    .get(course.id, unit_name.trim());

  const chunks = chunkText(text);
  const info = db
    .prepare(
      `INSERT INTO ingest_jobs (course_id, unit_id, filename, status, total_chunks)
       VALUES (?, ?, ?, 'running', ?)`
    )
    .run(course.id, unit.id, req.file.originalname, chunks.length);
  const jobId = info.lastInsertRowid;

  // fire-and-forget; the client polls /ingest/jobs
  runIngestJob(jobId, chunks, course, unit).catch((err) => {
    db.prepare(
      "UPDATE ingest_jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(String(err.message || err), jobId);
  });

  res.json({ job_id: jobId, total_chunks: chunks.length });
});

async function runIngestJob(jobId, chunks, course, unit) {
  let created = 0;
  let firstError = null;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const questions = await generateFromChunk(chunks[i], {
        courseName: course.name,
        unitName: unit.name,
      });
      const insert = db.prepare(
        `INSERT INTO questions (course_id, unit_id, topic, nclex_category, stem, options, correct_index, rationales, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated')`
      );
      db.transaction(() => {
        for (const q of questions) {
          insert.run(
            course.id,
            unit.id,
            q.topic || null,
            q.nclex_category || null,
            q.stem,
            JSON.stringify(q.options),
            q.correct_index,
            JSON.stringify(q.rationales)
          );
          created++;
        }
      })();
    } catch (err) {
      firstError ||= `chunk ${i + 1}: ${err.message}`;
    }
    db.prepare(
      "UPDATE ingest_jobs SET done_chunks = ?, questions_created = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(i + 1, created, jobId);
  }
  db.prepare(
    "UPDATE ingest_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(created > 0 ? "done" : "error", firstError, jobId);
}

module.exports = router;
