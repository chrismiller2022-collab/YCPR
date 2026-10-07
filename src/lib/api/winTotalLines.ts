import { supabase } from "../supabaseClient";

export interface WinTotalLineRow {
  team: string;
  line: number;
  overPrice: number;
  underPrice: number;
  source: string | null;
  updatedAt: string;
}

export async function fetchWinTotalLines(season: number): Promise<WinTotalLineRow[]> {
  const { data, error } = await supabase
    .from("team_win_total_lines")
    .select("team, line, over_price, under_price, source, updated_at")
    .eq("season", season)
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    team: r.team,
    line: Number(r.line),
    overPrice: Number(r.over_price),
    underPrice: Number(r.under_price),
    source: r.source ?? null,
    updatedAt: r.updated_at,
  }));
}

export async function saveWinTotalLines(
  season: number,
  rows: { team: string; line: number; overPrice: number; underPrice: number }[],
  source: string
): Promise<{ saved: number }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "saveWinTotalLines", season, rows, source }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}
