/**
 * 90-day dot grid — shared by non-negotiables, the relapse tracker, and later
 * grooming (spec §6 calls this out as a repeated shape).
 *
 * `dates` is the set of days something happened. `invert` flips the meaning so
 * the relapse module can pass reset days and still render clean days as filled.
 */
export default function DotGrid({ dates, days = 90, invert = false, tone = "emerald" }) {
  const set = dates instanceof Set ? dates : new Set(dates || []);
  const today = new Date();

  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    const hit = set.has(key);
    return { key, on: invert ? !hit : hit, marked: hit };
  });

  const on = tone === "emerald" ? "bg-emerald-500" : "bg-sky-500";

  return (
    <div className="grid grid-flow-col grid-rows-7 gap-[3px] justify-start">
      {cells.map((c) => (
        <div
          key={c.key}
          title={c.key}
          className={`w-2.5 h-2.5 rounded-[2px] ${
            c.on ? on : invert && c.marked ? "bg-zinc-600" : "bg-zinc-800"
          }`}
        />
      ))}
    </div>
  );
}
