import { timingSafeEqual } from "node:crypto";

/** Constant time comparison for the shared bridge secret. */
export function safeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // keep the comparison cost roughly the same for both branches
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function extractSecret(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  const alt = req.headers.get("x-bridge-secret");
  if (alt) return alt.trim();
  return null;
}

export function isAuthorized(req: Request, secret: string): boolean {
  const provided = extractSecret(req);
  if (!provided) return false;
  return safeEquals(provided, secret);
}
