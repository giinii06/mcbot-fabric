import { withTimeout } from "../core/rate-limit";
import type { Logger } from "../log";
import type { Edition } from "../bridge/protocol";

export interface JavaIdentity {
  uuid: string;
  name: string;
}

export interface BedrockIdentity {
  gamertag: string;
  xuid: string;
  /** Floodgate style UUID: `new UUID(0, xuid)` (8-4-4-4-12 groups). */
  uuid: string;
}

export type IdentityStatus = "JAVA" | "BEDROCK" | "BOTH" | "NONE";

export interface IdentityResult {
  input: string;
  status: IdentityStatus;
  java: JavaIdentity | null;
  bedrock: BedrockIdentity | null;
  /**
   * Geyser answered 503: the gamertag is not in their cache and their Xbox Live
   * lookup is unavailable. The account can still be perfectly valid, so callers
   * should say "try again later" instead of "this account does not exist".
   */
  bedrockCacheMiss?: boolean;
}

interface BedrockLookup {
  identity: BedrockIdentity | null;
  cacheMiss: boolean;
}

export interface IdentityCandidate {
  edition: Edition;
  uuid: string;
  username: string;
  xuid: string | null;
}

export class IdentityLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityLookupError";
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MOJANG_PROFILE = "https://api.mojang.com/users/profiles/minecraft/";
const GEYSER_XUID = "https://api.geysermc.org/v2/xbox/xuid/";

const JAVA_NAME = /^[A-Za-z0-9_]{3,16}$/;
const GAMERTAG = /^[A-Za-z0-9][A-Za-z0-9 _.'-]{0,15}$/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Formats the 32 hex characters returned by Mojang as a dashed UUID. */
export function dashedUuid(hex: string): string {
  const clean = hex.toLowerCase();
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

/**
 * Floodgate UUID: `new UUID(0, xuid)` exactly as produced by
 * `org.geysermc.floodgate.util.Utils#getJavaUuid` - the 128 bit value is
 * `xuid` in the low 64 bits, printed as 8-4-4-4-12 hex groups (the fourth
 * group is the top 16 bits of the XUID, so it becomes non zero once the XUID
 * exceeds 2^48).
 */
export function bedrockUuid(xuid: string): string {
  const lsb = (BigInt(xuid) & ((1n << 64n) - 1n)).toString(16).padStart(16, "0");
  return `00000000-0000-0000-${lsb.slice(0, 4)}-${lsb.slice(4)}`;
}

/** True for a Floodgate style uuid (most significant 64 bits are zero). */
export function isBedrockUuid(uuid: string): boolean {
  return uuid.toLowerCase().startsWith("00000000-0000-0000-");
}

export type ValidationResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Shared input validation for the `마크아이디` option: accepts either a Java
 * username or a Bedrock gamertag, but never a Floodgate prefix or anything
 * that could be interpreted as part of a command.
 */
export function validatePlayerInput(rawInput: string): ValidationResult {
  const value = (rawInput ?? "").trim();
  if (!value) return { ok: false, reason: "마크 아이디를 입력해 주세요." };
  if (value.length > 16) return { ok: false, reason: "마크 아이디는 16자를 넘을 수 없습니다." };
  if (value.startsWith("."))
    return { ok: false, reason: "아이디 앞에 점(.)을 붙이지 마세요. 게이트웨이 접두사는 자동으로 처리됩니다." };
  if (CONTROL_CHARS.test(value)) return { ok: false, reason: "사용할 수 없는 문자가 포함되어 있습니다." };
  if (!GAMERTAG.test(value))
    return { ok: false, reason: "영문/숫자/공백/._'- 로 구성된 1~16자 아이디만 사용할 수 있습니다." };
  return { ok: true, value };
}

export interface IdentityServiceOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  log?: Logger;
}

interface CacheEntry {
  result: IdentityResult;
  expiresAt: number;
}

/** Resolves a Minecraft identity through the official Java API and Geyser's utility API. */
export class IdentityService {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly log: Logger | undefined;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: IdentityServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.log = options.log;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async get(url: string, label: string): Promise<Response> {
    try {
      return await withTimeout(this.fetchImpl(url, { method: "GET" }), this.timeoutMs, label);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.warn("identity lookup failed", { label, error: message });
      throw new IdentityLookupError(`${label} 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.`);
    }
  }

  private async lookupJava(name: string): Promise<JavaIdentity | null> {
    if (!JAVA_NAME.test(name)) return null;
    const response = await this.get(`${MOJANG_PROFILE}${encodeURIComponent(name)}`, "Mojang");
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) throw new IdentityLookupError("Mojang API 응답이 올바르지 않습니다.");
    const body = (await response.json()) as { id?: string; name?: string };
    if (!body.id || !body.name) return null;
    return { uuid: dashedUuid(body.id), name: body.name };
  }

  private async lookupBedrock(gamertag: string): Promise<BedrockLookup> {
    const response = await this.get(`${GEYSER_XUID}${encodeURIComponent(gamertag)}`, "Geyser");
    // 503 = "not cached, and we could not call the Xbox Live API" (see the
    // Geyser Global API docs) - distinct from an account that simply does not exist.
    if (response.status === 503) return { identity: null, cacheMiss: true };
    if (response.status === 404 || response.status === 400) return { identity: null, cacheMiss: false };
    if (!response.ok) throw new IdentityLookupError("Bedrock ID 조회에 실패했습니다.");
    const body = (await response.json()) as { xuid?: number | string };
    if (body.xuid === undefined || body.xuid === null) return { identity: null, cacheMiss: false };
    const xuid = String(body.xuid);
    if (!/^\d{4,20}$/.test(xuid)) return { identity: null, cacheMiss: false };
    return { identity: { gamertag, xuid, uuid: bedrockUuid(xuid) }, cacheMiss: false };
  }

  /**
   * Java and Bedrock are always both queried so the caller can decide between
   * "auto register" and "show the edition buttons".
   */
  async resolve(rawInput: string): Promise<IdentityResult> {
    const validated = validatePlayerInput(rawInput);
    if (!validated.ok) throw new IdentityLookupError(validated.reason);
    const input = validated.value;

    const cached = this.cache.get(input.toLowerCase());
    if (cached && cached.expiresAt > this.now()) return cached.result;

    const [java, bedrock] = await Promise.all([this.lookupJava(input), this.lookupBedrock(input)]);

    let status: IdentityStatus = "NONE";
    if (java && bedrock.identity) status = "BOTH";
    else if (java) status = "JAVA";
    else if (bedrock.identity) status = "BEDROCK";

    const result: IdentityResult = {
      input,
      status,
      java,
      bedrock: bedrock.identity,
      ...(bedrock.cacheMiss ? { bedrockCacheMiss: true } : {}),
    };
    this.cache.set(input.toLowerCase(), { result, expiresAt: this.now() + this.cacheTtlMs });
    if (this.cache.size > 500) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    return result;
  }

  candidates(result: IdentityResult): IdentityCandidate[] {
    const list: IdentityCandidate[] = [];
    if (result.java) {
      list.push({ edition: "JAVA", uuid: result.java.uuid, username: result.java.name, xuid: null });
    }
    if (result.bedrock) {
      list.push({
        edition: "BEDROCK",
        uuid: result.bedrock.uuid,
        username: result.bedrock.gamertag,
        xuid: result.bedrock.xuid,
      });
    }
    return list;
  }
}
