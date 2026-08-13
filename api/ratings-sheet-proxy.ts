// Thin server-side proxy for the site owner's published Google Sheet.
// Google's docs domain doesn't send CORS headers that would let the
// browser fetch this directly, so this endpoint fetches it server-side
// and hands back the raw CSV text. Parsing + team-name matching happens
// client-side (same pattern as csvImport.ts) since that's where the
// canonical team roster + fuzzy matcher already live.
//
// The published sheet URL is fixed (not user-suppliable) — this is a
// proxy for exactly one known sheet, not an open CORS proxy.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const PUBLISHED_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSVjBP2D2wtc8BqL4TjGFIUxPOK4108bp8VI-rSh9oVmeiEClfQQD2wECBnUvytTgEqOwjunK6Cwg9v/pub?output=csv";

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

  try {
    const sheetRes = await fetch(PUBLISHED_SHEET_CSV_URL);
    if (!sheetRes.ok) {
      throw new Error(`Sheet fetch failed (${sheetRes.status})`);
    }
    const csv = await sheetRes.text();
    res.status(200).json({ ok: true, csv });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Sheet fetch failed" });
  }
}
