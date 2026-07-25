import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Don't throw at import time — some pages may still be running on the old
  // static data files while the migration is in progress. Log instead so the
  // app doesn't hard-crash if env vars aren't set yet in a given environment.
  console.warn(
    "Supabase env vars are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "(see .env.example). Live weekly data will not load until these are set."
  );
}

// This client only ever holds the public anon key, which is safe to ship to
// the browser as long as Row Level Security policies only allow reads (see
// supabase/schema.sql). Writes happen through /api/admin-save using the
// service role key, which never reaches the browser.
export const supabase = createClient(url ?? "", anonKey ?? "");
