export default function SortHeader({ label, sortKey, active, dir, onClick, align, style, className }: any) {
  return (
    <th
      onClick={() => onClick(sortKey)}
      className={`th ${align === "right" ? "th-right" : ""}${className ? ` ${className}` : ""}`}
      style={style}
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
