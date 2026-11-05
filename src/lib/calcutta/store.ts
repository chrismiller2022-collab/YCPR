import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "../supabaseClient";
import type { Result } from "./engine";
import type { CalcuttaAuction } from "./types";

// Local-first storage for Calcutta auctions.
//
// localStorage is the source of truth during an auction: every action reads
// the latest doc, applies a pure engine function, and writes it back in the
// same tick. Other tabs on this browser (the screen-shared Stage, the admin
// panel, the future Desk) get the browser's `storage` event and re-render,
// so the two monitors never disagree and a crashed tab loses nothing.
//
// Supabase (calcutta_auctions) is a mirror, written ~1.5s after the last
// change through /api/pool-save. If that table/endpoint isn't there yet the
// auction still runs fully — the sync badge just shows the error.

const DOC_KEY = (id: string) => `calcutta:doc:${id}`;
const INDEX_KEY = "calcutta:index";

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

function subscribe(l: Listener) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith("calcutta:")) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const parseCache = new Map<string, { raw: string; doc: any }>();
function readJson<T>(key: string): T | null {
  const raw = readRaw(key);
  if (raw == null) return null;
  const hit = parseCache.get(key);
  if (hit && hit.raw === raw) return hit.doc;
  try {
    const doc = JSON.parse(raw);
    parseCache.set(key, { raw, doc });
    return doc;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("Calcutta: local save failed", err);
  }
}

export function readAuction(id: string): CalcuttaAuction | null {
  return readJson<CalcuttaAuction>(DOC_KEY(id));
}

export function listLocalIds(): string[] {
  return readJson<string[]>(INDEX_KEY) ?? [];
}

export function listLocalAuctions(): CalcuttaAuction[] {
  return listLocalIds()
    .map(readAuction)
    .filter(Boolean)
    .sort((a, b) => b!.updatedAt - a!.updatedAt) as CalcuttaAuction[];
}

export function writeAuction(a: CalcuttaAuction, opts: { cloud?: boolean } = {}) {
  writeJson(DOC_KEY(a.id), a);
  const ids = listLocalIds();
  if (!ids.includes(a.id)) writeJson(INDEX_KEY, [...ids, a.id]);
  notify();
  if (opts.cloud !== false) scheduleCloudSave(a.id);
}

export function deleteLocalAuction(id: string) {
  try {
    localStorage.removeItem(DOC_KEY(id));
  } catch {
    // ignore
  }
  writeJson(
    INDEX_KEY,
    listLocalIds().filter((x) => x !== id),
  );
  notify();
}

/** Live auction doc for this tab, updated whenever any tab changes it. */
export function useAuction(id: string | null | undefined): CalcuttaAuction | null {
  const get = useCallback(() => (id ? readAuction(id) : null), [id]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useLocalAuctions(): CalcuttaAuction[] {
  const [list, setList] = useState<CalcuttaAuction[]>(() => listLocalAuctions());
  useEffect(() => subscribe(() => setList(listLocalAuctions())), []);
  return list;
}

/**
 * Apply an engine action to the LATEST stored doc (not a possibly stale
 * React copy) and persist it. Returns the engine's error, if any.
 */
export function dispatch(id: string, action: (a: CalcuttaAuction, now: number) => Result): string | undefined {
  const cur = readAuction(id);
  if (!cur) return "Auction not found";
  const res = action(cur, Date.now());
  if (res.auction !== cur) writeAuction(res.auction);
  return res.error;
}

// ---- cloud mirror ----------------------------------------------------------

export type SyncState = { state: "idle" | "pending" | "saving" | "saved" | "error"; message?: string; at?: number };
const syncByid = new Map<string, SyncState>();
const syncListeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function setSync(id: string, s: SyncState) {
  syncByid.set(id, s);
  syncListeners.forEach((l) => l());
}

export function useSyncState(id: string | null | undefined): SyncState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    syncListeners.add(l);
    return () => {
      syncListeners.delete(l);
    };
  }, []);
  return (id && syncByid.get(id)) || { state: "idle" };
}

function adminPassword(): string {
  try {
    return sessionStorage.getItem("admin_password") ?? "";
  } catch {
    return "";
  }
}

async function postSave(body: Record<string, unknown>) {
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword(), pool: "calcutta", ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  return data;
}

export function scheduleCloudSave(id: string, delayMs = 1500) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  setSync(id, { state: "pending" });
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void saveToCloud(id);
    }, delayMs),
  );
}

export async function saveToCloud(id: string) {
  const doc = readAuction(id);
  if (!doc) return;
  if (!adminPassword()) {
    setSync(id, { state: "error", message: "Not signed in to admin in this tab — saved on this computer only" });
    return;
  }
  setSync(id, { state: "saving" });
  try {
    await postSave({ action: "save", doc });
    setSync(id, { state: "saved", at: Date.now() });
  } catch (err: any) {
    setSync(id, { state: "error", message: err?.message ?? "Cloud save failed — saved on this computer only" });
  }
}

export interface CloudAuctionMeta {
  id: string;
  name: string;
  format: string;
  status: string;
  updated_at: string;
}

export async function listCloudAuctions(): Promise<CloudAuctionMeta[]> {
  const { data, error } = await supabase.from("calcutta_auctions").select("id, name, format, status, updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CloudAuctionMeta[];
}

export async function fetchCloudAuction(id: string): Promise<CalcuttaAuction | null> {
  const { data, error } = await supabase.from("calcutta_auctions").select("doc").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data?.doc as CalcuttaAuction) ?? null;
}

export async function deleteCloudAuction(id: string) {
  await postSave({ action: "delete", id });
}
