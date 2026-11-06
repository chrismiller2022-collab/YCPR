// Small JSON files the bot keeps on the machine it runs on (the tower), shared by its jobs. Every job is a fresh
// process, so anything one run needs to remember for the next (the ratings cache, when an alert was last sent) lives
// here. Reads and writes never throw: a missing or read-only disk just means nothing is remembered.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STATE_DIR = process.env.BOT_CACHE_DIR || join(tmpdir(), "ycpr-bot-cache");

export function readState<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeState(name: string, value: unknown): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, name), JSON.stringify(value));
  } catch {
    // nothing to do: the next run just won't remember this
  }
}
