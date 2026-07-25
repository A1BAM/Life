import { NavLink } from "react-router-dom";

// One icon per live module. No hamburger; Settings sits on the Today header.
const icon = (d) => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const tabs = [
  {
    to: "/", label: "Today",
    icon: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>),
  },
  {
    to: "/daily", label: "Daily",
    icon: icon(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>),
  },
  {
    to: "/study", label: "Study",
    icon: icon(<><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z" /><path d="M12 6v14" /></>),
  },
  {
    to: "/training", label: "Train",
    icon: icon(<><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" /></>),
  },
  {
    to: "/reset", label: "Reset",
    icon: icon(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>),
  },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-zinc-900 border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around max-w-md mx-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 px-3 text-[10px] ${
                isActive ? "text-emerald-400" : "text-zinc-500"
              }`
            }
          >
            {t.icon}
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
