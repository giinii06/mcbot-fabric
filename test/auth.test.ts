import { describe, expect, test } from "bun:test";
import { extractSecret, isAuthorized, safeEquals } from "../src/bridge/auth";

const SECRET = "0123456789abcdef0123456789abcdef";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://bot/bridge/events", { method: "POST", headers });
}

describe("safeEquals", () => {
  test("compares content", () => {
    expect(safeEquals(SECRET, SECRET)).toBe(true);
    expect(safeEquals(SECRET, `${SECRET}x`)).toBe(false);
    expect(safeEquals("", "")).toBe(true);
    expect(safeEquals("short", SECRET)).toBe(false);
  });
});

describe("extractSecret", () => {
  test("reads the bearer header", () => {
    expect(extractSecret(req({ authorization: `Bearer ${SECRET}` }))).toBe(SECRET);
    expect(extractSecret(req({ authorization: `bearer ${SECRET}` }))).toBe(SECRET);
    expect(extractSecret(req({ authorization: `  Bearer   ${SECRET}  ` }))).toBe(SECRET);
  });

  test("reads the bridge secret header", () => {
    expect(extractSecret(req({ "x-bridge-secret": SECRET }))).toBe(SECRET);
    expect(extractSecret(req({ "x-bridge-secret": ` ${SECRET} ` }))).toBe(SECRET);
  });

  test("returns null when nothing is provided", () => {
    expect(extractSecret(req())).toBeNull();
    expect(extractSecret(req({ authorization: "Basic abc" }))).toBeNull();
    expect(extractSecret(req({ authorization: "Bearer" }))).toBeNull();
  });
});

describe("isAuthorized", () => {
  test("accepts only the exact secret", () => {
    expect(isAuthorized(req({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
    expect(isAuthorized(req({ "x-bridge-secret": SECRET }), SECRET)).toBe(true);
    expect(isAuthorized(req({ authorization: "Bearer wrong" }), SECRET)).toBe(false);
    expect(isAuthorized(req(), SECRET)).toBe(false);
    expect(isAuthorized(req({ authorization: `Bearer ${SECRET}` }), "")).toBe(false);
  });
});
