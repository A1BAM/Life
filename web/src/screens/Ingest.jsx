import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Ingest() {
  const [courses, setCourses] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get("/study/courses").then((cs) => {
      setCourses(cs);
      if (cs.length === 1) setCourseId(String(cs[0].id));
    });
  }, []);

  // poll jobs while any is running
  useEffect(() => {
    let timer;
    const poll = async () => {
      const j = await api.get("/study/ingest/jobs").catch(() => []);
      setJobs(j);
      if (j.some((x) => x.status === "running" || x.status === "queued")) {
        timer = setTimeout(poll, 2500);
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, [busy]);

  async function submit() {
    if (!courseId || !unitName || !file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("course_id", courseId);
      fd.append("unit_name", unitName);
      fd.append("file", file);
      await api.post("/study/ingest", fd);
      setUnitName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="font-medium">Lecture → question bank</div>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none"
        >
          <option value="">Course…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code || c.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Unit (e.g. Endocrine)"
          value={unitName}
          onChange={(e) => setUnitName(e.target.value)}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none"
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full text-sm text-zinc-400 file:bg-zinc-800 file:border-0 file:rounded-lg file:px-3 file:py-2 file:text-zinc-300 file:mr-3"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || !courseId || !unitName || !file}
          className="w-full bg-emerald-600 disabled:opacity-40 rounded-xl py-3 font-medium"
        >
          {busy ? "Uploading…" : "Generate questions"}
        </button>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <div key={j.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 truncate mr-2">
                  {j.unit_name} · {j.filename}
                </span>
                <StatusChip job={j} />
              </div>
              {j.status === "running" && (
                <div className="mt-2 h-1.5 bg-zinc-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${(j.done_chunks / Math.max(j.total_chunks, 1)) * 100}%` }}
                  />
                </div>
              )}
              {j.status === "error" && j.error && (
                <div className="text-red-400 text-xs mt-1">{j.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusChip({ job }) {
  if (job.status === "done")
    return <span className="text-emerald-400 text-xs">{job.questions_created} questions</span>;
  if (job.status === "error") return <span className="text-red-400 text-xs">failed</span>;
  return (
    <span className="text-amber-400 text-xs">
      {job.done_chunks}/{job.total_chunks}
    </span>
  );
}
