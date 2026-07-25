import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Ingest() {
  const [courses, setCourses] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState(null); // {label, pct}
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get("/study/courses").then((cs) => {
      setCourses(cs);
      if (cs.length === 1) setCourseId(String(cs[0].id));
    });
  }, []);

  useEffect(() => {
    let timer;
    let alive = true;
    const poll = async () => {
      const j = await api.get("/study/ingest/jobs").catch(() => []);
      if (!alive) return;
      setJobs(j);
      if (j.some((x) => x.status === "running")) timer = setTimeout(poll, 3000);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase]);

  async function submit() {
    if (!courseId || !unitName || !file) return;
    setError(null);
    try {
      // pdf.js is ~1.3MB — loaded only when a PDF is actually ingested.
      const { extractText, chunkPages } = await import("../pdf");
      setPhase({ label: "Reading PDF", pct: 0 });
      const pages = await extractText(file, (done, total) =>
        setPhase({ label: "Reading PDF", pct: Math.round((done / total) * 100) })
      );
      const chunks = chunkPages(pages);
      if (!chunks.length) {
        setError("No text found — this looks like a scanned PDF.");
        setPhase(null);
        return;
      }

      setPhase({ label: `Queueing ${chunks.length} chunks`, pct: 100 });
      await api.post("/study/ingest", {
        course_id: Number(courseId),
        unit_name: unitName,
        filename: file.name,
        chunks,
      });

      setUnitName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setPhase(null);
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
            <option key={c.id} value={c.id}>{c.code || c.name}</option>
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
        {phase && (
          <div>
            <div className="text-zinc-400 text-xs mb-1">{phase.label}…</div>
            <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${phase.pct}%` }} />
            </div>
          </div>
        )}
        <button
          onClick={submit}
          disabled={Boolean(phase) || !courseId || !unitName || !file}
          className="w-full bg-emerald-600 disabled:opacity-40 rounded-xl py-3 font-medium"
        >
          Generate questions
        </button>
        <p className="text-zinc-600 text-xs">
          The PDF is read on this device; only the text is uploaded. Generation runs
          server-side — you can close this page.
        </p>
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
              {j.error && <div className="text-amber-400 text-xs mt-1">{j.error}</div>}
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
