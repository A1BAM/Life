import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, STATUS_STYLES } from "../api";

export default function Today() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/today").then(setData).catch(console.error);
  }, []);

  if (!data) return <div className="p-4" />;

  const { next_exam, study } = data;
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* top strip: date · next event · exam countdown */}
      <div className="pt-2">
        <div className="text-zinc-400 text-sm">{dateLabel}</div>
        <div className="flex items-end justify-between mt-1">
          <div className="text-zinc-500 text-xs">
            {/* calendar module lands in Phase 1c; grey until then */}
            no calendar linked
          </div>
          {next_exam ? (
            <Link to="/study" className="text-right">
              <div
                className={`text-3xl font-bold ${
                  next_exam.days_left <= 3
                    ? "text-red-400"
                    : next_exam.days_left <= 7
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              >
                {next_exam.days_left}d
              </div>
              <div className="text-zinc-400 text-xs">
                {next_exam.course_code || next_exam.course_name} · {next_exam.name}
              </div>
            </Link>
          ) : (
            <div className="text-zinc-600 text-xs">no exams scheduled</div>
          )}
        </div>
      </div>

      {/* module cards: status color, one number, one action */}
      <ModuleCard
        to="/study/practice"
        title="Study"
        status={study.status}
        number={study.due_reviews > 0 ? study.due_reviews : study.answered_today}
        numberLabel={study.due_reviews > 0 ? "due" : "answered today"}
        action={study.total_questions > 0 ? "Practice" : null}
        emptyHint={study.total_questions === 0 ? "no questions yet — ingest a lecture" : null}
        sub={study.accuracy_7d != null ? `${study.accuracy_7d}% this week` : null}
      />

      {/* future modules appear here as they ship */}
      <div className="grid grid-cols-2 gap-3 opacity-40">
        {["Training", "Calendar", "Reset", "Daily"].map((m) => (
          <div key={m} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_STYLES.grey}`} />
              <span className="text-zinc-400 text-sm">{m}</span>
            </div>
            <div className="text-zinc-600 text-xs mt-2">soon</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModuleCard({ to, title, status, number, numberLabel, action, emptyHint, sub }) {
  return (
    <Link
      to={to}
      className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-4 active:bg-zinc-800"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${STATUS_STYLES[status]}`} />
          <span className="font-medium">{title}</span>
        </div>
        {action && (
          <span className="text-emerald-400 text-sm font-medium">{action} →</span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {emptyHint ? (
          <span className="text-zinc-500 text-sm">{emptyHint}</span>
        ) : (
          <>
            <span className="text-4xl font-bold">{number}</span>
            <span className="text-zinc-400 text-sm">{numberLabel}</span>
            {sub && <span className="text-zinc-500 text-xs ml-auto">{sub}</span>}
          </>
        )}
      </div>
    </Link>
  );
}
