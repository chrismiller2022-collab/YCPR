import { supabase } from "../supabaseClient";

// Backs the weekly checklist widget on the admin dashboard home view.
// Reads go straight through the anon key (RLS allows public SELECT, same
// as every other admin-only table in this app); writes go through the
// consolidated api/ratings.ts endpoint (action "checklistToggle") since
// that's the one place already holding the service-role key + password
// check, and Vercel's Hobby plan caps deployments at 12 serverless
// functions — no reason to spend one more on a single upsert.
export interface ChecklistRow {
  week: string;
  item_key: string;
  checked: boolean;
}

export async function fetchChecklistState(week: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from("admin_weekly_checklist")
    .select("item_key, checked")
    .eq("week", week);
  if (error) throw error;
  const out: Record<string, boolean> = {};
  for (const row of (data ?? []) as { item_key: string; checked: boolean }[]) out[row.item_key] = row.checked;
  return out;
}

// Batched version for the full Weekly Checklist page — one query for
// every week's state instead of 16 separate round trips.
export async function fetchChecklistStateForWeeks(weeks: string[]): Promise<Record<string, Record<string, boolean>>> {
  if (weeks.length === 0) return {};
  const { data, error } = await supabase
    .from("admin_weekly_checklist")
    .select("week, item_key, checked")
    .in("week", weeks);
  if (error) throw error;
  const out: Record<string, Record<string, boolean>> = {};
  for (const w of weeks) out[w] = {};
  for (const row of (data ?? []) as { week: string; item_key: string; checked: boolean }[]) {
    if (!out[row.week]) out[row.week] = {};
    out[row.week][row.item_key] = row.checked;
  }
  return out;
}

export function toggleChecklistItem(week: string, itemKey: string, checked: boolean) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  return fetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "checklistToggle", week, itemKey, checked }),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to save checklist");
    return data;
  });
}
