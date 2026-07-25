import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import DotGrid from "../components/DotGrid";

/**
 * Daily non-negotiables (spec 4.8). Giant tap targets, no confirmation dialogs,
 * no streaks, no guilt copy. The only number is the trailing-30-day rate.
 */
export default function Daily() {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(
    () => api.get("/nn").then(setData).catch((e) => setError(e.message)),
    []
  );
  useEffect(() => { load(); }, [load]);

  async function toggle(item) {
    // Optimistic: the tap must feel instant, and it is trivially reversible.
    setData((d) => ({
      ...d,
      items: d.items.map((i) =>
        i.id === item.id
          ? {
              ...i,
              dates: i.dates.includes(d.date)
                ? i.dates.filter((x) => x !== d.date)
                : [d.date, ...i.dates],
            }
          : i
      ),
    }));
    await api.post(`/nn/items/${item.id}/toggle`).catch(() => load());
  }

  async function addItem() {
    if (!adding.trim()) return;
    setError(null);
    try {
      await api.post("/nn/items", { title: adding });
      setAdding("");
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!data) return <div className="p-4" />;

  const rate30 = (dates) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    const key = cutoff.toISOString().slice(0, 10);
    return Math.round((dates.filter((d) => d >= key).length / 30) * 100);
  };

  // A permanently-red row is worse than no row: below 50% for three straight
  // weeks, ask once to fix the item or delete it.
  const needsReview = (dates) => {
    const weeks = [0, 1, 2].map((w) => {
      const end = new Date(); end.setDate(end.getDate() - w * 7);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      const a = start.toISOString().slice(0, 10), b = end.toISOString().slice(0, 10);
      return dates.filter((d) => d >= a && d <= b).length / 7;
    });
    return weeks.every((r) => r < 0.5);
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-3">
      <h1 className="text-xl font-semibold pt-2">Today</h1>

      {data.items.map((item) => {
        const done = item.dates.includes(data.date);
        const rate = rate30(item.dates);
        return (
          <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <button
              onClick={() => toggle(item)}
              className={`w-full text-left px-4 py-5 flex items-center gap-3 active:opacity-80 ${
                done ? "bg-emerald-600/20" : ""
              }`}
            >
              <span
                className={`w-7 h-7 rounded-lg border-2 flex-none flex items-center justify-center ${
                  done ? "bg-emerald-500 border-emerald-500" : "border-zinc-600"
                }`}
              >
                {done && (
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-zinc-950" fill="none"
                       stroke="currentColor" strokeWidth="3.5">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span className={`text-lg ${done ? "text-zinc-100" : "text-zinc-300"}`}>
                {item.title}
              </span>
              <span className="ml-auto text-zinc-500 text-sm tabular-nums">{rate}%</span>
            </button>

            <div className="px-4 pb-3">
              <DotGrid dates={item.dates} />
              {needsReview(item.dates) && (
                <div className="mt-3 text-xs text-zinc-400 flex items-center gap-2 flex-wrap">
                  <span>Under 50% for three weeks. Fix the item or drop it.</span>
                  <button
                    onClick={async () => {
                      await api.del(`/nn/items/${item.id}`);
                      load();
                    }}
                    className="text-red-400 underline underline-offset-2"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {data.items.length < data.max_items && (
        <div className="flex gap-2 pt-1">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="Add a non-negotiable"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none"
          />
          <button onClick={addItem} className="px-4 bg-zinc-800 rounded-xl text-sm">Add</button>
        </div>
      )}
      {data.items.length >= data.max_items && (
        <p className="text-zinc-600 text-xs text-center">
          {data.max_items} is the cap. The short list is the feature.
        </p>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
