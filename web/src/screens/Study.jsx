import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, accuracyColor } from "../api";

// The main study screen: the weak-topic heatmap.
// Open the app → instantly see what to study → tap a cell to drill it.
const CELL_STYLES = {
  green: "bg-emerald-600/80 border-emerald-500",
  amber: "bg-amber-600/80 border-amber-500",
  red: "bg-red-600/80 border-red-500",
  grey: "bg-zinc-800 border-zinc-700",
};

export default function Study() {
  const [heatmap, setHeatmap] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/study/heatmap").then(setHeatmap).catch(console.error);
  }, []);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-semibold">Study</h1>
        <div className="flex gap-2 text-sm">
          <Link to="/study/courses" className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300">
            Courses
          </Link>
          <Link to="/study/ingest" className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300">
            Ingest
          </Link>
        </div>
      </div>

      <Link
        to="/study/practice"
        className="block text-center bg-emerald-600 active:bg-emerald-500 rounded-xl py-3 font-medium"
      >
        Practice
      </Link>

      {heatmap && heatmap.length === 0 && (
        <p className="text-zinc-500 text-sm text-center pt-8">
          No units yet. Add a course, then ingest a lecture PDF.
        </p>
      )}

      {heatmap?.map((course) => (
        <div key={course.course_id}>
          <div className="text-zinc-400 text-xs uppercase tracking-wide mb-2">
            {course.course_code || course.course_name}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {course.units.map((u) => {
              const color = accuracyColor(u.accuracy, u.question_count > 0);
              return (
                <button
                  key={u.unit_id}
                  onClick={() =>
                    navigate(
                      `/study/practice?course_id=${course.course_id}&unit_id=${u.unit_id}`
                    )
                  }
                  className={`text-left border rounded-xl p-3 ${CELL_STYLES[color]}`}
                >
                  <div className="text-sm font-medium truncate">{u.unit_name}</div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-lg font-bold">
                      {u.accuracy != null ? `${u.accuracy}%` : "—"}
                    </span>
                    <span className="text-xs opacity-80">
                      {u.due_count > 0 ? `${u.due_count} due` : `${u.question_count} q`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
