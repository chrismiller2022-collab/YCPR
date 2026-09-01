import { supabase } from "../supabaseClient";

const BUCKET = "weekly-reports";

// Publishes this week's combined PDF (built from the Weekly Image Dump's
// PNGs) so the public Week Report page can serve it back without ever
// regenerating it. Two-step upload: ask the server for a signed upload
// URL (server deletes any existing object for the week first), then PUT
// the PDF bytes directly to Supabase Storage — keeps the actual file off
// the Vercel serverless function, which caps bodies at 4.5MB.
export async function publishWeeklyReportPdf(week: string, pdf: Blob, password: string): Promise<void> {
  const signRes = await fetch("/api/weekly-report-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, week }),
  });
  const signData = await signRes.json();
  if (!signRes.ok) throw new Error(signData.error ?? "Failed to prepare report upload");

  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(signData.path, signData.token, pdf, {
    contentType: "application/pdf",
  });
  if (error) throw error;
}

// Looks up whether a given week's report has been published. Returns the
// public URL if so, or null if that week's PDF hasn't been made yet.
export async function fetchWeeklyReportUrl(week: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).list("", { search: `${week}.pdf` });
  if (error || !data) return null;
  const found = data.find((f) => f.name === `${week}.pdf`);
  if (!found) return null;
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(`${week}.pdf`);
  return pub.publicUrl;
}
