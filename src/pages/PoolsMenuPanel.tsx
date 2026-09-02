import { useEffect, useState } from "react";

// Single-user personal tracking, same pattern as everywhere else on the
// site that doesn't need a Supabase round trip for one person's own
// checkbox state (see conventions: localStorage for single-user
// persistence).
const CHECKLIST_STORAGE_KEY = "pools-weekly-checklist";

function loadChecklist(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChecklist(next: Record<string, boolean>) {
  try {
    localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing / storage disabled — the checklist just won't
    // persist across reloads, not worth surfacing an error for.
  }
}

interface PoolDef {
  key: string;
  label: string;
  description: string;
  comingSoon?: boolean;
}

// Chris's own priority ordering — see chat where this was requested.
// Every existing pool tile is accounted for in exactly one bucket.
const SECTIONS: { title: string; pools: PoolDef[] }[] = [
  {
    title: "High Priority",
    pools: [
      { key: "cbssplash", label: "CBS/Kelly", description: "ATS pool vs a custom line, all FBS vs FBS games." },
      { key: "survivor", label: "Survivor", description: "Personal survivor pool planner — spread/moneyline projections, save a path." },
      {
        key: "splashsurvivor",
        label: "Splash Survivor",
        description: "Separate survivor planner — every FBS team eligible, only Group of 6 vs Group of 6 excluded.",
      },
      { key: "peay", label: "Peay Pool", description: "ATS pool vs a custom line, all FBS vs FBS games." },
    ],
  },
  {
    title: "Medium Priority",
    pools: [
      { key: "cfbdpickem", label: "CFBD Pick'em", description: "Fill in predicted margins for CFBD's own prediction contest CSV." },
      { key: "brit", label: "The Brit", description: "Weekly $10 pick'em with a local pub." },
      { key: "westgate", label: "Westgate Supercontest", description: "ATS pool vs a custom line, all FBS vs FBS games." },
    ],
  },
  {
    title: "Low Priority",
    pools: [
      { key: "espnconfidence", label: "ESPN Confidence", description: "Confidence pick'em pool." },
      { key: "redditconfidence", label: "Reddit Confidence", description: "Confidence pool — export picks as a comma-separated team list." },
      { key: "espnml", label: "ESPN Moneyline", description: "Straight-up moneyline pool." },
      { key: "espnspread", label: "ESPN Spreads", description: "Against-the-spread pool." },
      { key: "cbspickem", label: "CBS Pickem", description: "Pick against CBS's spread for each game." },
    ],
  },
  {
    title: "Other",
    pools: [
      {
        key: "nfldraftpool",
        label: "NFL Win Total Draft",
        description: "Projected NFL win totals by power-rating system, plus a live draft tool for Kal/Presley/Ethan/YC.",
      },
      { key: "poolhistory", label: "Pool History", description: "Spread-vs-Vegas record by season, plus a top-N-picks-per-week contest backtest." },
    ],
  },
];

function PoolTile({
  poolKey,
  label,
  description,
  comingSoon,
  checked,
  onToggleChecked,
  onClick,
}: {
  poolKey: string;
  label: string;
  description: string;
  comingSoon?: boolean;
  checked: boolean;
  onToggleChecked: (poolKey: string) => void;
  onClick: () => void;
}) {
  return (
    // A plain div (not a button) — a real checkbox needs to sit inside
    // this tile, and interactive controls can't legally nest inside a
    // <button>. Click-to-navigate behavior is unchanged; the checkbox
    // stops its own click from bubbling up to it.
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "1rem 1.1rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
        cursor: "pointer",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
          {comingSoon && (
            <span
              style={{
                fontSize: "0.68rem",
                padding: "0.15rem 0.5rem",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                color: "var(--chalk-dim)",
              }}
            >
              Coming soon
            </span>
          )}
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleChecked(poolKey)}
            onClick={(e) => e.stopPropagation()}
            title="Done this week"
            style={{ cursor: "pointer" }}
          />
        </div>
      </div>
      <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>{description}</span>
    </div>
  );
}

export default function PoolsMenuPanel({
  onBack,
  onSelectPool,
}: {
  onBack: () => void;
  onSelectPool: (pool: string) => void;
}) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setChecklist(loadChecklist());
  }, []);

  function toggleChecked(poolKey: string) {
    setChecklist((prev) => {
      const next = { ...prev, [poolKey]: !prev[poolKey] };
      saveChecklist(next);
      return next;
    });
  }

  function handleWeekReset() {
    if (!confirm("Uncheck every pool for a new week?")) return;
    setChecklist({});
    saveChecklist({});
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Pools</h2>
        <button className="menu-btn" onClick={handleWeekReset}>
          Reset for new week
        </button>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Each pool you're entered in, as its own tool.
      </p>

      {SECTIONS.map((section) => (
        <div key={section.title} style={{ marginTop: "1.5rem" }}>
          <div className="section-label">{section.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {section.pools.map((pool) => (
              <PoolTile
                key={pool.key}
                poolKey={pool.key}
                label={pool.label}
                description={pool.description}
                comingSoon={pool.comingSoon}
                checked={!!checklist[pool.key]}
                onToggleChecked={toggleChecked}
                onClick={() => onSelectPool(pool.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
