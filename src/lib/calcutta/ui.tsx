import { useEffect, useState } from "react";
import type { CalcuttaAuction, FieldTeam, Lot } from "./types";
import { lotTeams } from "./engine";

export function fmt$(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Dollars with cents only when the amount is small enough for them to matter ($3.25, $52, $1,300). */
export function fmtPayout(v: number): string {
  return fmt$(v, Math.abs(v) < 100 && Math.round(v) !== v ? 2 : 0);
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function TeamBadge({ team, size = 22 }: { team: FieldTeam; size?: number }) {
  const [failed, setFailed] = useState(false);
  return team.logo && !failed ? (
    <img src={team.logo} alt="" width={size} height={size} style={{ objectFit: "contain", flex: "none" }} onError={() => setFailed(true)} />
  ) : (
    <span className="cal-abbr" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {team.abbr}
    </span>
  );
}

export function LotLogos({ auction, lot, size = 22 }: { auction: CalcuttaAuction; lot: Lot; size?: number }) {
  return (
    <span className="cal-logos">
      {lotTeams(auction, lot).map((t) => (
        <TeamBadge key={t.id} team={t} size={size} />
      ))}
    </span>
  );
}

export function seedLabel(t: FieldTeam): string {
  return t.seed != null ? `${t.group} #${t.seed}` : t.group;
}

/** Number input that only commits on blur/Enter, so clearing the box to retype doesn't write a 0. */
export function NumField({
  value,
  onCommit,
  step = 1,
  min,
  width = 80,
  disabled,
  suffix,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  width?: number;
  disabled?: boolean;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) setText(String(value));
    else if (n !== value) onCommit(n);
  };
  return (
    <span className="cal-num">
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        disabled={disabled}
        style={{ width }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && <span className="cal-suffix">{suffix}</span>}
    </span>
  );
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
