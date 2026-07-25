/**
 * Parse hand-typed or pasted questions.
 *
 * Blank line between questions. Mark the correct option with a leading *.
 * Rationale lines start with "- " and are optional, but they are the part that
 * makes a wrong answer teach you something — write them when you can.
 *
 *   A client with DKA has a glucose of 620. What does the nurse monitor closest?
 *   A. Sodium
 *   *B. Potassium
 *   C. Calcium
 *   D. Magnesium
 *   - A: Corrects gradually with fluids; not the immediate threat.
 *   - B: Correct — insulin drives K+ into cells and can cause fatal dysrhythmias.
 *   - C: Not affected by insulin therapy.
 *   - D: Can drop, but is not the priority.
 */

const OPTION = /^(\*?)\s*([A-Da-d])\s*[.)]\s*(.+)$/;
const RATIONALE = /^-\s*([A-Da-d])\s*[:.)]\s*(.+)$/;
const TOPIC = /^(?:topic|#)\s*[:]\s*(.+)$/i;
const LETTERS = ["a", "b", "c", "d"];

export function parseQuestions(text) {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const questions = [];
  const errors = [];

  blocks.forEach((block, bi) => {
    const n = bi + 1;
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    let topic = null;
    const stemLines = [];
    const options = [];
    const rationales = ["", "", "", ""];
    let correctIndex = -1;
    let seenOption = false;

    for (const line of lines) {
      const topicMatch = line.match(TOPIC);
      if (topicMatch && !seenOption) {
        topic = topicMatch[1].trim();
        continue;
      }

      const rationale = line.match(RATIONALE);
      if (rationale) {
        rationales[LETTERS.indexOf(rationale[1].toLowerCase())] = rationale[2].trim();
        continue;
      }

      const option = line.match(OPTION);
      // A line only counts as an option once we've got some question text —
      // otherwise a stem that happens to start with "A." would be eaten.
      if (option && stemLines.length) {
        seenOption = true;
        if (option[1] === "*") correctIndex = options.length;
        options.push(option[3].trim());
        continue;
      }

      if (seenOption) continue; // stray line after the options; ignore
      stemLines.push(line);
    }

    const stem = stemLines.join(" ").trim();
    if (!stem) {
      errors.push(`Question ${n}: no question text`);
      return;
    }
    if (options.length !== 4) {
      errors.push(`Question ${n}: found ${options.length} options, need exactly 4 (A–D)`);
      return;
    }
    if (correctIndex < 0) {
      errors.push(`Question ${n}: mark the correct option with * (e.g. "*B. …")`);
      return;
    }

    questions.push({
      topic,
      stem,
      options,
      correct_index: correctIndex,
      rationales,
      has_rationales: rationales.some(Boolean),
    });
  });

  return { questions, errors };
}

export const EXAMPLE = `A client with type 1 diabetes is admitted with a glucose of 620 mg/dL and pH 7.18. After starting IV fluids and insulin, which lab does the nurse monitor most closely?
A. Serum sodium
*B. Serum potassium
C. Serum calcium
D. Serum magnesium
- A: Shifts occur but correct gradually with fluids; not the immediate threat.
- B: Correct — insulin drives potassium into cells and DKA clients are total-body depleted, risking fatal dysrhythmias.
- C: Not meaningfully affected by insulin therapy.
- D: Can fall, but is not the priority.

Topic: Hypoglycemia
A client on glipizide is diaphoretic, tremulous, and confused. What is the nurse's first action?
*A. Check the blood glucose
B. Give 15 g of fast-acting carbohydrate
C. Call the provider
D. Administer IV dextrose 50%
- A: Correct — assessment precedes intervention when it takes seconds.
- B: Treating without a reading risks missing another cause of confusion.
- C: Delays care the nurse can give independently.
- D: Reserved for clients who cannot swallow.`;
