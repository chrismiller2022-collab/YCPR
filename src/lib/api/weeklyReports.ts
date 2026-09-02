import { supabase } from "../supabaseClient";

const BUCKET = "weekly-reports";

export type ReportDivision = "FBS" | "FCS";

// Storage key for a given week+division's report — FBS and FCS are now
// fully separate published PDFs (previously one combined week1.pdf;
// the Weekly Image Dump itself now generates/publishes one division at
// a time). Lowercased division suffix, e.g. "week1-fbs.pdf".
function reportPath(week: string, division: ReportDivision): string {
  return `${week}-${division.toLowerCase()}.pdf`;
}

// Publishes this week's combined PDF (built from the Weekly Image Dump's
// PNGs) so the public Week Report page can serve it back without ever
// regenerating it. Two-step upload: ask the server for a signed upload
// URL (server deletes any existing object for the week+division first),
// then PUT the PDF bytes directly to Supabase Storage — keeps the actual
// file off the Vercel serverless function, which caps bodies at 4.5MB.
//
// Routed through admin-bets-save's action dispatch rather than its own
// endpoint — Vercel Hobby caps deployments at 12 serverless functions,
// and this project sits right at that ceiling (see that file's header
// comment), so every new server-side action goes into an existing
// function instead of a new file.
export async function publishWeeklyReportPdf(week: string, division: ReportDivision, pdf: Blob, password: string): Promise<void> {
  const signRes = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "weeklyReportSign", week, division }),
  });
  const signData = await signRes.json();
  if (!signRes.ok) throw new Error(signData.error ?? "Failed to prepare report upload");

  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(signData.path, signData.token, pdf, {
    contentType: "application/pdf",
  });
  if (error) throw error;
}

// Looks up whether a given week+division's report has been published.
// Returns the public URL if so, or null if that one hasn't been made yet.
export async function fetchWeeklyReportUrl(week: string, division: ReportDivision): Promise<string | null> {
  const path = reportPath(week, division);
  const { data, error } = await supabase.storage.from(BUCKET).list("", { search: path });
  if (error || !data) return null;
  const found = data.find((f) => f.name === path);
  if (!found) return null;
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}
