import { describe, expect, test } from "bun:test";
import { BOT_HEALTH_PATH, createBridgeHandler, EVENT_PATH } from "../src/bridge/server";
import { createMemoryLogger } from "../src/log";
import type { InboundEvent } from "../src/bridge/protocol";

const SECRET = "0123456789abcdef0123456789abcdef";
const UUID = "069a79f4-44e9-4726-a5be-ca90e38aaf51";

function setup(overrides: { onEvent?: (event: InboundEvent) => Promise<void> | void; healthy?: boolean } = {}) {
  const received: InboundEvent[] = [];
  const log = createMemoryLogger();
  const handler = createBridgeHandler({
    port: 47865,
    secret: SECRET,
    log,
    isMinecraftHealthy: () => overrides.healthy ?? true,
    onEvent: (event) => {
      received.push(event);
      return overrides.onEvent?.(event);
    },
  });
  return { handler, received, log };
}

function post(path: string, body: unknown, secret?: string): Request {
  return new Request(`http://bot${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const joinEvent = {
  eventId: "11111111-2222-3333-4444-555555555555",
  type: "player.join",
  ts: 1_700_000_000_000,
  player: { uuid: UUID, username: "Notch", edition: "JAVA" },
};

describe("GET /health", () => {
  test("reports the minecraft probe", async () => {
    const { handler } = setup({ healthy: true });
    const res = await handler(new Request(`http://bot${BOT_HEALTH_PATH}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, minecraft: true });
  });

  test("reports an unhealthy minecraft side", async () => {
    const { handler } = setup({ healthy: false });
    const res = await handler(new Request(`http://bot${BOT_HEALTH_PATH}`));
    expect(await res.json()).toEqual({ ok: true, minecraft: false });
  });
});

describe("POST /bridge/events", () => {
  test("accepts an authorized event", async () => {
    const { handler, received } = setup();
    const res = await handler(post(EVENT_PATH, joinEvent, SECRET));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; accepted: boolean };
    expect(body).toEqual({ ok: true, accepted: true });
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("player.join");
  });

  test("rejects a missing or wrong secret", async () => {
    const { handler, received } = setup();
    const missing = await handler(post(EVENT_PATH, joinEvent));
    expect(missing.status).toBe(401);

    const wrong = await handler(post(EVENT_PATH, joinEvent, "wrong-secret"));
    expect(wrong.status).toBe(401);

    expect(received).toHaveLength(0);
  });

  test("accepts the x-bridge-secret header too", async () => {
    const { handler, received } = setup();
    const res = await handler(
      new Request(`http://bot${EVENT_PATH}`, {
        method: "POST",
        headers: { "x-bridge-secret": SECRET, "content-type": "application/json" },
        body: JSON.stringify(joinEvent),
      }),
    );
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
  });

  test("deduplicates a retried event", async () => {
    const { handler, received } = setup();
    const first = await handler(post(EVENT_PATH, joinEvent, SECRET));
    const second = await handler(post(EVENT_PATH, joinEvent, SECRET));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    expect(received).toHaveLength(1);
  });

  test("rejects malformed json", async () => {
    const { handler, received } = setup();
    const res = await handler(post(EVENT_PATH, "{not json", SECRET));
    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  test("rejects payloads that fail the schema", async () => {
    const { handler, received } = setup();
    const missingPlayer = await handler(post(EVENT_PATH, { ...joinEvent, player: undefined }, SECRET));
    expect(missingPlayer.status).toBe(400);
    const body = (await missingPlayer.json()) as { error: string; field?: string };
    expect(body.error).toBe("invalid payload");
    expect(body.field).toContain("player");

    const unknownType = await handler(post(EVENT_PATH, { ...joinEvent, type: "player.chat" }, SECRET));
    expect(unknownType.status).toBe(400);

    expect(received).toHaveLength(0);
  });

  test("a failed handler does not swallow the plugin retry", async () => {
    let calls = 0;
    const { handler } = setup({
      onEvent: () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
      },
    });
    const first = await handler(post(EVENT_PATH, joinEvent, SECRET));
    expect(first.status).toBe(500);
    const second = await handler(post(EVENT_PATH, joinEvent, SECRET));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { accepted?: boolean }).accepted).toBe(true);
    expect(calls).toBe(2);
    const third = await handler(post(EVENT_PATH, joinEvent, SECRET));
    expect(third.status).toBe(200);
    expect(((await third.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    expect(calls).toBe(2);
  });

  test("a failing handler surfaces as 500", async () => {
    const { handler, received } = setup({
      onEvent: () => {
        throw new Error("discord down");
      },
    });
    const res = await handler(post(EVENT_PATH, joinEvent, SECRET));
    expect(res.status).toBe(500);
    expect(received).toHaveLength(1);
  });
});

describe("unknown routes", () => {
  test("everything else is a 404", async () => {
    const { handler } = setup();
    const res = await handler(new Request("http://bot/ops", { method: "POST", body: "{}" }));
    expect(res.status).toBe(404);
    const other = await handler(new Request(`http://bot${EVENT_PATH}`, { method: "GET" }));
    expect(other.status).toBe(404);
  });
});
