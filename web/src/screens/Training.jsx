import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/**
 * Training (spec 4.2). This module is about showing up, not programming —
 * LiftLogic owns the lifting. The streak counts WEEKS that hit target, never
 * days, because daily streaks punish rest days and clinical shifts.
 */
export default function Training() {
  const [week, setWeek] = useState(null);
  const [streak, setStreak] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [w, s] = await Promise.all([api.get("/training/week"), api.get("/training/streak")]);
    setWeek(w);
    setStreak(s);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function trainedToday(type) {
    setSaving(true);
    await api.post("/training/manual", { type }).catch(() => {});
    await load();
    setSaving(false);
  }

  async function setTarget(n) {
    await api.put("/training/target", { target_sessions: n });
    load();
  }

  if (!week) return <div className="p-4" />;

  const today = new Date().toISOString().slice(0, 10);
  const doneToday = week.sessions.some((s) => s.date === today);
  const slots = Array.from({ length: week.target_sessions }, (_, i) => week.sessions[i] || null);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-semibold">Training</h1>
        {streak && (
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-400 tabular-nums">
              {streak.streak_weeks}
            </div>
            <div className="text-zinc-500 text-[11px]">weeks on target</div>
          </div>
        )}
      </div>

      {/* planned vs actual: the week as N slots, filled as sessions land */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-zinc-400 text-sm">This week</span>
          <span className="text-zinc-300 text-sm tabular-nums">
            {week.hit} / {week.target_sessions}
          </span>
        </div>
        <div className="flex gap-2">
          {slots.map((s, i) => (
            <div
              key={i}
              className={`flex-1 h-16 rounded-xl border flex flex-col items-center justify-center text-xs ${
                s
                  ? "bg-emerald-600/25 border-emerald-600 text-emerald-300"
                  : "bg-zinc-800/50 border-zinc-700 text-zinc-600"
              }`}
            >
              {s ? (
                <>
                  <span className="font-medium">{s.type || "done"}</span>
                  <span className="opacity-70">{s.date.slice(5)}</span>
                </>
              ) : (
                "—"
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
          <span>target</span>
          {[3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setTarget(n)}
              className={`px-2 py-1 rounded ${
                n === week.target_sessions ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* LiftLogic is the source of truth when it's wired; otherwise one tap */}
      {week.source === "liftlogic" ? (
        <p className="text-zinc-500 text-xs text-center">
          Sessions read live from LiftLogic — nothing to log here.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            {["push", "pull"].map((t) => (
              <button
                key={t}
                onClick={() => trainedToday(t)}
                disabled={saving}
                className="flex-1 bg-emerald-600 active:bg-emerald-500 disabled:opacity-40 rounded-2xl py-5 text-lg font-medium capitalize"
              >
                {t}
              </button>
            ))}
          </div>
          {doneToday && <p className="text-emerald-400 text-xs text-center">Logged for today.</p>}
          <p className="text-zinc-600 text-xs text-center">
            LiftLogic isn't wired up yet, so sessions are logged here.
            {week.liftlogic_error ? ` (${week.liftlogic_error})` : ""}
          </p>
        </div>
      )}

      {/* 12-week consistency, weeks not days */}
      {streak && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-zinc-400 text-xs uppercase tracking-wide mb-3">Last 12 weeks</div>
          <div className="flex items-end gap-1 h-16">
            {streak.weeks.map((w) => {
              const hit = Number(w.sessions) >= Number(w.target);
              const pct = Math.min(100, (Number(w.sessions) / Math.max(Number(w.target), 1)) * 100);
              return (
                <div key={w.week_start} className="flex-1 flex flex-col justify-end h-full">
                  <div
                    className={`rounded-t ${hit ? "bg-emerald-500" : "bg-zinc-700"}`}
                    style={{ height: `${Math.max(6, pct)}%` }}
                    title={`${w.week_start}: ${w.sessions}/${w.target}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
