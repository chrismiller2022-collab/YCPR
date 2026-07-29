// This runs on Vercel's servers, not in the browser — the real password
// lives only in ADMIN_PASSWORD (server env var, never VITE_-prefixed), so
// it never ships in the client bundle. Mirrors survivor-auth.ts's pattern.
//
// Note: this is a separate check from the one inside admin-save.ts.
// admin-save.ts re-validates the password itself before writing anything,
// so this endpoint existing doesn't weaken that — it just means the
// client-side gate (which previously accepted any non-empty string) now
// actually confirms the password before letting someone into the Admin
// area at all, matching how Survivor's gate already worked.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!ADMIN_PASSWORD) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured on the server" });
    return;
  }

  const { password } = req.body ?? {};

  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  res.status(200).json({ ok: true });
}
