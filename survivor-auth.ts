// This runs on Vercel's servers, not in the browser — the real password
// lives only in SURVIVOR_PASSWORD (server env var, never VITE_-prefixed),
// so it never ships in the client bundle the way a client-only check would.

const SURVIVOR_PASSWORD = process.env.SURVIVOR_PASSWORD;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!SURVIVOR_PASSWORD) {
    res.status(500).json({ error: "SURVIVOR_PASSWORD is not configured on the server" });
    return;
  }

  const { password } = req.body ?? {};

  if (password !== SURVIVOR_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  res.status(200).json({ ok: true });
}
