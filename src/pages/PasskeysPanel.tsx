import { useEffect, useState } from "react";
import { addPasskey, listPasskeys, passkeysSupported, removePasskey, type PasskeyInfo } from "../lib/adminAuth";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

// Each phone or computer gets its own passkey, so this works like a per-device password: sign in once with the password,
// add the device here, and from then on tap "Sign in with passkey" on the login screen.
export default function PasskeysPanel({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<PasskeyInfo[] | null>(null);
  const [rpID, setRpID] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await listPasskeys();
      setList(r.passkeys);
      setRpID(r.rpID);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load passkeys");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await addPasskey(name.trim() || "This device");
      setName("");
      setMsg("Added. Next time, tap “Sign in with passkey” on the Admin login screen.");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add the passkey");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: PasskeyInfo) {
    if (!window.confirm(`Remove “${p.name}”? That device will no longer be able to sign in with its passkey.`)) return;
    setError(null);
    setMsg(null);
    try {
      await removePasskey(p.id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't remove it");
    }
  }

  const cell = { padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", fontSize: "0.82rem" } as const;
  return (
    <div style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Passkeys</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--chalk-dim)", lineHeight: 1.55 }}>
        A passkey lets a phone or computer sign in to Admin with Face ID, Touch ID, Windows Hello or its PIN instead of typing the password. Each device has its own. The password
        still works everywhere; passkeys are an extra way in. A device signed in with a passkey stays signed in for 14 days. Only the public half of each key is stored here.
      </p>
      {!passkeysSupported() && <p style={{ color: "var(--c-err)", fontSize: "0.85rem" }}>This browser doesn't support passkeys.</p>}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", margin: "1rem 0 0.4rem" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this device, e.g. iPhone" style={{ width: 240, padding: "0.4rem" }} maxLength={60} />
        <button className="menu-btn" onClick={add} disabled={busy || !passkeysSupported()}>
          {busy ? "Waiting for your device…" : "Add this device"}
        </button>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        A passkey only works on the web address it was added on{rpID ? <> (you're on <strong>{rpID}</strong>)</> : ""}. If the site moves to a new address, add the device again there.
      </p>
      {msg && <p style={{ fontSize: "0.85rem" }}>{msg}</p>}
      {error && <p style={{ fontSize: "0.85rem", color: "var(--c-err)" }}>{error}</p>}
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "0.8rem" }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left" }}>Device</th>
            <th style={{ ...cell, textAlign: "left" }}>Address</th>
            <th style={{ ...cell, textAlign: "left" }}>Added</th>
            <th style={{ ...cell, textAlign: "left" }}>Last used</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          {(list ?? []).map((p) => (
            <tr key={p.id}>
              <td style={{ ...cell, fontWeight: 600 }}>{p.name}</td>
              <td style={{ ...cell, color: p.rp_id === rpID ? undefined : "var(--chalk-dim)" }}>{p.rp_id}</td>
              <td style={cell}>{when(p.created_at)}</td>
              <td style={cell}>{when(p.last_used_at)}</td>
              <td style={{ ...cell, textAlign: "right" }}>
                <button className="menu-btn" onClick={() => remove(p)} style={{ fontSize: "0.74rem", padding: "0.15rem 0.6rem" }}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {list != null && list.length === 0 && (
            <tr>
              <td style={cell} colSpan={5}>No passkeys yet.</td>
            </tr>
          )}
          {list == null && !error && (
            <tr>
              <td style={cell} colSpan={5}>Loading…</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
