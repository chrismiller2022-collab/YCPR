import { useState } from "react";
import type { ChecklistItemDef } from "../lib/checklistItems";

// Every leaf key under a single item, recursing through however many
// levels of subItems it has.
function leafKeysFor(item: ChecklistItemDef): string[] {
  return item.subItems ? item.subItems.flatMap(leafKeysFor) : [item.key];
}

function ChecklistItemRow({
  item,
  isChecked,
  onToggle,
}: {
  item: ChecklistItemDef;
  isChecked: (key: string) => boolean;
  onToggle: (key: string, next: boolean) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const leafKeys = leafKeysFor(item);
  const allChecked = leafKeys.every((k) => isChecked(k));

  function toggleGroup(next: boolean) {
    if (!item.subItems) {
      onToggle(item.key, next);
      return;
    }
    for (const k of leafKeys) onToggle(k, next);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input type="checkbox" checked={allChecked} onChange={(e) => toggleGroup(e.target.checked)} />
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              textDecoration: allChecked ? "line-through" : "underline",
              opacity: allChecked ? 0.6 : 1,
              color: "inherit",
            }}
          >
            {item.label} ↗
          </a>
        ) : (
          <span style={{ textDecoration: allChecked ? "line-through" : "none", opacity: allChecked ? 0.6 : 1 }}>
            {item.label}
          </span>
        )}
        {item.subItems && (
          <button
            onClick={() => setIsExpanded((e) => !e)}
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
        <div style={{ marginLeft: "1.7rem", marginTop: "0.35rem" }}>
          <ChecklistItemsBlock items={item.subItems} isChecked={isChecked} onToggle={onToggle} />
        </div>
      )}
    </div>
  );
}

export default function ChecklistItemsBlock({
  items,
  isChecked,
  onToggle,
}: {
  items: ChecklistItemDef[];
  isChecked: (key: string) => boolean;
  onToggle: (key: string, next: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {items.map((item) => (
        <ChecklistItemRow key={item.key} item={item} isChecked={isChecked} onToggle={onToggle} />
      ))}
    </div>
  );
}
