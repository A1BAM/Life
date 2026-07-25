import { useCallback, useEffect, useRef, useState } from "react";
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
  const running = useRef(false); // one generation loop at a time

  const refreshJobs = useCallback(
    () => api.get("/study/ingest/jobs").then(setJobs).catch(() => {}),
    []
  );

  useEffect(() => {
    api.get("/study/courses").then((cs) => {
      setCourses(cs);
      if (cs.length === 1) setCourseId(String(cs[0].id));
    });
    refreshJobs();
  }, [refreshJobs]);

  /**
   * Generation is driven from here, one chunk per request. There is no server
   * queue or cron (both cost money or keep the database awake), so this loop is
   * what makes progress — and it picks up wherever a previous session stopped.
   */
  const drive = useCallback(
    async (jobId = null) => {
      if (running.current) return;
      running.current = true;
      try {
        for (;;) {
          const r = await api.post("/study/ingest/step", { job_id: jobId });
          if (r.done) break;
          if (r.job) {
            setPhase({
              label: `Generating ${r.job.done_chunks}/${r.job.total_chunks}`,
              pct: Math.round((r.job.done_chunks / Math.max(r.job.total_chunks, 1)) * 100),
            });
          }
          await refreshJobs();
        }
      } catch (err) {
        setError(err.message);
      } finally {
        running.current = false;
        setPhase(null);
        refreshJobs();
      }
    },
    [refreshJobs]
  );

  // Resume anything left unfinished — a closed tab, a dead connection, a phone
  // that locked mid-upload.
  useEffect(() => {
    api
      .get("/study/ingest/pending")
      .then((pending) => {
        if (pending.length) drive(pending[0].job_id);
      })
      .catch(() => {});
  }, [drive]);

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

      setPhase({ label: "Uploading text", pct: 100 });
      const { job_id } = await api.post("/study/ingest", {
        course_id: Number(courseId),
        unit_name: unitName,
        filename: file.name,
        chunks,
      });

      setUnitName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await drive(job_id);
    } catch (err) {
      setError(err.message);
      setPhase(null);
    }
  }

  const busy = Boolean(phase) || running.current;

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
          disabled={busy || !courseId || !unitName || !file}
          className="w-full bg-emerald-600 disabled:opacity-40 rounded-xl py-3 font-medium"
        >
          Generate questions
        </button>
        <p className="text-zinc-600 text-xs">
          The PDF is read on this device; only the text is uploaded. Keep this page
          open while it generates — if you leave, it picks up where it stopped next
          time you open it.
        </p>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onResume={() => drive(j.id)} busy={busy} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onResume, busy }) {
  const stalled = job.status === "running" && !busy;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 truncate mr-2">
          {job.unit_name} · {job.filename}
        </span>
        {job.status === "done" ? (
          <span className="text-emerald-400 text-xs">{job.questions_created} questions</span>
        ) : job.status === "error" ? (
          <span className="text-red-400 text-xs">failed</span>
        ) : (
          <span className="text-amber-400 text-xs">
            {job.done_chunks}/{job.total_chunks}
          </span>
        )}
      </div>
      {job.status === "running" && (
        <div className="mt-2 h-1.5 bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${(job.done_chunks / Math.max(job.total_chunks, 1)) * 100}%` }}
          />
        </div>
      )}
      {stalled && (
        <button onClick={onResume} className="text-emerald-400 text-xs mt-2">
          Resume →
        </button>
      )}
      {job.error && <div className="text-amber-400 text-xs mt-1">{job.error}</div>}
    </div>
  );
}
