import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EXAMPLE, parseQuestions } from "../parseQuestions";

export default function AddQuestions() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get("/study/courses").then((cs) => {
      setCourses(cs);
      if (cs.length === 1) setCourseId(String(cs[0].id));
    });
  }, []);

  const { questions, errors } = useMemo(() => parseQuestions(text), [text]);
  const ready = courseId && unitName.trim() && questions.length > 0 && errors.length === 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/study/questions/import", {
        course_id: Number(courseId),
        unit_name: unitName,
        questions,
      });
      setDone(r);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="pt-2">
        <Link to="/study" className="text-zinc-400 text-sm">← Study</Link>
      </div>

      {done && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded-xl p-3 text-sm">
          Added {done.imported} question{done.imported === 1 ? "" : "s"} to {done.unit}.{" "}
          <Link to="/study/practice" className="text-emerald-400 font-medium">Practice →</Link>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="font-medium">Add questions</div>

        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none"
        >
          <option value="">Course…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.code || c.name}</option>
          ))}
        </select>

        <input
          placeholder="Unit (e.g. Endocrine)"
          value={unitName}
          onChange={(e) => setUnitName(e.target.value)}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none"
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={"Paste or type questions here.\n\nBlank line between questions.\nMark the right answer with *"}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none font-mono leading-relaxed"
        />

        <div className="flex items-center justify-between text-xs">
          <button
            onClick={() => setText(EXAMPLE)}
            className="text-zinc-400 underline underline-offset-2"
          >
            Show the format
          </button>
          {text.trim() && (
            <span className={errors.length ? "text-amber-400" : "text-emerald-400"}>
              {questions.length} ready{errors.length ? `, ${errors.length} to fix` : ""}
            </span>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="text-amber-400 text-xs space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}

        {error && <p className="text-red-400 text-sm whitespace-pre-line">{error}</p>}

        <button
          onClick={save}
          disabled={!ready || busy}
          className="w-full bg-emerald-600 disabled:opacity-40 rounded-xl py-3 font-medium"
        >
          {busy ? "Saving…" : questions.length ? `Add ${questions.length} question${questions.length === 1 ? "" : "s"}` : "Add questions"}
        </button>
      </div>

      {questions.length > 0 && (
        <div className="space-y-2">
          <div className="text-zinc-500 text-xs uppercase tracking-wide">Preview</div>
          {questions.map((q, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm">
              {q.topic && <div className="text-zinc-500 text-xs mb-1">{q.topic}</div>}
              <p className="text-zinc-200">{q.stem}</p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {q.options.map((o, oi) => (
                  <li key={oi} className={oi === q.correct_index ? "text-emerald-400" : "text-zinc-400"}>
                    {String.fromCharCode(65 + oi)}. {o}
                  </li>
                ))}
              </ul>
              {!q.has_rationales && (
                <div className="text-zinc-600 text-xs mt-2">
                  No rationales — you'll see the right answer but not why the others are wrong.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
