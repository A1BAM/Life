import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import DotGrid from "../components/DotGrid";

/**
 * Relapse tracker (spec 4.5).
 *
 * Deliberately absent: any red state, any "you failed", any lost-progress
 * animation, any required explanation, any reflection prompt. A reset is one
 * tap and two optional fields. The trend in the gap between resets is shown
 * next to the counter, because that is the metric that actually moves.
 */

const DEFAULT_TAGS = [
  "alone at night",
  "bored",
  "after a bad exam",
  "scrolling",
  "can't sleep",
];

export default function Reset() {
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [view, setView] = useState("home"); // home | tags | urge | rebound | plans
  const [urge, setUrge] = useState(null);

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([api.get("/reset"), api.get("/reset/plans")]);
    setData(d);
    setPlans(p);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function logUrge(tag) {
    const r = await api.post("/reset/urge", { context_tag: tag });
    setUrge(r);
    setView("urge");
    load();
  }

  async function logReset(tag) {
    await api.post("/reset/log", { context_tag: tag || null });
    await load();
    setView("rebound");
  }

  if (!data) return <div className="p-4" />;

  if (view === "tags")
    return <TagPicker onPick={logUrge} onCancel={() => setView("home")} title="What's going on?" />;

  if (view === "urge") return <UrgeScreen urge={urge} onDone={() => setView("home")} />;

  if (view === "rebound")
    return <Rebound plans={plans} onDone={() => setView("home")} />;

  if (view === "plans")
    return <Plans plans={plans} reload={load} onBack={() => setView("home")} />;

  const t = data.trend;
  const improving = t.recent_avg != null && t.earlier_avg != null && t.recent_avg > t.earlier_avg;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-semibold">Reset</h1>
        <button onClick={() => setView("plans")} className="text-zinc-400 text-sm">
          If-then plans
        </button>
      </div>

      {/* counter: current, best, and the trend that matters more than both */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-5xl font-bold text-emerald-400 tabular-nums">
              {data.days_clean ?? "—"}
            </div>
            <div className="text-zinc-400 text-xs mt-1">days</div>
          </div>
          <div className="pb-1">
            <div className="text-2xl font-semibold text-zinc-300 tabular-nums">
              {data.best_ever ?? "—"}
            </div>
            <div className="text-zinc-500 text-xs">best</div>
          </div>
          {t.recent_avg != null && (
            <div className="pb-1 ml-auto text-right">
              <div className={`text-2xl font-semibold tabular-nums ${improving ? "text-emerald-400" : "text-zinc-300"}`}>
                {t.recent_avg}d
              </div>
              <div className="text-zinc-500 text-xs">
                avg gap{t.earlier_avg != null ? ` · was ${t.earlier_avg}d` : ""}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <DotGrid dates={data.reset_dates} invert />
          <div className="text-zinc-600 text-[11px] mt-2">last 90 days · filled = clean</div>
        </div>

        {t.gaps.length > 1 && (
          <div className="mt-3 flex items-end gap-1 h-10">
            {t.gaps.slice(-12).map((g, i) => (
              <div
                key={i}
                className="flex-1 bg-emerald-500/60 rounded-t"
                style={{ height: `${Math.max(8, (g / Math.max(...t.gaps)) * 100)}%` }}
                title={`${g} days`}
              />
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => setView("tags")}
        className="w-full bg-sky-600 active:bg-sky-500 rounded-2xl py-5 text-lg font-medium"
      >
        Urge
      </button>

      <div className="flex items-center justify-between text-sm text-zinc-400 px-1">
        <span>{data.urges_30d} urges logged · 30 days</span>
        {data.top_tag_30d && <span className="text-zinc-500">most: {data.top_tag_30d}</span>}
      </div>

      <Patterns />

      <button
        onClick={() => logReset(null)}
        className="w-full text-zinc-500 text-sm py-3 underline underline-offset-4"
      >
        Log a reset
      </button>
    </div>
  );
}

function TagPicker({ onPick, onCancel, title }) {
  return (
    <div className="max-w-md mx-auto p-4 space-y-3">
      <h1 className="text-lg font-medium pt-2">{title}</h1>
      {DEFAULT_TAGS.map((tag) => (
        <button
          key={tag}
          onClick={() => onPick(tag)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-5 text-lg active:bg-zinc-800"
        >
          {tag}
        </button>
      ))}
      <button onClick={onCancel} className="w-full text-zinc-500 text-sm py-3">
        Cancel
      </button>
    </div>
  );
}

/** In the moment: the plan you already wrote, and a timer. Nothing else. */
function UrgeScreen({ urge, onDone }) {
  const [left, setLeft] = useState(600);
  const ref = useRef();
  useEffect(() => {
    ref.current = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(ref.current);
  }, []);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="max-w-md mx-auto p-4 pt-10 space-y-6 text-center">
      <div className="text-6xl font-bold tabular-nums text-sky-400">{mm}:{ss}</div>
      {urge?.plan ? (
        <p className="text-xl leading-relaxed text-zinc-100 px-2">{urge.plan}</p>
      ) : (
        <p className="text-zinc-500">
          No plan written for “{urge?.context_tag}” yet. Write one later, not now.
        </p>
      )}
      <button
        onClick={onDone}
        className="w-full bg-zinc-800 active:bg-zinc-700 rounded-2xl py-4 text-lg mt-6"
      >
        Done
      </button>
    </div>
  );
}

/** After a reset: what happens in the next 48 hours. Nothing about what just happened. */
function Rebound({ plans, onDone }) {
  return (
    <div className="max-w-md mx-auto p-4 pt-10 space-y-5">
      <h1 className="text-xl font-medium">Next 48 hours</h1>
      {plans.length === 0 ? (
        <p className="text-zinc-400">
          No if-then plans written yet. Add one when you have a quiet minute.
        </p>
      ) : (
        plans.map((p) => (
          <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-zinc-500 text-xs mb-1">If {p.trigger_tag}</div>
            <div className="text-zinc-100 leading-relaxed">{p.action_text}</div>
          </div>
        ))
      )}
      <button onClick={onDone} className="w-full bg-emerald-600 rounded-2xl py-4 text-lg">
        Got it
      </button>
    </div>
  );
}

function Plans({ plans, reload, onBack }) {
  const [tag, setTag] = useState(DEFAULT_TAGS[0]);
  const [text, setText] = useState("");

  async function save() {
    if (!text.trim()) return;
    await api.put("/reset/plans", { trigger_tag: tag, action_text: text });
    setText("");
    reload();
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-3">
      <button onClick={onBack} className="text-zinc-400 text-sm pt-2">← Reset</button>
      <p className="text-zinc-500 text-sm">
        Write these now, while it's quiet. In the moment the app only shows you the one you wrote.
      </p>

      {plans.map((p) => (
        <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-zinc-500 text-xs mb-1">If {p.trigger_tag}</div>
          <div className="text-zinc-200 text-sm">{p.action_text}</div>
          <button
            onClick={async () => { await api.del(`/reset/plans/${p.id}`); reload(); }}
            className="text-zinc-600 text-xs mt-2"
          >
            Remove
          </button>
        </div>
      ))}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none"
        >
          {DEFAULT_TAGS.map((t) => <option key={t} value={t}>If {t}…</option>)}
        </select>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="then I…"
          className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none"
        />
        <button onClick={save} className="w-full bg-emerald-600 rounded-lg py-2.5 text-sm font-medium">
          Save plan
        </button>
      </div>
    </div>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The whole point of the module: make the pattern visible so the environment changes. */
function Patterns() {
  const [p, setP] = useState(null);
  useEffect(() => { api.get("/reset/patterns").then(setP).catch(() => {}); }, []);
  if (!p || !p.by_hour.length) return null;

  const buckets = [0, 6, 12, 18]; // night · morning · afternoon · evening
  const grid = DOW.map((_, dow) =>
    buckets.map((b) =>
      p.by_hour
        .filter((r) => r.dow === dow && r.hour >= b && r.hour < b + 6)
        .reduce((s, r) => s + r.n, 0)
    )
  );
  const max = Math.max(1, ...grid.flat());

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="text-zinc-400 text-xs uppercase tracking-wide mb-3">When urges hit</div>
      <div className="flex gap-1">
        <div className="flex flex-col gap-1 text-[10px] text-zinc-600 pt-4">
          {DOW.map((d) => <div key={d} className="h-6 flex items-center">{d}</div>)}
        </div>
        <div className="flex-1">
          <div className="flex gap-1 text-[10px] text-zinc-600 mb-1">
            {["12–6", "6–12", "12–6", "6–12"].map((l, i) => (
              <div key={i} className="flex-1 text-center">{l}</div>
            ))}
          </div>
          {grid.map((row, dow) => (
            <div key={dow} className="flex gap-1 mb-1">
              {row.map((n, i) => (
                <div
                  key={i}
                  className="flex-1 h-6 rounded"
                  style={{ backgroundColor: n ? `rgba(56,189,248,${0.15 + (n / max) * 0.85})` : "rgb(39,39,42)" }}
                  title={`${DOW[dow]} — ${n}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {p.by_tag.length > 0 && (
        <div className="mt-3 space-y-1">
          {p.by_tag.slice(0, 3).map((t) => (
            <div key={t.context_tag} className="flex justify-between text-xs">
              <span className="text-zinc-400">{t.context_tag}</span>
              <span className="text-zinc-500">{t.n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
