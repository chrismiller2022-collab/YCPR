import { createClient } from "@supabase/supabase-js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 30);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!ADMIN_PASSWORD) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured on the server" });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }

  const { password, action } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (action === "saveSettings") {
      const { season, conferences } = req.body;
      if (!season || !Array.isArray(conferences)) {
        res.status(400).json({ error: "Missing season or conferences" });
        return;
      }
      const { error } = await supabaseAdmin
        .from("survivor_pool_settings")
        .upsert([{ season, conferences, updated_at: new Date().toISOString() }], { onConflict: "season" });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "addEntrant") {
      const { season, name } = req.body;
      if (!season || !name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Missing season or name" });
        return;
      }

      const base = slugify(name) || "entrant";
      let slug = `${base}-${randomSuffix()}`;

      // Extremely unlikely to collide given the random suffix, but retry
      // a couple times with a fresh suffix rather than fail outright.
      let entrant = null;
      let lastError = null;
      for (let attempt = 0; attempt < 3 && !entrant; attempt++) {
        const { data, error } = await supabaseAdmin
          .from("survivor_pool_entrants")
          .insert([{ season, name: name.trim(), slug }])
          .select("*")
          .single();
        if (!error) {
          entrant = data;
        } else if (error.code === "23505") {
          // unique_violation on slug — try again with a new suffix
          slug = `${base}-${randomSuffix()}`;
          lastError = error;
        } else {
          throw error;
        }
      }
      if (!entrant) throw lastError ?? new Error("Failed to create entrant after retries");

      res.status(200).json({ ok: true, entrant });
      return;
    }

    if (action === "removeEntrant") {
      const { entrantId } = req.body;
      if (!entrantId) {
        res.status(400).json({ error: "Missing entrantId" });
        return;
      }
      const { error } = await supabaseAdmin.from("survivor_pool_entrants").delete().eq("id", entrantId);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
