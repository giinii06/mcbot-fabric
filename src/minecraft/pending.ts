import { randomUUID } from "node:crypto";
import type { IdentityCandidate, IdentityResult } from "./identity";

export interface PendingRegistration {
  token: string;
  guildId: string;
  userId: string;
  displayName: string;
  input: string;
  candidates: IdentityCandidate[];
  chosen: IdentityCandidate | null;
  identity: IdentityResult;
  createdAt: number;
}

interface Entry extends PendingRegistration {
  expiresAt: number;
}

export interface PendingStore {
  put(item: Omit<PendingRegistration, "token" | "createdAt">, ttlMs?: number): PendingRegistration;
  get(token: string): PendingRegistration | null;
  choose(token: string, edition: "JAVA" | "BEDROCK"): PendingRegistration | null;
  /** Removes and returns the pending registration (single use). */
  commit(token: string): PendingRegistration | null;
  size(): number;
}

export const PENDING_TTL_MS = 5 * 60_000;

export function createPendingStore(now: () => number = Date.now): PendingStore {
  const items = new Map<string, Entry>();

  const sweep = (): void => {
    const at = now();
    for (const [token, entry] of items) {
      if (entry.expiresAt <= at) items.delete(token);
    }
  };

  return {
    put(item, ttlMs = PENDING_TTL_MS) {
      sweep();
      const token = randomUUID();
      const createdAt = now();
      const entry: Entry = { ...item, token, createdAt, expiresAt: createdAt + ttlMs };
      items.set(token, entry);
      if (items.size > 200) {
        const oldest = items.keys().next();
        if (!oldest.done) items.delete(oldest.value);
      }
      const { expiresAt: _expiresAt, ...publicEntry } = entry;
      return publicEntry;
    },
    get(token) {
      sweep();
      const entry = items.get(token);
      if (!entry) return null;
      const { expiresAt: _expiresAt, ...publicEntry } = entry;
      return publicEntry;
    },
    choose(token, edition) {
      sweep();
      const entry = items.get(token);
      if (!entry) return null;
      const chosen = entry.candidates.find((candidate) => candidate.edition === edition);
      if (!chosen) return null;
      entry.chosen = chosen;
      const { expiresAt: _expiresAt, ...publicEntry } = entry;
      return publicEntry;
    },
    commit(token) {
      sweep();
      const entry = items.get(token);
      if (!entry) return null;
      items.delete(token);
      const { expiresAt: _expiresAt, ...publicEntry } = entry;
      return publicEntry;
    },
    size() {
      sweep();
      return items.size;
    },
  };
}
