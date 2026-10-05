import { describe, expect, test } from "bun:test";
import {
  bedrockUuid,
  dashedUuid,
  IdentityLookupError,
  IdentityService,
  isBedrockUuid,
  validatePlayerInput,
} from "../src/minecraft/identity";
import { jsonResponse } from "./helpers";

const MOJANG_ID = "069a79f444e94726a5beca90e38aaf51";

function service(handler: (url: string) => Response | Promise<Response>) {
  const fetched: string[] = [];
  const svc = new IdentityService({
    fetchImpl: async (input) => {
      const url = String(input);
      fetched.push(url);
      return handler(url);
    },
    now: () => 1_000,
  });
  return { svc, fetched };
}

describe("uuid helpers", () => {
  test("dashedUuid formats the mojang id", () => {
    expect(dashedUuid(MOJANG_ID)).toBe("069a79f4-44e9-4726-a5be-ca90e38aaf51");
  });

  test("bedrockUuid matches the floodgate implementation", () => {
    expect(bedrockUuid("1")).toBe("00000000-0000-0000-0000-000000000001");
    // ground truth: org.geysermc.floodgate.util.Utils#getJavaUuid(2535453759792258L)
    expect(bedrockUuid("2535453759792258")).toBe("00000000-0000-0000-0009-01fb54b26482");
    expect(bedrockUuid("2535453759792258").length).toBe(36);
  });

  test("isBedrockUuid only matches zero most significant bits", () => {
    expect(isBedrockUuid("00000000-0000-0000-0009-01fb54b26482")).toBe(true);
    expect(isBedrockUuid("00000000-0000-0000-0000-000000000001")).toBe(true);
    expect(isBedrockUuid("069a79f4-44e9-4726-a5be-ca90e38aaf51")).toBe(false);
    expect(isBedrockUuid("00000000-0000-0001-0000-000000000001")).toBe(false);
  });
});

describe("validatePlayerInput", () => {
  test("accepts java names and gamertags", () => {
    expect(validatePlayerInput("Notch_123")).toEqual({ ok: true, value: "Notch_123" });
    expect(validatePlayerInput("  Bedrock Kid  ")).toEqual({ ok: true, value: "Bedrock Kid" });
    expect(validatePlayerInput("player.one'")).toEqual({ ok: true, value: "player.one'" });
  });

  test("rejects empty, long, prefixed and control character input", () => {
    expect(validatePlayerInput("").ok).toBe(false);
    expect(validatePlayerInput("   ").ok).toBe(false);
    expect(validatePlayerInput("a".repeat(17)).ok).toBe(false);
    expect(validatePlayerInput(".BedrockKid").ok).toBe(false);
    expect(validatePlayerInput("bad" + String.fromCharCode(7) + "name").ok).toBe(false);
    expect(validatePlayerInput("kid\"; op").ok).toBe(false);
    expect(validatePlayerInput("a b c d e f g h i").ok).toBe(false);
  });
});

describe("IdentityService.resolve", () => {
  test("returns BOTH when the same name exists on both platforms", async () => {
    const { svc } = service((url) => {
      if (url.includes("mojang")) return jsonResponse({ id: MOJANG_ID, name: "Notch" });
      return jsonResponse({ xuid: 2535453759792258 });
    });
    const result = await svc.resolve("Notch");
    expect(result.status).toBe("BOTH");
    expect(result.java?.uuid).toBe("069a79f4-44e9-4726-a5be-ca90e38aaf51");
    expect(result.bedrock?.uuid).toBe("00000000-0000-0000-0009-01fb54b26482");
    const candidates = svc.candidates(result);
    expect(candidates.map((c) => c.edition)).toEqual(["JAVA", "BEDROCK"]);
    expect(candidates[1]?.xuid).toBe("2535453759792258");
  });

  test("returns JAVA when only mojang knows the name", async () => {
    const { svc } = service((url) =>
      url.includes("mojang") ? jsonResponse({ id: MOJANG_ID, name: "Notch" }) : jsonResponse({}, 503),
    );
    const result = await svc.resolve("Notch");
    expect(result.status).toBe("JAVA");
    expect(svc.candidates(result)).toHaveLength(1);
    expect(svc.candidates(result)[0]?.edition).toBe("JAVA");
  });

  test("returns BEDROCK when only geyser knows the name", async () => {
    const { svc } = service((url) =>
      url.includes("mojang") ? jsonResponse({}, 404) : jsonResponse({ xuid: "2535453759792258" }),
    );
    const result = await svc.resolve("Bedrock Kid");
    expect(result.status).toBe("BEDROCK");
    expect(result.bedrock?.xuid).toBe("2535453759792258");
  });

  test("returns NONE when neither api knows the name", async () => {
    const { svc } = service((url) => (url.includes("mojang") ? jsonResponse({}, 404) : jsonResponse({}, 503)));
    const result = await svc.resolve("Nobody");
    expect(result.status).toBe("NONE");
    expect(result.bedrockCacheMiss).toBe(true);
    expect(svc.candidates(result)).toEqual([]);
  });

  test("does not flag a cache miss when geyser has no entry at all", async () => {
    const { svc } = service((url) => (url.includes("mojang") ? jsonResponse({}, 404) : jsonResponse({}, 404)));
    const result = await svc.resolve("Nobody");
    expect(result.status).toBe("NONE");
    expect(result.bedrockCacheMiss).toBeFalsy();
  });

  test("an api failure becomes a user facing error", async () => {
    const { svc } = service((url) => (url.includes("mojang") ? jsonResponse({}, 500) : jsonResponse({}, 404)));
    await expect(svc.resolve("Notch")).rejects.toThrow(IdentityLookupError);
  });

  test("is cached for the ttl", async () => {
    const { svc, fetched } = service((url) =>
      url.includes("mojang") ? jsonResponse({ id: MOJANG_ID, name: "Notch" }) : jsonResponse({}, 404),
    );
    await svc.resolve("Notch");
    const afterFirst = fetched.length;
    await svc.resolve("Notch");
    expect(fetched.length).toBe(afterFirst);
    svc.clearCache();
    await svc.resolve("Notch");
    expect(fetched.length).toBeGreaterThan(afterFirst);
  });

  test("input is validated before any request is made", async () => {
    const { svc, fetched } = service(() => jsonResponse({}, 500));
    await expect(svc.resolve(".Notch")).rejects.toThrow(IdentityLookupError);
    expect(fetched).toHaveLength(0);
  });
});
