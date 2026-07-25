import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Courses() {
  const [courses, setCourses] = useState([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.get("/study/courses").then(setCourses).catch(console.error);
  }, []);
  useEffect(load, [load]);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <Link to="/study" className="text-zinc-400 text-sm">← Study</Link>
        <button onClick={() => setAdding(true)} className="text-emerald-400 text-sm font-medium">
          + Course
        </button>
      </div>

      {adding && <CourseForm onDone={() => { setAdding(false); load(); }} />}

      {courses.map((c) => (
        <CourseCard key={c.id} course={c} reload={load} />
      ))}
      {courses.length === 0 && !adding && (
        <p className="text-zinc-500 text-sm text-center pt-8">No courses yet.</p>
      )}
    </div>
  );
}

function CourseForm({ onDone }) {
  const [form, setForm] = useState({ name: "", code: "", grade_min: 80 });
  async function save() {
    if (!form.name) return;
    await api.post("/study/courses", form);
    onDone();
  }
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
      <input
        placeholder="Course name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
      />
      <div className="flex gap-2">
        <input
          placeholder="Code (NURS 412)"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
        />
        <input
          type="number"
          placeholder="Min %"
          value={form.grade_min}
          onChange={(e) => setForm({ ...form, grade_min: Number(e.target.value) })}
          className="w-24 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
        />
      </div>
      <button onClick={save} className="w-full bg-emerald-600 rounded-lg py-2 text-sm font-medium">
        Save
      </button>
    </div>
  );
}

function CourseCard({ course, reload }) {
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState(null);
  const [examForm, setExamForm] = useState(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !scenarios) {
      setScenarios(await api.get(`/study/courses/${course.id}/grade-scenarios`));
    }
  }

  async function saveExam() {
    await api.post(`/study/courses/${course.id}/exams`, examForm);
    setExamForm(null);
    setScenarios(null);
    reload();
  }

  async function setScore(exam, score) {
    await api.patch(`/study/exams/${exam.id}`, { score: score === "" ? null : Number(score) });
    setScenarios(await api.get(`/study/courses/${course.id}/grade-scenarios`));
    reload();
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <button onClick={toggle} className="w-full text-left">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{course.name}</div>
            <div className="text-zinc-500 text-xs">{course.code}</div>
          </div>
          {scenarios?.current != null && (
            <div
              className={`text-2xl font-bold ${
                scenarios.current >= course.grade_min ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {scenarios.current}%
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* exams */}
          <div className="space-y-1.5">
            {course.exams.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-zinc-300">{e.name}</span>
                <span className="text-zinc-500 text-xs">{e.exam_date || "—"}</span>
                <span className="text-zinc-500 text-xs w-10 text-right">{e.weight}%</span>
                <input
                  type="number"
                  defaultValue={e.score ?? ""}
                  placeholder="—"
                  onBlur={(ev) => ev.target.value !== String(e.score ?? "") && setScore(e, ev.target.value)}
                  className="w-14 bg-zinc-800 rounded px-2 py-1 text-right text-sm outline-none"
                />
              </div>
            ))}
          </div>

          {/* grade scenarios: "what do I need" as a table, not a paragraph */}
          {scenarios && scenarios.remaining_weight > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs">
                  <th className="text-left font-normal py-1">to finish with</th>
                  <th className="text-right font-normal">need on remaining</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.scenarios.map((s) => (
                  <tr key={s.target} className="border-t border-zinc-800">
                    <td className="py-1.5 text-zinc-300">{s.target}%</td>
                    <td
                      className={`text-right font-semibold ${
                        !s.feasible
                          ? "text-red-400"
                          : s.needed >= 90
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {s.needed == null ? "done" : s.feasible ? `${s.needed}%` : "not possible"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {examForm ? (
            <div className="space-y-2">
              <input
                placeholder="Exam name"
                value={examForm.name}
                onChange={(e) => setExamForm({ ...examForm, name: e.target.value })}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={examForm.exam_date}
                  onChange={(e) => setExamForm({ ...examForm, exam_date: e.target.value })}
                  className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
                />
                <input
                  type="number"
                  placeholder="Weight %"
                  value={examForm.weight}
                  onChange={(e) => setExamForm({ ...examForm, weight: Number(e.target.value) })}
                  className="w-24 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <button onClick={saveExam} className="w-full bg-emerald-600 rounded-lg py-2 text-sm font-medium">
                Add exam
              </button>
            </div>
          ) : (
            <button
              onClick={() => setExamForm({ name: "", exam_date: "", weight: 0 })}
              className="text-emerald-400 text-sm"
            >
              + exam
            </button>
          )}
        </div>
      )}
    </div>
  );
}
