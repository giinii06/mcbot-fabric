import { isAuthorized } from "./auth";
import { createDedupCache } from "./dedup";
import { inboundEventSchema, type InboundEvent } from "./protocol";
import type { Logger } from "../log";

export interface BridgeServerOptions {
  port: number;
  secret: string;
  log: Logger;
  onEvent: (event: InboundEvent) => Promise<void> | void;
  /** `true` when the bot recently reached the Minecraft plugin. */
  isMinecraftHealthy: () => boolean;
  dedupTtlMs?: number;
}

export type BridgeHandler = (req: Request) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const BOT_HEALTH_PATH = "/health";
export const EVENT_PATH = "/bridge/events";

/**
 * HTTP endpoint the Minecraft plugin posts gameplay events to.
 *
 * Deliberately tiny: health + events only. There is no endpoint that can
 * execute an arbitrary Minecraft command - whitelist mutations are always
 * bot -> plugin, never the other way around.
 */
export function createBridgeHandler(options: BridgeServerOptions): BridgeHandler {
  const dedup = createDedupCache(options.dedupTtlMs ?? 3 * 60_000);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && path === BOT_HEALTH_PATH) {
      return json({ ok: true, minecraft: options.isMinecraftHealthy() });
    }

    if (req.method === "POST" && path === EVENT_PATH) {
      if (!isAuthorized(req, options.secret)) {
        options.log.warn("bridge event rejected: unauthorized", { path });
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return json({ ok: false, error: "invalid json" }, 400);
      }

      const parsed = inboundEventSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return json(
          {
            ok: false,
            error: "invalid payload",
            field: issue ? `${issue.path.join(".")}: ${issue.message}` : undefined,
          },
          400,
        );
      }

      const event: InboundEvent = parsed.data;
      if (dedup.has(event.eventId)) {
        return json({ ok: true, duplicate: true });
      }

      try {
        await options.onEvent(event);
      } catch (err) {
        options.log.error("bridge event handler failed", {
          type: event.type,
          eventId: event.eventId,
          error: err instanceof Error ? err.message : String(err),
        });
        return json({ ok: false, error: "handler failed" }, 500);
      }
      // Record only after success: a failed handler must not swallow the retry.
      dedup.seen(event.eventId);
      options.log.info("bridge event accepted", { type: event.type, eventId: event.eventId });
      return json({ ok: true, accepted: true });
    }

    return json({ ok: false, error: "not found" }, 404);
  };
}
