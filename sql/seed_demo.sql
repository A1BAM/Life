-- Optional: a demo course + 5 real NCLEX-style questions so the practice loop
-- can be exercised before any generation runs.
--   psql "$DATABASE_URL" -f sql/seed_demo.sql
-- Remove later with:  DELETE FROM courses WHERE code = 'DEMO';

INSERT INTO courses (name, code, term, grade_min)
SELECT 'Adult Health II (demo)', 'DEMO', 'Fall 2026', 80
WHERE NOT EXISTS (SELECT 1 FROM courses WHERE code = 'DEMO');

INSERT INTO exams (course_id, name, exam_date, weight, score)
SELECT id, 'Exam 1', NULL, 25, 84 FROM courses WHERE code='DEMO'
  AND NOT EXISTS (SELECT 1 FROM exams e JOIN courses c ON c.id=e.course_id
                  WHERE c.code='DEMO' AND e.name='Exam 1');
INSERT INTO exams (course_id, name, exam_date, weight)
SELECT id, 'Exam 2', current_date + 9, 25 FROM courses WHERE code='DEMO'
  AND NOT EXISTS (SELECT 1 FROM exams e JOIN courses c ON c.id=e.course_id
                  WHERE c.code='DEMO' AND e.name='Exam 2');
INSERT INTO exams (course_id, name, exam_date, weight)
SELECT id, 'Final', current_date + 30, 50 FROM courses WHERE code='DEMO'
  AND NOT EXISTS (SELECT 1 FROM exams e JOIN courses c ON c.id=e.course_id
                  WHERE c.code='DEMO' AND e.name='Final');

INSERT INTO units (course_id, name)
SELECT id, 'Endocrine' FROM courses WHERE code='DEMO'
ON CONFLICT (course_id, name) DO NOTHING;

INSERT INTO questions
  (course_id, unit_id, topic, nclex_category, stem, options, correct_index, rationales, source)
SELECT c.id, u.id, q.topic, q.cat, q.stem, q.options, q.correct_index, q.rationales, 'manual'
FROM courses c
JOIN units u ON u.course_id = c.id AND u.name = 'Endocrine'
CROSS JOIN (VALUES
 ('DKA management','Physiological Adaptation',
  'A client with type 1 diabetes is admitted with blood glucose 620 mg/dL, pH 7.18, and deep rapid respirations. After starting IV fluids and an insulin infusion, which lab value requires the nurse''s closest monitoring?',
  '["Serum sodium","Serum potassium","Serum calcium","Serum magnesium"]'::jsonb, 1,
  '["Sodium shifts occur but are corrected gradually with fluids; not the immediate life threat.","Correct — insulin drives potassium into cells, and DKA clients are total-body potassium depleted despite normal-appearing serum levels. Hypokalemia during insulin infusion can cause fatal dysrhythmias.","Calcium is not significantly affected by insulin therapy; picking this confuses DKA with other electrolyte disorders.","Magnesium can drop but is not the priority; the tempting error is treating all electrolytes as equally urgent."]'::jsonb),
 ('Hypoglycemia recognition','Reduction of Risk Potential',
  'A client on glipizide is found diaphoretic, tremulous, and confused. What is the nurse''s first action?',
  '["Check the blood glucose level","Give 15 g of fast-acting carbohydrate","Call the provider","Administer IV dextrose 50%"]'::jsonb, 0,
  '["Correct — assessment precedes intervention when it takes seconds and confirms treatment. NCLEX rewards assess-then-act when assessment is fast and safe.","Tempting because treatment is urgent, but treating without a reading risks mistreating another cause of confusion; a fingerstick takes seconds.","Calling the provider delays treatment the nurse can deliver independently — a classic pass-the-buck distractor.","IV D50 is for unconscious clients or those unable to swallow; this client is conscious."]'::jsonb),
 ('Levothyroxine teaching','Pharmacological and Parenteral Therapies',
  'Which statement by a client newly prescribed levothyroxine indicates a need for further teaching?',
  '["I will take it on an empty stomach in the morning.","I will stop taking it once my energy comes back.","I will report palpitations or chest pain.","It may take several weeks before I feel the full effect."]'::jsonb, 1,
  '["Correct behavior — levothyroxine is taken on an empty stomach for absorption; not a knowledge gap.","Correct answer — thyroid replacement is lifelong; stopping when symptoms improve is a dangerous misunderstanding.","Correct behavior — palpitations suggest over-replacement and should be reported.","Correct behavior — full effect takes 4-6 weeks. Students who miss the further-teaching framing pick a true statement."]'::jsonb),
 ('Addisonian crisis','Physiological Adaptation',
  'A client with Addison''s disease develops nausea, hypotension (BP 78/50), and confusion after a bout of influenza. Which order should the nurse implement first?',
  '["IV hydrocortisone bolus","0.9% normal saline at 250 mL/hr","Blood cultures x2","12-lead ECG"]'::jsonb, 0,
  '["Correct — this is adrenal crisis; replacing cortisol is the definitive, life-saving intervention, given immediately alongside fluids.","Fluids start almost simultaneously, but without cortisol the client cannot maintain vascular tone — saline alone will not reverse the crisis.","Cultures are appropriate if sepsis is suspected but never precede life-saving treatment; the illness trigger tempts a sepsis workup.","ECG monitors hyperkalemia effects but is monitoring, not treatment — an assessment-first overgeneralization."]'::jsonb),
 ('SIADH vs DI','Reduction of Risk Potential',
  'Following a head injury, a client''s urine output is 200 mL over 8 hours with urine specific gravity 1.036 and serum sodium 118 mEq/L. The nurse should anticipate which intervention?',
  '["Desmopressin (DDAVP) administration","Fluid restriction","Rapid infusion of D5W","Increase oral free water intake"]'::jsonb, 1,
  '["DDAVP treats diabetes insipidus — the opposite problem. Students who memorize head injury = DI without checking the data pick this.","Correct — concentrated urine, low output, and dilutional hyponatremia indicate SIADH; first-line management is fluid restriction.","D5W is free water and would worsen the hyponatremia — dangerous.","More free water dilutes sodium further; tempting for those who equate low urine output with dehydration."]'::jsonb)
) AS q(topic, cat, stem, options, correct_index, rationales)
WHERE c.code = 'DEMO'
  AND NOT EXISTS (SELECT 1 FROM questions x WHERE x.stem = q.stem);
