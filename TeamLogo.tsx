export default function SortHeader({ label, sortKey, active, dir, onClick, align }: any) {
  return (
    <th
      onClick={() => onClick(sortKey)}
      className={`th ${align === "right" ? "th-right" : ""}`}
    >
      <span className="th-inner">
        {label}
        <span className={`th-arrow ${active ? "th-arrow-active" : ""}`}>
          {active ? (dir === "asc" ? "▲" : "▼") : "—"}
        </span>
      </span>
    </th>
  );
}
