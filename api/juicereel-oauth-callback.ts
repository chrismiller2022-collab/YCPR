import { createClient } from "@supabase/supabase-js";

// GET-only, unauthenticated (no admin password) — this is the redirect
// target JuiceReel's OWN browser redirect lands on after the user signs
// in and approves access on juicereel.com. There's no password to check
// here; the security boundary is the `state` row this exchange requires
// (created server-side by admin-bets-save.ts's "juicereelAuthorizeUrl"
// action, single-use, deleted immediately after redemption) plus the fact that
// only our own server ever holds JUICEREEL_CLIENT_SECRET, so only our
// server can complete the code-for-token exchange even if someone else
// somehow obtained a valid `code`.
const JUICEREEL_CLIENT_ID = process.env.JUICEREEL_CLIENT_ID;
const JUICEREEL_CLIENT_SECRET = process.env.JUICEREEL_CLIENT_SECRET;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const API_BASE = "https://external-api.juicereel.com";
// Must exactly match the Redirect URI registered on the JuiceReel OAuth
// application AND the one "juicereelAuthorizeUrl" sends — JuiceReel
// rejects the exchange otherwise.
const REDIRECT_URI = "https://ycpr.vercel.app/api/juicereel-oauth-callback";
// Where to send the browser back to once this is done, success or not —
// PlacedBetsPanel.tsx checks for these query params on mount.
const RETURN_URL = "https://ycpr.vercel.app/";

function redirectWithStatus(res: any, status: "connected" | "error", message?: string) {
  const url = new URL(RETURN_URL);
  url.searchParams.set("juicereel", status);
  if (message) url.searchParams.set("juicereel_message", message);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!JUICEREEL_CLIENT_ID || !JUICEREEL_CLIENT_SECRET) {
    redirectWithStatus(res, "error", "JuiceReel client credentials are not configured on the server");
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    redirectWithStatus(res, "error", "Supabase server env vars are not configured");
    return;
  }

  const { code, state, error: oauthError } = req.query ?? {};
  if (oauthError) {
    redirectWithStatus(res, "error", String(oauthError));
    return;
  }
  if (!code || !state) {
    redirectWithStatus(res, "error", "Missing code or state in callback");
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // The state row proves this callback corresponds to an authorize
    // request we actually started (CSRF protection) and carries the PKCE
    // verifier, which never left our server until this exact exchange.
    const { data: stateRow, error: stateError } = await supabaseAdmin
      .from("juicereel_oauth_state")
      .select("code_verifier, created_at")
      .eq("state", state)
      .maybeSingle();
    if (stateError) throw stateError;
    if (!stateRow) {
      redirectWithStatus(res, "error", "Unrecognized or already-used authorization state");
      return;
    }
    // Single-use regardless of what happens next — a stolen/replayed
    // `code` is useless once this row is gone, and a genuinely failed
    // exchange just means starting over with a fresh authorize.
    await supabaseAdmin.from("juicereel_oauth_state").delete().eq("state", state);

    const tokenRes = await fetch(`${API_BASE}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${JUICEREEL_CLIENT_ID}:${JUICEREEL_CLIENT_SECRET}`).toString("base64")}`,
        "X-OAuth-Client-Id": JUICEREEL_CLIENT_ID,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: REDIRECT_URI,
        code_verifier: stateRow.code_verifier,
      }),
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenRes.ok) {
      redirectWithStatus(res, "error", tokenData.error_description ?? tokenData.error ?? "Token exchange failed");
      return;
    }

    const meRes = await fetch(`${API_BASE}/oauth2/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "X-OAuth-Client-Id": JUICEREEL_CLIENT_ID },
    });
    const me: any = await meRes.json();

    const nowMs = Date.now();
    const { error: upsertError } = await supabaseAdmin.from("juicereel_connection").upsert(
      {
        id: 1,
        juicereel_user_id: meRes.ok ? me.id ?? null : null,
        display_name: meRes.ok ? me.displayName ?? null : null,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(nowMs + tokenData.expires_in * 1000).toISOString(),
        scope: tokenData.scope ?? null,
        updated_at: new Date(nowMs).toISOString(),
      },
      { onConflict: "id" }
    );
    if (upsertError) throw upsertError;

    redirectWithStatus(res, "connected");
  } catch (err: any) {
    redirectWithStatus(res, "error", err.message ?? "Unexpected error completing JuiceReel connection");
  }
}
