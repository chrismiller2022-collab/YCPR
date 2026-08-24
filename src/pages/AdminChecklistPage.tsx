import { useEffect, useState } from "react";
import ChecklistItemsBlock from "../components/ChecklistItemsBlock";
import { fetchChecklistStateForWeeks, toggleChecklistItem } from "../lib/api/adminChecklist";
import {
  CHECKLIST_ITEMS,
  PRESEASON_CHECKLIST_ITEMS,
  PRESEASON_CHECKLIST_WEEK,
  leafKeysFor,
  type ChecklistItemDef,
} from "../lib/checklistItems";
import { WEEK_OPTIONS } from "../lib/weekOptions";

// Every regular season week ("week1".."week16") — the reserved
// "preseason" entry in WEEK_OPTIONS is the ratings/live-data snapshot
// week, a different thing from the one-time Preseason Checklist section
// below, so it's excluded from this list on purpose.
const CHECKLIST_WEEKS = WEEK_OPTIONS.filter((w) => w !== "preseason");

function weekLabel(w: string) {
  const m = /^week(\d+)$/.exec(w);
  return m ? `Week ${m[1]}` : w;
}

// A week (or the Preseason Checklist) counts as done when every leaf item
// — sub-items where they exist, the item itself otherwise — is checked.
// This checkbox is derived, not stored: toggling it manually would be
// ambiguous (bulk-check everything? just this box?), so it's disabled and
// exists purely as an at-a-glance completion indicator.
function isFullyDone(items: ChecklistItemDef[], checked: Record<string, boolean>): boolean {
  const keys = items.flatMap(leafKeysFor);
  return keys.length > 0 && keys.every((k) => checked[k]);
}

function CollapsibleChecklistSection({
  title,
  items,
  checked,
  onToggle,
  defaultOpen,
}: {
  title: string;
  items: ChecklistItemDef[];
  checked: Record<string, boolean>;
  onToggle: (key: string, next: boolean) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = isFullyDone(items, checked);

  return (
    <div
      style={{
        marginBottom: "0.9rem",
        padding: "0.9rem 1rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <input
          type="checkbox"
          checked={done}
          disabled
          title="Auto-checks once every item below is checked"
          style={{ cursor: "default" }}
        />
        <span style={{ fontWeight: 700, flex: 1, opacity: done ? 0.6 : 1, textDecoration: done ? "line-through" : "none" }}>
          {title}
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            background: "none",
            border: "none",
            color: "var(--chalk-dim)",
            cursor: "pointer",
            fontSize: "0.78rem",
            padding: 0,
          }}
        >
          {open ? "▲ hide" : "▼ show"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          <ChecklistItemsBlock items={items} isChecked={(k) => checked[k] ?? false} onToggle={onToggle} />
        </div>
      )}
    </div>
  );
}

export default function AdminChecklistPage({ onBack }: { onBack: () => void }) {
  const [checkedByWeek, setCheckedByWeek] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchChecklistStateForWeeks([...CHECKLIST_WEEKS, PRESEASON_CHECKLIST_WEEK])
      .then(setCheckedByWeek)
      .catch((err) => setError(err.message ?? "Failed to load checklist state"))
      .finally(() => setLoading(false));
  }, []);

  function toggle(week: string, key: string, next: boolean) {
    setCheckedByWeek((prev) => ({ ...prev, [week]: { ...prev[week], [key]: next } }));
    toggleChecklistItem(week, key, next).catch(() => {
      setCheckedByWeek((prev) => ({ ...prev, [week]: { ...prev[week], [key]: !next } }));
    });
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Weekly Checklist</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: "-0.5rem", marginBottom: "1.5rem" }}>
        Every week's checklist in one place. Each week is collapsible; the checkbox next to a week's
        name is automatic — it checks itself once every item inside is checked, it isn't something
        you click directly.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p style={{ color: "var(--chalk-dim)" }}>Loading…</p>
      ) : (
        <>
          <CollapsibleChecklistSection
            title="Preseason Checklist"
            items={PRESEASON_CHECKLIST_ITEMS}
            checked={checkedByWeek[PRESEASON_CHECKLIST_WEEK] ?? {}}
            onToggle={(key, next) => toggle(PRESEASON_CHECKLIST_WEEK, key, next)}
            defaultOpen={!isFullyDone(PRESEASON_CHECKLIST_ITEMS, checkedByWeek[PRESEASON_CHECKLIST_WEEK] ?? {})}
          />

          {CHECKLIST_WEEKS.map((w) => (
            <CollapsibleChecklistSection
              key={w}
              title={`Weekly checklist — ${weekLabel(w)}`}
              items={CHECKLIST_ITEMS}
              checked={checkedByWeek[w] ?? {}}
              onToggle={(key, next) => toggle(w, key, next)}
              defaultOpen={!isFullyDone(CHECKLIST_ITEMS, checkedByWeek[w] ?? {})}
            />
          ))}
        </>
      )}
    </div>
  );
}
