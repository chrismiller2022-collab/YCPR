import { createClient } from "@supabase/supabase-js";
// Runs on Vercel's servers only — service role key never reaches the
// browser. This endpoint doesn't accept the PDF bytes itself (Vercel
// functions cap request/response bodies at 4.5MB, and a full weekly
// report's worth of PNG-derived pages can exceed that). Instead it
// deletes any existing object for the week, then hands back a signed
// upload URL/token that the browser uses to PUT the PDF directly to
// Supabase Storage.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "weekly-reports";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!ADMIN_PASSWORD || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server env vars are not configured" });
    return;
  }

  const { password, week } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  if (!week || typeof week !== "string") {
    res.status(400).json({ error: "Missing or invalid week" });
    return;
  }

  const path = `${week}.pdf`;
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Remove any existing object first rather than relying on upsert —
    // Supabase's signed-upload-URL + upsert combination has open
    // reliability issues around overwriting existing files.
    await supabaseAdmin.storage.from(BUCKET).remove([path]);

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;

    res.status(200).json({ ok: true, path, token: data.token, signedUrl: data.signedUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to prepare upload" });
  }
}
