import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";

// Passkey sign-in for the admin site. The server (api/admin-save.ts) hands back a session token after a successful
// passkey check; it goes in sessionStorage under the same key the admin password uses, so every existing admin call
// ("password" in the body or x-admin-password header) just works with it. A copy is kept in localStorage so the device
// stays signed in for the token's 14 days instead of only until the tab closes.
const PASSWORD_KEY = "admin_password";
const AUTHED_KEY = "admin_authed";
const SESSION_KEY = "admin_passkey_session";

export const passkeysSupported = (): boolean => {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
};

interface StoredSession {
  token: string;
  expiresAt: number;
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (typeof s?.token === "string" && Number(s.expiresAt) > Date.now()) return s;
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable — no saved session
  }
  return null;
}

/** If this device signed in with a passkey recently, put its session back into this tab. Returns whether admin is signed in. */
export function restorePasskeySession(): boolean {
  try {
    if (sessionStorage.getItem(AUTHED_KEY) === "1" && sessionStorage.getItem(PASSWORD_KEY)) return true;
    const s = readSession();
    if (!s) return false;
    sessionStorage.setItem(PASSWORD_KEY, s.token);
    sessionStorage.setItem(AUTHED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Forget this device's saved passkey session (the passkey itself stays registered). */
export function clearPasskeySession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

async function post(body: Record<string, unknown>): Promise<any> {
  const res = await fetch("/api/admin-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

const pw = () => sessionStorage.getItem(PASSWORD_KEY) ?? "";

function friendly(err: any): Error {
  if (err?.name === "NotAllowedError") return new Error("Cancelled, or no passkey for this address on this device");
  return err instanceof Error ? err : new Error(String(err));
}

/** Signs in with a passkey stored on this device. Resolves once the session is saved; throws a readable error otherwise. */
export async function signInWithPasskey(): Promise<void> {
  try {
    const { options } = await post({ action: "passkeyLoginOptions" });
    const response = await startAuthentication({ optionsJSON: options });
    const data = await post({ action: "passkeyLoginVerify", response, challenge: options.challenge });
    sessionStorage.setItem(PASSWORD_KEY, data.token);
    sessionStorage.setItem(AUTHED_KEY, "1");
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: data.token, expiresAt: data.expiresAt }));
    } catch {
      // still signed in for this tab
    }
  } catch (err) {
    throw friendly(err);
  }
}

export interface PasskeyInfo {
  id: string;
  name: string;
  rp_id: string;
  created_at: string;
  last_used_at: string | null;
}

export async function listPasskeys(): Promise<{ passkeys: PasskeyInfo[]; rpID: string }> {
  return post({ password: pw(), action: "passkeyList" });
}

export async function removePasskey(id: string): Promise<void> {
  await post({ password: pw(), action: "passkeyRemove", id });
}

/** Registers this device (asks for Face ID / Touch ID / Windows Hello / PIN). Needs an existing admin sign-in. */
export async function addPasskey(name: string): Promise<void> {
  try {
    const { options } = await post({ password: pw(), action: "passkeyRegisterOptions" });
    const response = await startRegistration({ optionsJSON: options });
    await post({ password: pw(), action: "passkeyRegisterVerify", response, challenge: options.challenge, name });
  } catch (err) {
    throw friendly(err);
  }
}
