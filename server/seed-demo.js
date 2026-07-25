// Dev-only: seeds a sample course, exam schedule, and a handful of questions
// so the practice flow can be exercised without an API key.
// Usage: npm run seed:demo
const db = require("./db");

const existing = db.prepare("SELECT COUNT(*) AS n FROM courses WHERE code = 'DEMO'").get();
if (existing.n > 0) {
  console.log("demo data already seeded");
  process.exit(0);
}

const course = db
  .prepare("INSERT INTO courses (name, code, term, grade_min) VALUES (?, ?, ?, ?)")
  .run("Adult Health II (demo)", "DEMO", "Fall 2026", 80);
const courseId = course.lastInsertRowid;

const in9 = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
db.prepare("INSERT INTO exams (course_id, name, exam_date, weight, score) VALUES (?, ?, ?, ?, ?)")
  .run(courseId, "Exam 1", null, 25, 84);
db.prepare("INSERT INTO exams (course_id, name, exam_date, weight) VALUES (?, ?, ?, ?)")
  .run(courseId, "Exam 2", in9, 25);
db.prepare("INSERT INTO exams (course_id, name, exam_date, weight) VALUES (?, ?, ?, ?)")
  .run(courseId, "Final", in30, 50);

const unit = db
  .prepare("INSERT INTO units (course_id, name) VALUES (?, ?)")
  .run(courseId, "Endocrine");
const unitId = unit.lastInsertRowid;

const questions = [
  {
    topic: "DKA management",
    nclex_category: "Physiological Adaptation",
    stem: "A client with type 1 diabetes is admitted with blood glucose 620 mg/dL, pH 7.18, and deep rapid respirations. After starting IV fluids and an insulin infusion, which lab value requires the nurse's closest monitoring?",
    options: ["Serum sodium", "Serum potassium", "Serum calcium", "Serum magnesium"],
    correct_index: 1,
    rationales: [
      "Sodium shifts occur but are corrected gradually with fluids; they are not the immediate life threat.",
      "Correct — insulin drives potassium into cells, and DKA clients are total-body potassium depleted despite normal-appearing serum levels. Hypokalemia during insulin infusion can cause fatal dysrhythmias.",
      "Calcium is not significantly affected by insulin therapy; picking this confuses DKA with other electrolyte disorders.",
      "Magnesium can drop but is not the priority; the tempting error is treating all electrolytes as equally urgent.",
    ],
  },
  {
    topic: "Hypoglycemia recognition",
    nclex_category: "Reduction of Risk Potential",
    stem: "A client on glipizide is found diaphoretic, tremulous, and confused. What is the nurse's first action?",
    options: [
      "Check the blood glucose level",
      "Give 15 g of fast-acting carbohydrate",
      "Call the provider",
      "Administer IV dextrose 50%",
    ],
    correct_index: 0,
    rationales: [
      "Correct — the symptoms suggest hypoglycemia, but assessment precedes intervention when it takes seconds and confirms treatment. NCLEX rewards assess-then-act when assessment is fast and safe.",
      "Tempting because treatment is urgent, but treating without a glucose reading risks mistreating another cause of confusion; a fingerstick takes seconds.",
      "Calling the provider delays treatment the nurse can deliver independently — a classic 'pass the buck' distractor.",
      "IV D50 is for unconscious clients or those unable to swallow; this client is conscious.",
    ],
  },
  {
    topic: "Levothyroxine teaching",
    nclex_category: "Pharmacological and Parenteral Therapies",
    stem: "Which statement by a client newly prescribed levothyroxine indicates a need for further teaching?",
    options: [
      "\"I'll take it on an empty stomach in the morning.\"",
      "\"I'll stop taking it once my energy comes back.\"",
      "\"I'll report palpitations or chest pain.\"",
      "\"It may take several weeks before I feel the full effect.\"",
    ],
    correct_index: 1,
    rationales: [
      "This is correct behavior — levothyroxine is taken on an empty stomach for absorption; it does not indicate a knowledge gap.",
      "Correct answer — thyroid replacement is lifelong; stopping when symptoms improve indicates a dangerous misunderstanding.",
      "This is correct behavior — palpitations suggest over-replacement and should be reported.",
      "This is correct behavior — full effect takes 4–6 weeks. Students who miss the 'further teaching' framing pick a true statement.",
    ],
  },
  {
    topic: "Addisonian crisis",
    nclex_category: "Physiological Adaptation",
    stem: "A client with Addison's disease develops nausea, hypotension (BP 78/50), and confusion after a bout of influenza. Which order should the nurse implement first?",
    options: [
      "IV hydrocortisone bolus",
      "0.9% normal saline at 250 mL/hr",
      "Blood cultures ×2",
      "12-lead ECG",
    ],
    correct_index: 0,
    rationales: [
      "Correct — this is adrenal crisis; replacing cortisol is the definitive, life-saving intervention and is given immediately alongside fluids.",
      "Fluids matter and start almost simultaneously, but without cortisol the client cannot maintain vascular tone — saline alone won't reverse the crisis.",
      "Cultures are appropriate if sepsis is suspected but never precede life-saving treatment; the illness trigger tempts students toward a sepsis workup.",
      "ECG monitors hyperkalemia effects but is monitoring, not treatment — an 'assessment first' overgeneralization.",
    ],
  },
  {
    topic: "SIADH vs DI",
    nclex_category: "Reduction of Risk Potential",
    stem: "Following a head injury, a client's urine output is 200 mL over 8 hours with urine specific gravity 1.036 and serum sodium 118 mEq/L. The nurse should anticipate which intervention?",
    options: [
      "Desmopressin (DDAVP) administration",
      "Fluid restriction",
      "Rapid infusion of D5W",
      "Increase oral free water intake",
    ],
    correct_index: 1,
    rationales: [
      "DDAVP treats diabetes insipidus — the opposite problem. Students who memorize 'head injury = DI' without checking the data pick this.",
      "Correct — concentrated urine, low output, and dilutional hyponatremia indicate SIADH; first-line management is fluid restriction.",
      "D5W is free water and would worsen the hyponatremia — dangerous.",
      "More free water dilutes sodium further; tempting for students who equate low urine output with dehydration.",
    ],
  },
];

const insert = db.prepare(
  `INSERT INTO questions (course_id, unit_id, topic, nclex_category, stem, options, correct_index, rationales, source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
);
for (const q of questions) {
  insert.run(courseId, unitId, q.topic, q.nclex_category, q.stem,
    JSON.stringify(q.options), q.correct_index, JSON.stringify(q.rationales));
}

console.log(`seeded demo course (id ${courseId}) with ${questions.length} questions`);
