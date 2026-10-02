import { describe, expect, test } from "bun:test";
import { BridgeClient, BridgeError, OP_PATH } from "../src/bridge/client";
import { jsonResponse } from "./helpers";

const SECRET = "0123456789abcdef0123456789abcdef";
const UUID = "069a79f4-44e9-4726-a5be-ca90e38aaf51";

interface Capture {
  url: string;
  init: RequestInit | undefined;
}

const RESPONSES: Record<string, unknown> = {
  getWhitelist: { entries: [] },
  getStatus: { ok: true, online: 0, max: 20, version: "test", whitelistEnabled: true, enforceWhitelist: true },
  getPlaytime: { uuid: UUID, seconds: 1, ticks: 20, source: "file" },
  getOnlinePlayers: { players: [] },
};

function client(handler?: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const calls: Capture[] = [];
  const instance = new BridgeClient({
    baseUrl: "http://minecraft:8765/",
    secret: SECRET,
    timeoutMs: 500,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (handler) return handler(body);
      const op = String(body.op ?? "");
      if (String(input).endsWith("/health")) return jsonResponse({ ok: true, minecraft: true });
      return jsonResponse(RESPONSES[op] ?? { ok: true, applied: true });
    },
  });
  return { instance, calls };
}

describe("BridgeClient transport", () => {
  test("posts typed operations to /ops with the shared secret", async () => {
    const { instance, calls } = client(() => jsonResponse({ ok: true, applied: true }));
    await instance.addJava(UUID, "Notch");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`http://minecraft:8765${OP_PATH}`);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(calls[0]?.init?.method).toBe("POST");

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.op).toBe("whitelistAddJava");
    expect(body.uuid).toBe(UUID);
    expect(body.username).toBe("Notch");
    expect(String(body.requestId).length).toBeGreaterThanOrEqual(8);
  });

  test("every operation carries a unique request id", async () => {
    const { instance, calls } = client();
    await instance.getWhitelist();
    await instance.getStatus();
    await instance.getPlaytime(UUID);
    const ids = calls.map((c) => (JSON.parse(String(c.init?.body)) as { requestId: string }).requestId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  test("bedrock operations pass the gamertag and optional xuid", async () => {
    const { instance, calls } = client(() => jsonResponse({ ok: true, applied: true }));
    await instance.addBedrock("Bedrock Kid", "2535453759792258");
    await instance.removeBedrock("Bedrock Kid");
    const first = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    const second = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(first.op).toBe("whitelistAddBedrock");
    expect(first.xuid).toBe("2535453759792258");
    expect(second.op).toBe("whitelistRemoveBedrock");
    expect(second.xuid).toBeUndefined();
  });

  test("health state tracks the last probe", async () => {
    let ok = true;
    const instance = new BridgeClient({
      baseUrl: "http://minecraft:8765",
      secret: SECRET,
      fetchImpl: async () => (ok ? jsonResponse({ ok: true, minecraft: true }) : jsonResponse({ ok: false }, 500)),
    });
    expect(instance.isHealthy()).toBe(false);
    expect(await instance.health()).toBe(true);
    expect(instance.isHealthy()).toBe(true);
    ok = false;
    expect(await instance.health()).toBe(false);
    expect(instance.isHealthy()).toBe(false);
    expect(instance.lastError).toBeTruthy();
  });

  test("http errors become BridgeError with status and op", async () => {
    const { instance } = client(() => jsonResponse({ ok: false, error: "unauthorized" }, 401));
    let caught: unknown;
    try {
      await instance.getWhitelist();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BridgeError);
    const bridgeError = caught as BridgeError;
    expect(bridgeError.status).toBe(401);
    expect(bridgeError.op).toBe("getWhitelist");
    expect(bridgeError.message).toContain("unauthorized");
    expect(instance.isHealthy()).toBe(false);
  });

  test("unexpected payloads are rejected", async () => {
    const { instance } = client(() => jsonResponse({ entries: [{ uuid: "nope" }] }));
    await expect(instance.getWhitelist()).rejects.toThrow(BridgeError);
    await expect(instance.getWhitelist()).rejects.toThrow("unexpected payload");
  });

  test("network failures are wrapped", async () => {
    const instance = new BridgeClient({
      baseUrl: "http://minecraft:8765",
      secret: SECRET,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(instance.getStatus()).rejects.toThrow(BridgeError);
    expect(instance.lastError).toContain("ECONNREFUSED");
  });
});

describe("BridgeClient surface", () => {
  test("exposes only the typed operations", () => {
    const methods = Object.getOwnPropertyNames(BridgeClient.prototype)
      .filter((name) => name !== "constructor" && name !== "post" && name !== "op")
      .sort();
    expect(methods).toEqual(
      [
        "addBedrock",
        "addJava",
        "getOnlinePlayers",
        "getPlaytime",
        "getStatus",
        "getWhitelist",
        "health",
        "isHealthy",
        "lastError",
        "removeBedrock",
        "removeJava",
      ].sort(),
    );
    expect(methods.some((m) => /command|exec|console|run/i.test(m))).toBe(false);
  });
});
