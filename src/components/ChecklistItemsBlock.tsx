import { useState } from "react";
import type { ChecklistItemDef } from "../lib/checklistItems";

export default function ChecklistItemsBlock({
  items,
  isChecked,
  onToggle,
}: {
  items: ChecklistItemDef[];
  isChecked: (key: string) => boolean;
  onToggle: (key: string, next: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggleGroup(item: ChecklistItemDef, next: boolean) {
    if (!item.subItems) {
      onToggle(item.key, next);
      return;
    }
    for (const sub of item.subItems) onToggle(sub.key, next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {items.map((item) => {
        const allSubChecked = item.subItems ? item.subItems.every((s) => isChecked(s.key)) : isChecked(item.key);
        const isExpanded = expanded[item.key] ?? false;
        return (
          <div key={item.key}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" checked={allSubChecked} onChange={(e) => toggleGroup(item, e.target.checked)} />
              <span style={{ textDecoration: allSubChecked ? "line-through" : "none", opacity: allSubChecked ? 0.6 : 1 }}>
                {item.label}
              </span>
              {item.subItems && (
                <button
                  onClick={() => setExpanded((ex) => ({ ...ex, [item.key]: !isExpanded }))}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--chalk-dim)",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    padding: 0,
                  }}
                >
                  {isExpanded ? "▲ hide" : "▼ show"}
                </button>
              )}
            </div>
            {item.subItems && isExpanded && (
              <div style={{ marginLeft: "1.7rem", marginTop: "0.35rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {item.subItems.map((sub) => (
                  <label key={sub.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                    <input type="checkbox" checked={isChecked(sub.key)} onChange={(e) => onToggle(sub.key, e.target.checked)} />
                    {sub.url ? (
                      <a
                        href={sub.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          textDecoration: isChecked(sub.key) ? "line-through" : "underline",
                          opacity: isChecked(sub.key) ? 0.6 : 1,
                          color: "inherit",
                        }}
                      >
                        {sub.label} ↗
                      </a>
                    ) : (
                      <span style={{ textDecoration: isChecked(sub.key) ? "line-through" : "none", opacity: isChecked(sub.key) ? 0.6 : 1 }}>
                        {sub.label}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
