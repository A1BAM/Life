import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-5";

const NCLEX_CATEGORIES = [
  "Management of Care",
  "Safety and Infection Control",
  "Health Promotion and Maintenance",
  "Psychosocial Integrity",
  "Basic Care and Comfort",
  "Pharmacological and Parenteral Therapies",
  "Reduction of Risk Potential",
  "Physiological Adaptation",
];

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Short topic label, e.g. 'DKA management'",
          },
          nclex_category: { type: "string", enum: NCLEX_CATEGORIES },
          stem: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_index: { type: "integer", enum: [0, 1, 2, 3] },
          rationales: {
            type: "array",
            items: { type: "string" },
            description:
              "One rationale per option, same order as options. For the correct option: why it is right. For each distractor: precisely why a student would pick it and why it is wrong.",
          },
        },
        required: ["topic", "nclex_category", "stem", "options", "correct_index", "rationales"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write NCLEX-style practice questions for an accelerated BSN nursing student. The student's known failure mode is studying at recognition level; your questions must force application-level recall.

Rules:
- Write questions at NCLEX application/analysis level: clinical scenarios requiring prioritization, delegation, assessment-vs-intervention decisions, or recognition of complications. Avoid pure fact-recall unless the fact is safety-critical (e.g. lab values, drug antidotes).
- Exactly 4 options per question, exactly one correct.
- Distractors must be plausible — the kind a student who only re-read the slides would pick. Never use joke options or obviously-wrong fillers.
- The rationales for WRONG answers matter more than the right one. For each distractor, explain the specific misconception that makes it tempting and why it fails.
- Ground every question in the provided lecture content. Do not invent content the lecture does not cover, but you may draw on standard nursing knowledge to build the clinical scenario around it.
- Skip administrative slides (syllabus, objectives, references) — generate nothing from them.
- Generate 5 to 7 questions per chunk if the content supports it; fewer is fine for thin content.`;

/**
 * Generate questions from one chunk of lecture text.
 * Returns validated question objects (possibly empty).
 */
export async function generateFromChunk(env, chunkText, { courseName, unitName }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Course: ${courseName}\nUnit: ${unitName}\n\nLecture content chunk:\n\n${chunkText}`,
      },
    ],
  });

  if (msg.stop_reason === "refusal") throw new Error("model declined this chunk");
  if (msg.stop_reason === "max_tokens") throw new Error("output truncated at max_tokens");

  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text);
  return (parsed.questions || []).filter(
    (q) =>
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      Array.isArray(q.rationales) &&
      q.rationales.length === 4 &&
      Number.isInteger(q.correct_index) &&
      q.correct_index >= 0 &&
      q.correct_index <= 3 &&
      q.stem
  );
}

export { NCLEX_CATEGORIES };
