import { randomUUID } from "node:crypto";

export function newId(prefix = ""): string {
  const id = randomUUID();
  return prefix ? `${prefix}-${id}` : id;
}

export function nowMs(): number {
  return Date.now();
}
