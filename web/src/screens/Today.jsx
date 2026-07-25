import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, STATUS_STYLES } from "../api";

export default function Today() {
  const [data, setData] = useState(null);

  useEffect(() => { api.get("/today").then(setData).catch(console.error); }, []);
  if (!data) return <div className="p-4" />;

  const { next_exam, study, daily, reset, training } = data;
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });

  return (
    <div className="max-w-md mx-auto p-4 space-y-3">
      {/* top strip: date · next event · exam countdown */}
      <div className="pt-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-zinc-400 text-sm">{dateLabel}</div>
            <div className="text-zinc-600 text-xs mt-0.5">no calendar linked</div>
          </div>
          <div className="flex items-start gap-3">
            {next_exam ? (
              <Link to="/study" className="text-right">
                <div
                  className={`text-3xl font-bold ${
                    next_exam.days_left <= 3 ? "text-red-400"
                    : next_exam.days_left <= 7 ? "text-amber-400"
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
              <div className="text-zinc-600 text-xs pt-2">no exams scheduled</div>
            )}
            <Link to="/settings" className="text-zinc-600 pt-1" aria-label="Settings">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33 1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* one card per module: status colour, one number, one tappable action */}
      <Card
        to="/daily" title="Daily" status={daily.status}
        number={daily.total ? `${daily.done}/${daily.total}` : null}
        label="done today"
        action={daily.total && daily.done < daily.total ? "Check off" : null}
        empty={daily.total === 0 ? "no items yet — add up to 5" : null}
      />

      <Card
        to="/study/practice" title="Study" status={study.status}
        number={study.total_questions ? (study.due_reviews || study.answered_today) : null}
        label={study.due_reviews > 0 ? "due" : "answered today"}
        action={study.total_questions > 0 ? "Practice" : null}
        empty={study.total_questions === 0 ? "no questions yet — add some" : null}
        sub={study.accuracy_7d != null ? `${study.accuracy_7d}% this week` : null}
      />

      <Card
        to="/training" title="Training" status={training.status}
        number={`${training.sessions}/${training.target}`}
        label="this week"
        action={training.sessions < training.target ? "Log" : null}
      />

      <Card
        to="/reset" title="Reset" status={reset.status}
        number={reset.days_clean ?? null}
        label="days"
        action="Urge"
        empty={reset.days_clean == null ? "nothing logged yet" : null}
        sub={reset.urges_7d ? `${reset.urges_7d} urges this week` : null}
      />
    </div>
  );
}

function Card({ to, title, status, number, label, action, empty, sub }) {
  return (
    <Link to={to} className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-4 active:bg-zinc-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${STATUS_STYLES[status]}`} />
          <span className="font-medium">{title}</span>
        </div>
        {action && <span className="text-emerald-400 text-sm font-medium">{action} →</span>}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {empty ? (
          <span className="text-zinc-500 text-sm">{empty}</span>
        ) : (
          <>
            <span className="text-4xl font-bold tabular-nums">{number}</span>
            <span className="text-zinc-400 text-sm">{label}</span>
            {sub && <span className="text-zinc-500 text-xs ml-auto">{sub}</span>}
          </>
        )}
      </div>
    </Link>
  );
}
